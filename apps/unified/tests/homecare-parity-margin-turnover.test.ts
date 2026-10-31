// Home care parity row 11 (docs/parity/homecare-margin-turnover.md): the margin and turnover reports finished — CSV and PDF downloads,
// filters by payer / client / caregiver / branch / referral source, per-visit margin, two periods side by side, the trend and the
// drill-down total → branch → team → client, hours invoiced beside hours worked, revenue by referral source, department (care type)
// profit, a stored leaving date, applicant-to-hire, hire-to-first-shift, call-outs and missed visits per caregiver, cost per hire,
// payroll accuracy. Behind care_margin_reports. The original item-10 suite (tests/homecare-depth-margin.test.ts) still passes.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { bucketOf } from '../server/crm/homecare/core/margin.ts'

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
const review = (caregiverId: string, clientId: string | null, shiftDate: string, payableMinutes: number, status = 'verified', extra: any = {}) =>
  ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-14', caregiverId, clientId, shiftDate, payableMinutes, status, ...extra })
const W = 'startDate=2026-11-01&endDate=2026-11-14'
const get = async (p: string, who = 'owner') => json(await as(who)(p))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.north = (await ins(t.schema.serviceLocations, { companyId, name: 'North branch' })).id
  ids.south = (await ins(t.schema.serviceLocations, { companyId, name: 'South branch' })).id
  ids.hospital = (await ins(t.schema.referralSources, { companyId, name: 'St Mary Hospital', isActive: true })).id
  ids.medicaid = (await ins(t.schema.referralSources, { companyId, name: 'County Medicaid', isActive: true, isActivePayer: true, payerType: 'medicaid' })).id
  ids.personal = (await ins(t.schema.careTypes, { companyId, name: 'Personal care', hourlyRate: '35.00' })).id
  ids.respite = (await ins(t.schema.careTypes, { companyId, name: 'Respite', hourlyRate: '28.00' })).id
  const mk = async (who: string, extra: any = {}, profile: any = {}) => {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, ...extra })).id
    await ins(t.schema.caregiverProfiles, { companyId, caregiverId: ids[who], ...profile })
  }
  await mk('ann', { defaultPayRate: '20.00', hireDate: '2026-01-01' }, { branchId: ids.north, team: 'Day team' })
  await mk('bob', { defaultPayRate: '20.00', hireDate: '2026-02-01', isActive: false }, { branchId: ids.north, team: 'Night team', leftOn: '2026-10-20', leftReason: 'Moved away' })
  await mk('cy', { defaultPayRate: '20.00', hireDate: '2026-10-05' }, { branchId: ids.south, team: 'Day team' })
  await mk('dee', { hireDate: '2026-03-01', isActive: false }, {})
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.a = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true, isPrivatePay: true, privatePayRate: '40.00', privatePayRateType: 'hourly', branchId: ids.north, referredById: ids.hospital, careTypeId: ids.personal })).id
  ids.b = (await ins(t.schema.clients, { companyId, firstName: 'Ben', lastName: 'Baker', isActive: true, isPrivatePay: true, privatePayRate: '30.00', privatePayRateType: 'hourly', branchId: ids.south, careTypeId: ids.respite })).id
  await ins(t.schema.authorizations, { companyId, clientId: ids.b, payerId: ids.medicaid, authorizedUnits: '400', startDate: '2026-10-01', endDate: '2026-12-31', status: 'active' })
  // Week Sun 11-01 – Sat 11-07: Ann works Alma 3 × 10h then Ben 3 × 5h = 45h; the last 5h are overtime, on Ben. Cy works Alma 2h on 11-09.
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) await review(ids.ann, ids.a, d, 600)
  for (const d of ['2026-11-05', '2026-11-06', '2026-11-07']) await review(ids.ann, ids.b, d, 300)
  await review(ids.cy, ids.a, '2026-11-09', 120)
  // An invoice for Alma carries 28 of the 32 hours worked (hours invoiced beside hours worked).
  ids.inv = (await ins(t.schema.invoices, { companyId, invoiceNumber: 'INV-1001', clientId: ids.a, billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-11-14', subtotal: '1120.00', total: '1120.00' })).id
  await ins(t.schema.invoiceLineItems, { companyId, invoiceId: ids.inv, caregiverId: ids.ann, description: 'Care', serviceDate: '2026-11-02', hours: '28', rate: '40.00', amount: '1120.00' })
  await setFeatures(['contacts', 'scheduling', 'team', 'care_margin_reports'])
}, 90_000)

describe('row 11 — margin filters, groupings and downloads', () => {
  test('the margin filters by caregiver, branch, referral source and payer, and shows hours invoiced beside hours worked', async () => {
    const all = await get(`/api/margin-reports/client-margin?${W}`)
    expect(all.status).toBe(200)
    const alma = all.body.clients.find((c: any) => c.clientName === 'Alma Able')
    expect(alma).toMatchObject({ hours: 32, hoursInvoiced: 28, billedCents: 128000, branchName: 'North branch', referralSourceName: 'St Mary Hospital', department: 'Personal care', payerName: null })
    expect(all.body.totals).toMatchObject({ hours: 47, hoursInvoiced: 28, billedCents: 173000 })
    // only Cy's share of Alma
    const cy = await get(`/api/margin-reports/client-margin?${W}&caregiverId=${ids.cy}`)
    expect(cy.body.clients.map((c: any) => [c.clientName, c.hours])).toEqual([['Alma Able', 2]])
    expect(cy.body.clients[0].billedCents).toBe(8000)
    const south = await get(`/api/margin-reports/client-margin?${W}&branchId=${ids.south}`)
    expect(south.body.clients.map((c: any) => c.clientName)).toEqual(['Ben Baker'])
    const hosp = await get(`/api/margin-reports/client-margin?${W}&referralSourceId=${ids.hospital}`)
    expect(hosp.body.clients.map((c: any) => c.clientName)).toEqual(['Alma Able'])
    const payer = await get(`/api/margin-reports/client-margin?${W}&payerId=${ids.medicaid}`)
    expect(payer.body.clients.map((c: any) => [c.clientName, c.payerName])).toEqual([['Ben Baker', 'County Medicaid']])
  })

  test('revenue by referral source, by payer, department (care type) profit and by branch add up to the total', async () => {
    const r = await get(`/api/margin-reports/client-margin?${W}`)
    const by = (list: any[], name: string) => list.find((g) => g.name === name)
    expect(by(r.body.byReferralSource, 'St Mary Hospital')).toMatchObject({ clients: 1, billedCents: 128000 })
    expect(by(r.body.byReferralSource, 'No referral source')).toMatchObject({ clients: 1, billedCents: 45000 })
    expect(by(r.body.byPayer, 'County Medicaid')).toMatchObject({ billedCents: 45000 })
    // Ben: 15h × $30 = $450 billed; 10h × $20 + 5h × $30 overtime = $350 → $100 margin
    expect(by(r.body.byDepartment, 'Respite')).toMatchObject({ billedCents: 45000, costCents: 35000, marginCents: 10000 })
    expect(by(r.body.byDepartment, 'Personal care')).toMatchObject({ billedCents: 128000, costCents: 64000, marginCents: 64000 })
    expect(by(r.body.byBranch, 'North branch').marginCents + by(r.body.byBranch, 'South branch').marginCents).toBe(r.body.totals.marginCents)
  })

  test('per-visit margin for the window lists every paid visit with its own margin in cents', async () => {
    const r = await get(`/api/margin-reports/visit-margin?${W}`)
    expect(r.status).toBe(200)
    expect(r.body.visits.length).toBe(7)
    const first = r.body.visits[0]
    expect(first).toMatchObject({ date: '2026-11-02', clientName: 'Alma Able', caregiverName: 'Ann Carer', hours: 10, billedCents: 40000, payCents: 20000, marginCents: 20000, marginPercent: 50 })
    // the overtime visit: 5h × $30 billed, 5h × $30 overtime pay → nothing left
    const ot = r.body.visits.find((v: any) => v.date === '2026-11-07')
    expect(ot).toMatchObject({ overtimeHours: 5, billedCents: 15000, payCents: 15000, marginCents: 0 })
    expect(r.body.totals).toMatchObject({ visits: 7, billedCents: 173000, payCents: 99000, marginCents: 74000 })
    const day = await get('/api/margin-reports/visit-margin?startDate=2026-11-09&endDate=2026-11-09')
    expect(day.body.visits.map((v: any) => v.caregiverName)).toEqual(['Cy Carer'])
  })

  test('the trend buckets by week or month and adds up to the total; the drill-down goes agency → branch → team → client', async () => {
    expect(bucketOf('2026-11-04', 'week')).toBe('2026-11-01')
    expect(bucketOf('2026-11-04', 'month')).toBe('2026-11')
    const wk = await get(`/api/margin-reports/trend?${W}&by=week`)
    expect(wk.body.points.map((p: any) => p.bucket)).toEqual(['2026-11-01', '2026-11-08'])
    expect(wk.body.points[0]).toMatchObject({ visits: 6, hours: 45, billedCents: 165000, costCents: 95000, marginCents: 70000 })
    expect(wk.body.points.reduce((s: number, p: any) => s + p.marginCents, 0)).toBe(74000)
    const mo = await get(`/api/margin-reports/trend?${W}&by=month`)
    expect(mo.body.points.map((p: any) => p.bucket)).toEqual(['2026-11'])
    const d = await get(`/api/margin-reports/drill-down?${W}`)
    const total = d.body.total
    expect(total).toMatchObject({ name: 'Whole agency', marginCents: 74000 })
    const north = total.children.find((n: any) => n.name === 'North branch')
    expect(north.marginCents).toBe(64000)
    expect(north.children.map((n: any) => n.name).sort()).toEqual(['Day team'])
    expect(north.children[0].children.map((n: any) => [n.name, n.hours])).toEqual([['Alma Able', 32]])
  })

  test('two periods side by side give the change per client', async () => {
    const r = await get(`/api/margin-reports/compare?startDate=2026-11-08&endDate=2026-11-14&compareStart=2026-11-01&compareEnd=2026-11-07`)
    expect(r.status).toBe(200)
    expect(r.body.current.totals.marginCents).toBe(4000)
    expect(r.body.previous.totals.marginCents).toBe(70000)
    expect(r.body.change.marginCents).toBe(-66000)
    const alma = r.body.clients.find((c: any) => c.clientName === 'Alma Able')
    expect(alma).toMatchObject({ changeCents: 4000 - 60000, hoursChange: 2 - 30 })
    const ben = r.body.clients.find((c: any) => c.clientName === 'Ben Baker')
    expect(ben.current).toBeNull()
    expect(ben.previous.marginCents).toBe(10000)
    expect((await get('/api/margin-reports/compare?startDate=2026-11-08&endDate=2026-11-14')).body.code).toBe('bad_range')
  })

  test('both reports download as CSV and as PDF', async () => {
    const csv = await as('owner')(`/api/margin-reports/client-margin?${W}&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text.split('\n')[0]).toBe('Client,Branch,Department,Referral source,Payer,Hours worked,Hours invoiced,Overtime hours,Bill rate,Billed,Caregiver pay,Mileage,Cost,Margin,Margin %')
    expect(text).toContain('Alma Able,North branch,Personal care,St Mary Hospital,,32,28,0,40,1280.00,640.00,0.00,640.00,640.00,50')
    const pdf = await as('owner')(`/api/margin-reports/client-margin?${W}&format=pdf`)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
    const tcsv = await as('owner')(`/api/margin-reports/turnover?startDate=2026-10-01&endDate=2026-10-31&format=csv`)
    expect((await tcsv.text())).toContain('Left,Bob Carer,2026-02-01,2026-10-20,yes,Moved away,261')
    const tpdf = await as('owner')(`/api/margin-reports/turnover?startDate=2026-10-01&endDate=2026-10-31&format=pdf`)
    expect(tpdf.headers.get('content-type')).toBe('application/pdf')
    const vcsv = await as('owner')(`/api/margin-reports/visit-margin?${W}&format=csv`)
    expect((await vcsv.text()).split('\n').length).toBe(9)
    expect((await get(`/api/margin-reports/client-margin?${W}&format=xlsx`)).body.code).toBe('bad_format')
  })

  test('the filter lists name the clients, caregivers, branches, referral sources and payers; a caregiver cannot read them', async () => {
    const r = await get('/api/margin-reports/filters')
    expect(r.body.branches.map((b: any) => b.name)).toEqual(['North branch', 'South branch'])
    expect(r.body.payers.map((p: any) => p.name)).toEqual(['County Medicaid'])
    expect(r.body.referralSources.length).toBe(2)
    expect((await as('ann')('/api/margin-reports/filters')).status).toBe(403)
  })
})

describe('row 11 — turnover with a stored leaving date, hiring and payroll accuracy', () => {
  test('a stored leaving date is exact and beats the last visit; one without falls back to the last visit', async () => {
    // Bob last worked 10-10 but the office stored 10-20 as his last day; Dee has no date and never worked, so her record change dates her.
    await ins(t.schema.timeEntries, { companyId, caregiverId: ids.bob, clientId: ids.a, startTime: new Date('2026-10-10T14:00:00Z'), endTime: new Date('2026-10-10T16:00:00Z'), isComplete: true, durationMinutes: 120, allottedMinutes: 120 })
    await t.db.update(t.schema.user).set({ updatedAt: new Date('2026-06-15T12:00:00Z') } as any).where(eq(t.schema.user.id, ids.dee))
    const r = await get('/api/margin-reports/turnover?startDate=2026-10-01&endDate=2026-10-31')
    expect(r.status).toBe(200)
    expect(r.body.departed).toEqual([expect.objectContaining({ name: 'Bob Carer', leftOn: '2026-10-20', exact: true, leftReason: 'Moved away', tenureDays: 261, branchName: 'North branch', team: 'Night team' })])
    expect(r.body.departuresWithoutLeavingDate).toBe(0)
    const june = await get('/api/margin-reports/turnover?startDate=2026-06-01&endDate=2026-06-30')
    expect(june.body.departed).toEqual([expect.objectContaining({ name: 'Dee Carer', leftOn: '2026-06-15', exact: false })])
    expect(june.body.departuresWithoutLeavingDate).toBe(1)
    // a branch filter keeps only that branch's people
    const south = await get('/api/margin-reports/turnover?startDate=2026-10-01&endDate=2026-10-31&branchId=' + ids.south)
    expect(south.body).toMatchObject({ hires: 1, departures: 0 })
  })

  test('the office stores the leaving date and placement on the profile; deactivating a caregiver dates it today', async () => {
    const bad = await json(await as('owner')(`/api/caregiver-profile/${ids.cy}`, { method: 'PATCH', json: { branchId: 'nope' } }))
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ code: 'bad_placement', fields: { branchId: 'Not one of your branches' } })
    expect((await json(await as('owner')(`/api/caregiver-profile/${ids.cy}`, { method: 'PATCH', json: { leftOn: 'yesterday' } }))).body.fields).toEqual({ leftOn: 'Enter a date' })
    const ok = await json(await as('owner')(`/api/caregiver-profile/${ids.cy}`, { method: 'PATCH', json: { team: 'Evening team', department: 'Respite', managerUserId: (await json(await as('owner')('/api/auth/me'))).body.user.id, leftOn: '' } }))
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ team: 'Evening team', department: 'Respite', leftOn: null })
    // Deactivate Cy: the leaving date is today on the agency's clock. Reactivating clears it.
    const today = await core.time.today(companyId)
    expect((await json(await as('owner')(`/api/caregivers/${ids.cy}/toggle-active`, { method: 'PATCH' }))).body.isActive).toBe(false)
    expect((await json(await as('owner')(`/api/caregiver-profile/${ids.cy}`))).body.leftOn).toBe(today)
    expect((await json(await as('owner')(`/api/caregivers/${ids.cy}/toggle-active`, { method: 'PATCH' }))).body.isActive).toBe(true)
    expect((await json(await as('owner')(`/api/caregiver-profile/${ids.cy}`))).body.leftOn).toBeNull()
  })

  test('applicant-to-hire, hire-to-first-shift, cost per hire, call-outs and missed visits per caregiver, payroll accuracy', async () => {
    // October: 4 applicants, 1 hired (Cy, hired 10-05, first shift 10-12); $450 of hiring expenses; Ann called out twice and missed one visit.
    for (const n of ['P', 'Q', 'R']) await ins(t.schema.applications, { companyId, firstName: n, lastName: 'Applicant', status: 'new', createdAt: new Date('2026-10-03T12:00:00Z') })
    await ins(t.schema.applications, { companyId, firstName: 'Cy', lastName: 'Carer', status: 'hired', hiredUserId: ids.cy, createdAt: new Date('2026-10-01T12:00:00Z') })
    await ins(t.schema.timeEntries, { companyId, caregiverId: ids.cy, clientId: ids.a, startTime: new Date('2026-10-12T14:00:00Z'), endTime: new Date('2026-10-12T16:00:00Z'), isComplete: true, durationMinutes: 120 })
    const owner = (await json(await as('owner')('/api/auth/me'))).body.user
    await ins(t.schema.expenses, { companyId, userId: owner.id, category: 'recruiting', description: 'Job board', amount: '300.00', date: '2026-10-02', status: 'approved' })
    await ins(t.schema.expenses, { companyId, userId: owner.id, category: 'background_checks', description: 'Check', amount: '150.00', date: '2026-10-06', status: 'approved' })
    await ins(t.schema.expenses, { companyId, userId: owner.id, category: 'supplies', description: 'Gloves', amount: '80.00', date: '2026-10-06', status: 'approved' })
    await ins(t.schema.absences, { companyId, caregiverId: ids.ann, date: '2026-10-14', type: 'sick' })
    const sched = await ins(t.schema.schedules, { companyId, clientId: ids.a, caregiverId: ids.ann, startTime: new Date('2026-10-21T09:00:00'), endTime: new Date('2026-10-21T11:00:00'), scheduleType: 'one_time', date: '2026-10-21', dayOfWeek: null })
    await ins(t.schema.scheduleExceptions, { companyId, scheduleId: sched.id, exceptionDate: '2026-10-21', exceptionType: 'cancelled', cancelReason: 'caregiver_callout' })
    await ins(t.schema.noshowAlerts, { companyId, caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-10-22', expectedStart: '09:00' })
    // Payroll: 4 reviewed shifts in October, one corrected by hand; one pay period disputed, one confirmed.
    await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-10-05', payableMinutes: 120, scheduledMinutes: 120, status: 'approved' })
    await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-10-06', payableMinutes: 120, scheduledMinutes: 120, status: 'verified' })
    await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-10-07', payableMinutes: 90, scheduledMinutes: 120, actualMinutes: 125, status: 'approved' })
    await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-10-08', payableMinutes: 120, status: 'manual_entry' })
    await ins(t.schema.payrollPeriodVerifications, { companyId, caregiverId: ids.ann, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', disputedAt: new Date('2026-10-16T12:00:00Z'), disputeReason: 'Missing a shift' })
    await ins(t.schema.payrollPeriodVerifications, { companyId, caregiverId: ids.cy, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', verifiedAt: new Date('2026-10-16T12:00:00Z') })

    const r = await get('/api/margin-reports/turnover?startDate=2026-10-01&endDate=2026-10-31')
    expect(r.body.hiring).toMatchObject({ applicants: 4, applicantsHired: 1, applicantToHireRatio: 4, hiresWhoStarted: 1, hireToFirstShiftDays: 7, hiresNotYetStarted: 0, hiringSpendCents: 45000, costPerHireCents: 45000 })
    expect(r.body.reliability).toEqual([{ caregiverId: ids.ann, name: 'Ann Carer', absences: 1, cancelledVisits: 1, missedVisits: 1 }])
    expect(r.body.payrollAccuracy).toEqual({ reviewed: 4, corrected: 2, disputed: 1, verified: 1, accuracyPercent: 50 })
    // a window with no hires has no ratio and no cost per hire, never a division by zero
    const empty = await get('/api/margin-reports/turnover?startDate=2027-01-01&endDate=2027-01-31')
    expect(empty.body.hiring).toMatchObject({ applicants: 0, applicantToHireRatio: null, costPerHireCents: null, hireToFirstShiftDays: null })
  })

  test('without the feature everything is refused', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    for (const p of ['/client-margin', '/visit-margin', '/trend', '/drill-down', '/turnover', '/filters']) {
      const r = await get(`/api/margin-reports${p}?${W}`)
      expect(r.status).toBe(403)
      expect(r.body.feature).toBe('care_margin_reports')
    }
    await setFeatures(['contacts', 'scheduling', 'team', 'care_margin_reports'])
  })
})
