// Home care parity row 15: the visit optimizer (care_visit_optimizer), modelled on AlayaCare's Visit Optimizer — pick the vacant
// visits, weigh six objectives (travel time, continuity, skills, waiting between visits, daily and weekly hours), review the
// proposals, then assign the chosen ones in bulk (each checked again at that moment). Nothing changes on a run.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { normWeights, optimize, scoreFor, DEFAULT_WEIGHTS, type OptCandidate } from '../server/crm/homecare/core/visitOptimizer.ts'
import { ymdIn, addDays } from '../server/crm/homecare/core/agencyTime.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const TZ = 'America/Chicago'
// Calendar days on the agency's clock, not 24-hour steps: across a clock change those land a day off late in the evening (11/06).
const day = (offset: number) => addDays(ymdIn(new Date(), TZ), offset)
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json() as any } }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team']
const cand = (id: string, over: Partial<OptCandidate> = {}): OptCandidate => ({ id, name: id, blocked: null, visitsWithClient: 0, traitDelta: 0, traitReasons: [], weeklyHours: 0, maxHours: 40, ...over })

describe('the rules (pure)', () => {
  test('weights: whole numbers 0 to 3, anything else keeps the default', () => {
    expect(normWeights({ travel: 0, skills: 9, continuity: '3' })).toEqual({ ...DEFAULT_WEIGHTS, travel: 0, continuity: 3 })
  })
  test('travel counts from the visit before, waiting is the gap after travel, and the hours add up', () => {
    const s = { id: 's', date: '2026-12-01', start: '13:00', end: '15:00', hours: 2, clientLat: 44.81, clientLng: -91.49 }
    const before = [{ date: '2026-12-01', start: '09:00', end: '12:00', lat: 44.81, lng: -91.49 }]
    const r = scoreFor(s, cand('a', { homeLat: 45.5, homeLng: -92.5, weeklyHours: 30 }), before, 0, DEFAULT_WEIGHTS)
    expect(r.travelMinutes).toBe(0)            // the visit before was at the same place
    expect(r.waitMinutes).toBe(60)
    expect([r.dayHours, r.weekHours]).toEqual([5, 32])
    const fromHome = scoreFor(s, cand('a', { homeLat: 45.5, homeLng: -92.5 }), [], 0, DEFAULT_WEIGHTS)
    expect(fromHome.travelMinutes).toBeGreaterThan(60)
    expect(fromHome.waitMinutes).toBeNull()
  })
  test('the weights decide: continuity first picks the familiar caregiver, travel first the near one', () => {
    const s = { id: 's', date: '2026-12-01', start: '09:00', end: '11:00', hours: 2, clientLat: 44.81, clientLng: -91.49 }
    const cands = [cand('near', { homeLat: 44.81, homeLng: -91.49 }), cand('familiar', { homeLat: 44.95, homeLng: -91.30, visitsWithClient: 10 })]
    const only = (w: any) => optimize([s], () => cands, () => [], normWeights(w))[0].best!.caregiverId
    expect(only({ travel: 3, continuity: 0, skills: 0, waitTime: 0, dailyHours: 0, weeklyHours: 0 })).toBe('near')
    expect(only({ travel: 0, continuity: 3, skills: 0, waitTime: 0, dailyHours: 0, weeklyHours: 0 })).toBe('familiar')
  })
  test('one caregiver is never proposed for two visits at once, and a blocked or maxed-out one never', () => {
    const a = { id: 'a', date: '2026-12-01', start: '09:00', end: '11:00', hours: 2 }
    const b = { id: 'b', date: '2026-12-01', start: '10:00', end: '12:00', hours: 2 }
    const p = optimize([a, b], () => [cand('x'), cand('y', { visitsWithClient: 0, weeklyHours: 39 }), cand('z', { blocked: 'On time off that day' })], () => [], DEFAULT_WEIGHTS)
    expect(p[0].best!.caregiverId).toBe('x')
    expect(p[1].best).toBeNull()
    expect(p[1].unfilledBecause).toEqual(expect.arrayContaining(['Already proposed for a visit then (1)', 'Over their weekly maximum (1)', 'On time off that day (1)']))
  })
})

