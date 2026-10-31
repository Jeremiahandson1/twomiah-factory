// Home care parity row 20 (docs/parity/homecare-payroll.md): travel and mileage finished — a per-visit travel flag and a separate
// travel rate; travel from the gap, from the clients' addresses or from the GPS clock-out / clock-in points, editable, rounded;
// driving distance between visits carried into payroll; a per-caregiver mileage rate; travel miles apart from errand miles;
// mileage worked out between completed visits' addresses (the map service behind GOOGLE_MAPS_API_KEY, else the estimate); and
// the pay run's mileage line. Behind care_payroll_rules.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { distanceTransport, estimateLeg, toPoint, clearDistanceCache, type Point } from '../server/crm/homecare/core/distance.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}` }, ...(body !== undefined ? { json: body } : {}) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* a file */ }
  return { status: r.status, body: parsed, text }
}
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const BASE = ['contacts', 'scheduling', 'team']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const WED = '2026-11-04'
const calc = async (start = WED, end = WED) => (await send('owner', 'POST', '/api/payroll/calculate', { startDate: start, endDate: end })).body.payroll.find((l: any) => l.caregiverId === ids.ann)
const rules = (travel: any) => send('owner', 'PUT', '/api/pay-rules', { state: null, overtimeRule: 'federal', travel })
const originalLeg = distanceTransport.leg
const legCalls: Array<[Point, Point]> = []
// Alma, Ben and Ann's home: three points near Madison, WI; the "map" answers 6 miles / 12 minutes for any pair
const ALMA = { lat: 43.0731, lng: -89.4012 }, BEN = { lat: 43.1, lng: -89.35 }, HOME = { lat: 43.05, lng: -89.45 }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', mileageRate: '0.67' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId, defaultPayRate: '20.00', latitude: String(HOME.lat), longitude: String(HOME.lng) })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.a = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true, latitude: String(ALMA.lat), longitude: String(ALMA.lng) })).id
  ids.b = (await ins(t.schema.clients, { companyId, firstName: 'Ben', lastName: 'Baker', isActive: true, latitude: String(BEN.lat), longitude: String(BEN.lng) })).id
  // the punches: Alma's clock-out point and Ben's clock-in point are not the clients' own points
  ids.teA = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.a, startTime: new Date(`${WED}T15:00:00Z`), endTime: new Date(`${WED}T17:00:00Z`), durationMinutes: 120, isComplete: true, clockInLocation: ALMA, clockOutLocation: { lat: 43.08, lng: -89.4 } })).id
  ids.teB = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.b, startTime: new Date(`${WED}T17:30:00Z`), endTime: new Date(`${WED}T20:30:00Z`), durationMinutes: 180, isComplete: true, clockInLocation: { latitude: 43.09, longitude: -89.36 }, clockOutLocation: BEN })).id
  const review = (clientId: string, timeEntryId: string, start: string, end: string, minutes: number, extra: any = {}) =>
    ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId, timeEntryId, shiftDate: WED, payableMinutes: minutes, status: 'verified', actualStart: new Date(`${WED}T${start}:00Z`), actualEnd: new Date(`${WED}T${end}:00Z`), ...extra })
  ids.rA = (await review(ids.a, ids.teA, '15:00', '17:00', 120)).id   // 9–11 Chicago at Alma
  ids.rB = (await review(ids.b, ids.teB, '17:30', '20:30', 180)).id   // 11:30–14:30 at Ben: a 30-minute gap
  await setFeatures([...BASE, 'care_payroll_rules'])
  distanceTransport.leg = async (a, b) => { legCalls.push([a, b]); return { miles: 6, minutes: 12, source: 'map' } }
}, 90_000)
afterAll(() => { distanceTransport.leg = originalLeg })

