// Home care depth, item 10 (docs/parity/homecare-margin-turnover.md): per-client margin (billed − paid, with each work
// week's overtime put on the shifts that crossed 40 hours, and mileage) and caregiver turnover. Off (refused) without
// care_margin_reports.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { allocateOvertime } from '../server/crm/homecare/core/margin.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team']
const review = (caregiverId: string, clientId: string | null, shiftDate: string, payableMinutes: number, status = 'verified') =>
  ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-14', caregiverId, clientId, shiftDate, payableMinutes, status })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  const mk = async (who: string, extra: any = {}) => {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, ...extra })).id
  }
  await mk('ann', { defaultPayRate: '20.00', hireDate: '2026-01-01' })
  await mk('bob', { hireDate: '2026-02-01', isActive: false })
  await mk('cy', { hireDate: '2026-10-01' })
  await mk('dee', { hireDate: '2026-03-01', isActive: false })
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.a = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true, isPrivatePay: true, privatePayRate: '40.00', privatePayRateType: 'hourly' })).id
  ids.b = (await ins(t.schema.clients, { companyId, firstName: 'Ben', lastName: 'Baker', isActive: true, isPrivatePay: true, privatePayRate: '30.00', privatePayRateType: 'hourly' })).id
  ids.c = (await ins(t.schema.clients, { companyId, firstName: 'Cora', lastName: 'Cole', isActive: true }))?.id
  // Week Sun 2026-11-01 – Sat 11-07: Ann works Alma 3 × 10h (30h) then Ben 3 × 5h (15h) = 45h; the last 5h are overtime, all on Ben.
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) await review(ids.ann, ids.a, d, 600)
  for (const d of ['2026-11-05', '2026-11-06', '2026-11-07']) await review(ids.ann, ids.b, d, 300)
  await review(ids.ann, ids.c, '2026-11-09', 120)                       // next week, a client with no rate
  await review(ids.ann, ids.a, '2026-11-09', 600, 'pending')            // not payable: on neither payroll nor margin
  await review(ids.ann, null, '2026-11-10', 60)                         // no client named
  await ins(t.schema.mileageEntries, { companyId, caregiverId: ids.ann, date: '2026-11-05', miles: '15', amount: '10.00', clientId: ids.b })
  await setFeatures(BASE)
}, 90_000)

const margin = async (q = 'startDate=2026-11-01&endDate=2026-11-14') => json(await as('owner')(`/api/margin-reports/client-margin?${q}`))

