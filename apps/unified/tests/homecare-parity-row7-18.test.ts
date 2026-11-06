// Home care parity rows 7 and 18, the edges:
//   row 7 (care_no_arrival): a caregiver who has not clocked in by the visit's start plus the grace minutes raises ONE No-Show alert, and
//         the office, the caregiver and (when chosen) the family are told — the No-Show screen's "Run check" was a stub before;
//   row 18 (care_pickup_rewards): a pickup bonus is part of the regular rate (29 CFR 778.209), so a week with overtime owes half of
//         bonus ÷ hours again on each overtime hour.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { missedVisits } from '../server/crm/homecare/core/noArrival.ts'
import { bonusOvertimeCents } from '../server/crm/homecare/core/payrollPay.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { ymdIn, hmsIn } from '../server/crm/homecare/core/agencyTime.ts'

describe('the rules (pure)', () => {
  test('missed: past start + grace, within three hours, and nobody clocked in', () => {
    const v = (start: string, cg = 'a') => ({ caregiverId: cg, clientId: 'c', start })
    const visits = [v('08:00'), v('09:50'), v('05:00'), v('08:30', 'b')]
    const out = missedVisits(visits, (x) => x.caregiverId === 'b', 10 * 60, 15)
    expect(out.map((x) => x.start)).toEqual(['08:00'])          // 09:50 is inside its grace, 05:00 too old, b arrived
  })
  test('the overtime a bonus adds: ½ × bonus ÷ hours per overtime hour, all of it per double-time hour; none without overtime', () => {
    const weeks = [{ weekStart: '2026-11-01', hours: 50, overtimeHours: 10, doubleTimeHours: 0 }, { weekStart: '2026-11-08', hours: 30, overtimeHours: 0 }]
    expect(bonusOvertimeCents(weeks, [{ date: '2026-11-03', cents: 5000 }])).toBe(500)       // $50 / 50 h = $1; ½ × $1 × 10 h = $5
    expect(bonusOvertimeCents(weeks, [{ date: '2026-11-09', cents: 5000 }])).toBe(0)         // that week had no overtime
    expect(bonusOvertimeCents([{ weekStart: '2026-11-01', hours: 50, overtimeHours: 8, doubleTimeHours: 2 }], [{ date: '2026-11-07', cents: 10000 }])).toBe(1200)  // $2 × (0.5 × 8 + 2)
  })
})

describe('row 7: the caregiver who has not arrived', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let companyId = ''
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  const texts: any[] = []
  const TZ = 'America/Chicago'
  const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
  const json = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json() as any } }
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
  const BASE = ['contacts', 'scheduling', 'team']
  // a one-time visit starting `ago` minutes ago on the agency's clock (the schedule stores the agency's wall-clock time)
  const visitAgo = async (ago: number, caregiverId: string, clientId: string) => {
    const at = new Date(Date.now() - ago * 60_000)
    const day = ymdIn(at, TZ), hm = hmsIn(at, TZ).slice(0, 5)
    return (await ins(t.schema.schedules, { companyId, caregiverId, clientId, scheduleType: 'one-time', date: day, startTime: new Date(`${day}T${hm}:00`), endTime: new Date(`${day}T${hm}:00`) , isActive: true })).id
  }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'homecare' })
    ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
    const seeded = await seedOwner(t)
    companyId = seeded.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, settings: { familyTexts: { quietHoursStart: '03:00', quietHoursEnd: '03:01' } } } as any).where(eq(t.schema.company.id, companyId))
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()) as any).accessToken
    const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
    for (const who of ['ann', 'bob']) ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who, lastName: 'Carer', role: 'caregiver', companyId, phone: who === 'ann' ? '608-555-0101' : '608-555-0102' })).id
    ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true })).id
    await ins(t.schema.familyMembers, { companyId, clientId: ids.pat, name: 'Mary Client', email: 'mary@family.example', phone: '608-555-0111', visitTextOptIn: true, isActive: true, passwordHash: hash })
    await ins(t.schema.noshowAlertConfig, { companyId, graceMinutes: 15, notifyAdmin: true, notifyCaregiver: true, notifyClientFamily: true, isActive: true })
    ids.annVisit = await visitAgo(30, ids.ann, ids.pat)       // Ann is 30 minutes late, no clock-in
    ids.bobVisit = await visitAgo(40, ids.bob, ids.pat)       // Bob clocked in
    await ins(t.schema.timeEntries, { companyId, caregiverId: ids.bob, clientId: ids.pat, startTime: new Date(Date.now() - 38 * 60_000), isComplete: false })
    await setFeatures(BASE)
  }, 90_000)

  test('without the feature "Run check" checks nothing, as before', async () => {
    expect((await json(as('owner')('/api/no-show/run-check', { method: 'POST' }))).body).toEqual({ checked: 0, alertsCreated: 0 })
  })

  test('with it: one alert for the visit nobody arrived at, the office, caregiver and family told; a second run alerts nothing', async () => {
    await setFeatures([...BASE, 'care_no_arrival'])
    texts.length = 0
    const r = await json(as('owner')('/api/no-show/run-check', { method: 'POST' }))
    expect(r.body).toMatchObject({ alertsCreated: 1 })
    const alerts = (await json(as('owner')('/api/no-show/alerts'))).body.data as any[]
    expect(alerts.map((a: any) => a.caregiverId ?? a.caregiver_id)).toEqual([ids.ann])
    expect(texts.map((m) => m.toPhone).sort()).toEqual(['+16085550101', '+16085550111'])
    const notes = (await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.companyId, companyId))) as any[]
    expect(notes.some((n) => n.type === 'noshow_alert' && n.title === 'A caregiver has not arrived')).toBe(true)
    expect((await json(as('owner')('/api/no-show/run-check', { method: 'POST' }))).body.alertsCreated).toBe(0)
    // the background scan uses the same rule and the same once-only row
    const core = createHomecareCore({ services: t.services.crm } as any)
    expect(await core.noArrival.scanAll()).toBe(0)
  })

  test('the family portal is an installable app: its service worker shows notices and caches nothing; off without care_family_comms', async () => {
    expect((await t.call('/api/family-app/sw.js')).status).toBe(404)
    await setFeatures([...BASE, 'care_no_arrival', 'care_family_comms'])
    const sw = await t.call('/api/family-app/sw.js')
    expect(sw.status).toBe(200)
    expect(sw.headers.get('service-worker-allowed')).toBe('/family')
    const code = await sw.text()
    expect(code).toContain("addEventListener('push'")
    expect(code).not.toContain("addEventListener('fetch'")
    const m = await (await t.call('/api/family-app/manifest.webmanifest')).json() as any
    expect(m).toMatchObject({ start_url: '/family', scope: '/family', display: 'standalone' })
    expect(m.icons[0]).toMatchObject({ src: '/api/family-app/icon.svg', type: 'image/svg+xml' })
    expect((await (await t.call('/api/family-app/icon.svg')).text()).startsWith('<svg')).toBe(true)
  })

  test('switched off in the No-Show settings: nothing is checked', async () => {
    await t.db.update(t.schema.noshowAlertConfig).set({ isActive: false } as any).where(eq(t.schema.noshowAlertConfig.companyId, companyId))
    expect((await json(as('owner')('/api/no-show/run-check', { method: 'POST' }))).body).toEqual({ checked: 0, alertsCreated: 0 })
  })
})