describe('the optimizer through the server', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'homecare' })
    const seeded = await seedOwner(t)
    companyId = seeded.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, companyId))
    tokens.owner = await login('owner@test.example', seeded.password)
    const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
    for (const [who, lat, lng] of [['ann', '44.8113', '-91.4985'], ['bob', '45.3000', '-92.0000']] as const) {
      ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, latitude: lat, longitude: lng })).id
      tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
    }
    ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, latitude: '44.8113', longitude: '-91.4985' })).id
    ids.s1 = (await ins(t.schema.openShifts, { companyId, clientId: ids.pat, date: day(2), startTime: '09:00', endTime: '11:00', status: 'open' })).id
    ids.s2 = (await ins(t.schema.openShifts, { companyId, clientId: ids.pat, date: day(2), startTime: '10:00', endTime: '12:00', status: 'open' })).id
    await setFeatures(BASE)
  }, 90_000)

  test('without the feature the optimizer is not there', async () => {
    expect((await as('owner')('/api/visit-optimizer/settings')).status).toBe(403)
  })

  test('a run proposes without changing anything; overlapping visits go to different caregivers', async () => {
    await setFeatures([...BASE, 'care_visit_optimizer'])
    const r = await json(as('owner')('/api/visit-optimizer/run', { method: 'POST', json: { startDate: day(0), endDate: day(7) } }))
    expect(r.status).toBe(200)
    const p1 = r.body.proposals.find((p: any) => p.shift.id === ids.s1), p2 = r.body.proposals.find((p: any) => p.shift.id === ids.s2)
    expect(p1.best.caregiverId).toBe(ids.ann)               // the near one, on the default weights
    expect(p2.best.caregiverId).toBe(ids.bob)               // Ann is proposed for the visit that overlaps it
    expect(p1.shift).toMatchObject({ client: 'Pat Client', startTime: '09:00', endTime: '11:00' })
    const still = (await t.db.select().from(t.schema.openShifts).where(eq(t.schema.openShifts.id, ids.s1))) as any[]
    expect(still[0].status).toBe('open')
    expect((await json(as('owner')('/api/visit-optimizer/run', { method: 'POST', json: { startDate: day(0), endDate: day(60) } }))).body.code).toBe('range_too_long')
  })

  test('the agency saves its weights, checked', async () => {
    expect((await json(as('owner')('/api/visit-optimizer/settings', { method: 'PUT', json: { weights: { travel: 7 } } }))).body.code).toBe('bad_weights')
    const ok = await json(as('owner')('/api/visit-optimizer/settings', { method: 'PUT', json: { weights: { travel: 0, continuity: 3 } } }))
    expect(ok.body.weights).toMatchObject({ travel: 0, continuity: 3, skills: DEFAULT_WEIGHTS.skills })
    expect((await json(as('owner')('/api/visit-optimizer/settings'))).body.weights.travel).toBe(0)
  })

  test('assign: the chosen visits are filled; one that went stale is refused in plain words, not forced', async () => {
    // Bob takes time off after the run: his proposal is stale
    await ins(t.schema.caregiverTimeOff, { companyId, caregiverId: ids.bob, startDate: day(2), endDate: day(2), type: 'pto', status: 'approved' })
    const r = await json(as('owner')('/api/visit-optimizer/assign', { method: 'POST', json: { assignments: [{ shiftId: ids.s1, caregiverId: ids.ann }, { shiftId: ids.s2, caregiverId: ids.bob }] } }))
    expect(r.body.assigned).toBe(1)
    expect(r.body.results.find((x: any) => x.shiftId === ids.s2)).toMatchObject({ status: 'refused', reason: 'On time off that day' })
    const [s1] = (await t.db.select().from(t.schema.openShifts).where(eq(t.schema.openShifts.id, ids.s1))) as any[]
    expect(s1.status).toBe('filled')
    const again = await json(as('owner')('/api/visit-optimizer/assign', { method: 'POST', json: { assignments: [{ shiftId: ids.s1, caregiverId: ids.ann }] } }))
    expect(again.body.results[0]).toMatchObject({ status: 'refused', reason: 'This visit is no longer open.' })
  })

  test('a caregiver cannot use it', async () => {
    expect((await as('ann')('/api/visit-optimizer/run', { method: 'POST', json: {} })).status).toBe(403)
  })
})