describe('home care — client margin (item 10)', () => {
  test('overtime goes on the shifts that crossed the 40-hour line', () => {
    const shifts = [10, 10, 10, 5, 5, 5].map((h, i) => ({ id: `s${i}`, clientId: i < 3 ? 'A' : 'B', caregiverId: 'ann', date: `2026-11-0${i + 2}`, minutes: h * 60 }))
    const pay = allocateOvertime(shifts, 0)
    expect(pay.map((p) => p.overtimeMinutes)).toEqual([0, 0, 0, 0, 0, 300])
    // a shift that straddles the line is split, and a new week starts again at zero
    const split = allocateOvertime([{ id: 'x', clientId: 'A', caregiverId: 'ann', date: '2026-11-02', minutes: 38 * 60 }, { id: 'y', clientId: 'A', caregiverId: 'ann', date: '2026-11-03', minutes: 5 * 60 }, { id: 'z', clientId: 'A', caregiverId: 'ann', date: '2026-11-09', minutes: 5 * 60 }], 0)
    expect(split.map((p) => [p.regularMinutes, p.overtimeMinutes])).toEqual([[2280, 0], [120, 180], [300, 0]])
  })

  test('without the feature the report is refused', async () => {
    const r = await margin()
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ code: 'FEATURE_NOT_ENABLED', feature: 'care_margin_reports' })
  })

  test('billed − paid per client, overtime on the client whose shifts crossed 40 hours, mileage counted', async () => {
    await setFeatures([...BASE, 'care_margin_reports'])
    const r = await margin()
    expect(r.status).toBe(200)
    const by = (name: string) => r.body.clients.find((c: any) => c.clientName === name)
    // Alma: 30h × $40 = $1200 billed; 30h × $20 = $600 pay → $600 margin (50%)
    expect(by('Alma Able')).toMatchObject({ hours: 30, overtimeHours: 0, billed: 1200, pay: 600, overtimePay: 0, mileage: 0, margin: 600, marginPercent: 50 })
    // Ben: 15h × $30 = $450 billed; 10h × $20 + 5h × $30 (overtime) = $350 pay + $10 mileage → $90 margin (20%)
    expect(by('Ben Baker')).toMatchObject({ hours: 15, overtimeHours: 5, billed: 450, pay: 350, overtimePay: 150, mileage: 10, cost: 360, margin: 90, marginPercent: 20 })
    // Cora has no rate: her cost is shown and her margin is not made up.
    expect(by('Cora Cole')).toMatchObject({ hours: 2, rate: null, billed: null, pay: 40, margin: null, marginPercent: null })
    expect(r.body.clients.map((c: any) => c.clientName)).toEqual(['Ben Baker', 'Alma Able', 'Cora Cole'])
    expect(r.body.totals).toMatchObject({ hours: 47, billed: 1650, clientsWithoutRate: 1 })
    expect(r.body.hoursWithoutClient).toBe(1)
  })

  test('the pay on the report adds up to what payroll pays, and a pending shift is on neither', async () => {
    const lines = await core.payroll.payrollForRange(companyId, '2026-11-01', '2026-11-14')
    const grossPayroll = lines.reduce((s, l) => s + l.grossPay, 0)
    const r = await margin()
    const reported = r.body.clients.reduce((s: number, c: any) => s + c.pay, 0)
    // payroll also pays the 1 hour with no client: $20 more than the clients' share
    expect(Math.round((grossPayroll - reported) * 100) / 100).toBe(20)
    expect(r.body.clients.some((c: any) => c.hours === 10 && c.clientName === 'Alma Able')).toBe(false)
  })

  test('a window outside the data is empty; a bad or too-long window is refused; a caregiver cannot read it', async () => {
    expect((await margin('startDate=2027-01-01&endDate=2027-01-31')).body.clients).toEqual([])
    expect((await margin('startDate=nope&endDate=2026-11-14')).body.code).toBe('bad_range')
    expect((await margin('startDate=2026-11-14&endDate=2026-11-01')).body.code).toBe('bad_range')
    expect((await margin('startDate=2024-01-01&endDate=2026-11-14')).body.code).toBe('range_too_long')
    expect((await as('ann')('/api/margin-reports/client-margin')).status).toBe(403)
  })
})

describe('home care — caregiver turnover (item 10)', () => {
  test('hires, departures, headcount, rates and who left', async () => {
    // Bob stopped working on 10-10; Dee never worked and her record last changed in June.
    await ins(t.schema.timeEntries, { companyId, caregiverId: ids.bob, clientId: ids.a, startTime: new Date('2026-10-10T14:00:00Z'), endTime: new Date('2026-10-10T16:00:00Z'), isComplete: true, durationMinutes: 120, allottedMinutes: 120 })
    await t.db.update(t.schema.user).set({ updatedAt: new Date('2026-06-15T12:00:00Z') } as any).where(eq(t.schema.user.id, ids.dee))
    const r = await json(await as('owner')('/api/margin-reports/turnover?startDate=2026-10-01&endDate=2026-10-31'))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ headcountStart: 2, headcountEnd: 2, hires: 1, departures: 1, turnoverPercent: 50, retentionPercent: 50, hiresWith90Days: 0, ninetyDayRetentionPercent: null })
    expect(r.body.departed).toEqual([{ caregiverId: ids.bob, name: 'Bob Carer', hired: '2026-02-01', lastWorked: '2026-10-10', tenureDays: 251 }])
    expect(r.body.averageTenureDaysOfDeparted).toBe(251)
  })

  test('90-day retention counts only hires that have had 90 days', async () => {
    const r = await json(await as('owner')('/api/margin-reports/turnover?startDate=2026-01-01&endDate=2026-10-31'))
    // hired in the window: Ann (Jan 1), Bob (Feb 1), Dee (Mar 1), Cy (Oct 1, too new). Bob kept 251 days; Dee left on 06-15 = 106 days; Ann still here.
    expect(r.body).toMatchObject({ hires: 4, hiresWith90Days: 3, hiresKept90Days: 3, ninetyDayRetentionPercent: 100 })
  })

  test('a caregiver cannot read it', async () => {
    expect((await as('ann')('/api/margin-reports/turnover')).status).toBe(403)
  })
})