describe('row 20 — travel', () => {
  test('a separate travel rate: travel hours are paid at it and shown apart; the week blends the rates', async () => {
    await rules({ enabled: true, method: 'gap', rateCents: 1500 })
    const line = await calc()
    expect(line).toMatchObject({ travelHours: 0.5, travelRate: 15, travelPay: 7.5, regularHours: 5.5 })
    // 5 h × $20 + 0.5 h × $15
    expect(line.regularPay).toBe(107.5)
    expect(line.blendedRate).toBe(Math.round((10750 * 60) / 330) / 100)
    expect(line.hours.find((h: any) => h.kind === 'travel')).toMatchObject({ rateCents: 1500, minutes: 30, reviewId: ids.rB })
    await rules({ rateCents: null })
    expect((await calc()).travelPay).toBe(10)
  })

  test('the per-visit flag overrides the rule either way, and the office can type the minutes', async () => {
    await rules({ enabled: true, method: 'gap', maxGapMinutes: 60, capMinutes: 30 })
    expect((await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelPaid: false })).status).toBe(200)
    expect((await calc()).travelHours).toBe(0)
    // a gap longer than the limit is still paid, up to the cap, when the visit is flagged
    await rules({ maxGapMinutes: 10 })
    await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelPaid: null })
    expect((await calc()).travelHours).toBe(0)
    await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelPaid: true })
    expect((await calc()).travelHours).toBe(0.5)
    await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelMinutes: 20 })
    expect((await calc()).travelHours).toBe(Math.round((20 / 60) * 100) / 100)
    expect((await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelMinutes: 500 })).body.code).toBe('bad_travel')
    expect((await send('ann', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelMinutes: 5 })).status).toBe(403)
    await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.rB}`, { travelMinutes: null, travelPaid: null })
    await rules({ maxGapMinutes: 60 })
  })

  test("travel estimated from the clients' addresses: the map's minutes, rounded up to the agency's step, within the gap and the cap, with the miles", async () => {
    legCalls.length = 0
    await rules({ enabled: true, method: 'addresses', roundToMinutes: 1, capMinutes: 30, maxGapMinutes: 60 })
    let line = await calc()
    expect(line).toMatchObject({ travelHours: 0.2, travelLegMiles: 6 })
    expect(legCalls.at(-1)).toEqual([ALMA, BEN])
    await rules({ roundToMinutes: 15 })
    expect((await calc()).travelHours).toBe(0.25)
    // the estimate never exceeds the real gap (30 minutes) nor the cap
    await rules({ roundToMinutes: 1, capMinutes: 10 })
    expect((await calc()).travelHours).toBe(Math.round((10 / 60) * 100) / 100)
    // from home to the first visit of the day, when the agency pays it
    await rules({ capMinutes: 30, fromHome: true })
    line = await calc()
    expect(line.travelHours).toBe(0.4)
    expect(line.hours.filter((h: any) => h.kind === 'travel').map((h: any) => h.reviewId)).toEqual([ids.rA, ids.rB])
    expect(legCalls.some(([a]) => a.lat === HOME.lat)).toBe(true)
    await rules({ fromHome: false })
  })

  test('travel from the GPS clock-out and clock-in points instead of the scheduled addresses', async () => {
    legCalls.length = 0
    await rules({ enabled: true, method: 'gps' })
    expect((await calc()).travelHours).toBe(0.2)
    expect(legCalls.at(-1)).toEqual([{ lat: 43.08, lng: -89.4 }, { lat: 43.09, lng: -89.36 }])
  })

  test('without a map service the estimate is the straight line × 1.3 at 30 mph, and it says so', async () => {
    distanceTransport.leg = async () => null
    clearDistanceCache()
    await rules({ enabled: true, method: 'addresses' })
    const est = estimateLeg(ALMA, BEN)
    expect(est.source).toBe('estimate')
    expect(est.miles).toBeGreaterThan(3)
    expect((await calc()).travelLegMiles).toBe(est.miles)
    distanceTransport.leg = async (a, b) => { legCalls.push([a, b]); return { miles: 6, minutes: 12, source: 'map' } }
    clearDistanceCache()
    expect(toPoint({ latitude: '43.1', longitude: '-89.35' })).toEqual({ lat: 43.1, lng: -89.35 })
    expect(toPoint({ lat: 0, lng: 0 })).toBeNull()
  })
})

describe('row 20 — mileage', () => {
  test('mileage between completed visits\' addresses is recorded once, named for the visit reached, at the caregiver\'s own rate', async () => {
    await rules({ enabled: false })
    expect((await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/pay-profile`, { mileageRate: '0.50' })).status).toBe(200)
    expect((await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/pay-profile`, { mileageRate: '9' })).body.code).toBe('bad_rate')
    const first = await send('owner', 'POST', '/api/pay-rules/mileage/compute', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(first.status).toBe(200)
    expect(first.body.trips).toEqual([expect.objectContaining({ reviewId: ids.rB, miles: 6, source: 'map', from: 'Alma Able', to: 'Ben Baker' })])
    expect(first.body.mapService).toBe('map')
    const again = await send('owner', 'POST', '/api/pay-rules/mileage/compute', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(again.body.trips.length).toBe(1)
    const rows = await t.db.select().from(t.schema.mileageEntries).where(and(eq(t.schema.mileageEntries.companyId, companyId), eq(t.schema.mileageEntries.caregiverId, ids.ann)))
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ kind: 'travel', source: 'map', reviewId: ids.rB, miles: '6.00', ratePerMile: '0.500', amount: '3.00' })
    expect((await send('ann', 'POST', '/api/pay-rules/mileage/compute', { startDate: '2026-11-01', endDate: '2026-11-07' })).status).toBe(403)
  })

  test('a visit without a punch is not completed: no trip is worked out for it', async () => {
    const r = await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId: ids.a, shiftDate: WED, payableMinutes: 60, status: 'verified', scheduledStart: '16:00:00', scheduledEnd: '17:00:00' })
    const out = await send('owner', 'POST', '/api/pay-rules/mileage/compute', { startDate: WED, endDate: WED })
    expect(out.body.trips.map((x: any) => x.reviewId)).toEqual([ids.rB])
    await t.db.delete(t.schema.payrollShiftReviews).where(eq(t.schema.payrollShiftReviews.id, r.id))
  })

  test('travel miles and errand miles are kept apart; the pay run\'s mileage line is each trip at its own rate', async () => {
    // an errand for Ben, 10 miles, recorded by the office: at Ann's $0.50
    const errand = await send('owner', 'POST', '/api/mileage', { caregiverId: ids.ann, clientId: ids.b, date: WED, miles: 10, kind: 'errand', startLocation: 'Pharmacy', endLocation: "Ben's" })
    expect(errand.status).toBe(201)
    expect(errand.body).toMatchObject({ kind: 'errand', ratePerMile: '0.500', amount: '5.00' })
    const line = await calc()
    expect(line).toMatchObject({ totalMiles: 16, travelMiles: 6, errandMiles: 10, mileageReimbursement: 8 })
    expect(line.grossPay).toBe(Math.round((line.wagesPay + 8) * 100) / 100)
    // the office's list shows each trip's kind
    const listed = await send('owner', 'GET', `/api/mileage?caregiverId=${ids.ann}`)
    expect(listed.body.data.map((x: any) => x.kind).sort()).toEqual(['errand', 'travel'])
    // without their own rate the agency's applies
    await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/pay-profile`, { mileageRate: null })
    const plain = await send('ann', 'POST', '/api/mileage', { date: '2026-11-05', miles: 2 })
    expect(plain.body).toMatchObject({ kind: 'travel', ratePerMile: '0.670' })
  })

  test('driving distance between visits is carried into payroll when the pay run is made (the setting)', async () => {
    await t.db.delete(t.schema.mileageEntries).where(eq(t.schema.mileageEntries.reviewId, ids.rB))
    expect((await calc()).travelMiles).toBe(0)
    await rules({ enabled: true, method: 'addresses', mileageFromVisits: true })
    const line = await calc()
    expect(line).toMatchObject({ travelMiles: 6, travelLegMiles: 6 })
    const rows = await t.db.select().from(t.schema.mileageEntries).where(eq(t.schema.mileageEntries.reviewId, ids.rB))
    expect(rows.length).toBe(1)
    expect(rows[0].source).toBe('map')
  })

  test('without the feature nothing new is paid: no travel, the agency rate, miles as entered', async () => {
    await setFeatures(BASE)
    const line = await calc()
    expect(line.travelHours).toBe(0)
    expect(line.travelLegMiles).toBeUndefined()
    expect(line.travelMiles).toBe(0)
    expect(line.mileageReimbursement).toBe(Math.round(line.totalMiles * 0.67 * 100) / 100)
    await setFeatures([...BASE, 'care_payroll_rules'])
  })
})
