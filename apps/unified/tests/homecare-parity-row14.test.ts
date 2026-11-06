// Home care parity row 14 (docs/parity/homecare-matching.md), on top of item 5 (homecare-depth-matching.test.ts), behind care_match_prefs:
//   · a client can need certifications (matched to the caregiver's unexpired certification records) and say things about the home
//     (pets, smoking) that a caregiver may avoid; a caregiver can set how far they will travel;
//   · a need the client marks as a MUST-HAVE is a hard filter (AxisCare): a caregiver who misses it is not suggested (unless blocked
//     ones are asked for), not auto-filled, not shown the open shift and cannot claim it (WellSky: shifts they qualify for);
//   · suggestions can be narrowed to a department and ordered by seniority (AlayaCare's Employee Finder).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { matchTraits, normMustHave } from '../server/crm/homecare/core/matchTraits.ts'
import { ymdIn } from '../server/crm/homecare/core/agencyTime.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const TZ = 'America/Chicago'
const day = (offset: number) => ymdIn(new Date(Date.now() + offset * 86_400_000), TZ)
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
const WHEN = () => `date=${day(3)}&startTime=09:00&endTime=11:00`
const suggest = async (extra = '') => (await json(as('owner')(`/api/scheduling/suggest-caregivers?clientId=${ids.pat}&${WHEN()}${extra}`))).body
const names = (b: any) => b.suggestions.map((s: any) => s.firstName)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  // Ann: valid CNA, near, in Home Health, hired 2018. Bob: no CNA, in Companion, hired 2024. Cy: CNA expired, avoids pets, will travel 2 miles.
  const people: Array<[string, any]> = [['ann', { hireDate: '2018-03-01', latitude: '44.8113', longitude: '-91.4985' }], ['bob', { hireDate: '2024-06-01', latitude: '44.8200', longitude: '-91.5000' }], ['cy', { hireDate: '2021-01-15', latitude: '44.9500', longitude: '-91.4000' }]]
  for (const [who, extra] of people) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, ...extra })).id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  await ins(t.schema.caregiverProfiles, { companyId, caregiverId: ids.ann, department: 'Home Health' })
  await ins(t.schema.caregiverProfiles, { companyId, caregiverId: ids.bob, department: 'Companion' })
  await ins(t.schema.caregiverProfiles, { companyId, caregiverId: ids.cy, department: 'Home Health' })
  await ins(t.schema.certificationRecords, { companyId, caregiverId: ids.ann, certificationType: 'CNA', expiryDate: day(365), status: 'active' })
  await ins(t.schema.certificationRecords, { companyId, caregiverId: ids.cy, certificationType: 'CNA', expiryDate: day(-10), status: 'active' })
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, latitude: '44.8113', longitude: '-91.4985' })).id
  await setFeatures(BASE)
}, 90_000)

describe('the rules (pure)', () => {
  test('certifications, the home, the travel limit and must-haves', () => {
    const client = { requiredCertifications: 'CNA', homeAttributes: 'Pets, Smoking', matchMustHave: ['certifications', 'home'] }
    const ok = matchTraits(client, { validCertifications: 'cna, CPR' }, 1)
    expect(ok).toMatchObject({ missingCertifications: [], avoided: [], beyondTravel: false, hardMisses: [] })
    const bad = matchTraits(client, { validCertifications: '', avoidAttributes: 'pets', maxTravelMiles: 5 }, 12.3)
    expect(bad.missingCertifications).toEqual(['CNA'])
    expect(bad.avoided).toEqual(['Pets'])
    expect(bad.beyondTravel).toBe(true)
    expect(bad.hardMisses).toEqual(['Must hold: CNA', 'Avoids: Pets'])
    expect(bad.reasons).toContain('⚠️ Beyond their travel limit (12.3 of 5 mi)')
    // a must-have gender the caregiver has not recorded cannot be confirmed: it keeps them off
    expect(matchTraits({ preferredCaregiverGender: 'female', matchMustHave: ['gender'] }, {}).hardMisses).toEqual(['Must be a female caregiver'])
    // without the must-have, the same misses are only a lower score
    expect(matchTraits({ requiredCertifications: 'CNA' }, {}).hardMisses).toEqual([])
    expect(normMustHave(['home', 'nope', 'home', 'skills'])).toEqual(['home', 'skills'])
  })
})

describe('suggestions, auto-fill and open shifts', () => {
  test('the office saves the new needs and preferences, checked', async () => {
    await setFeatures([...BASE, 'care_match_prefs'])
    const o = as('owner')
    expect((await json(o(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { mustHave: ['everything'] } }))).body.code).toBe('bad_must_have')
    expect((await json(o(`/api/matching/caregiver/${ids.cy}/traits`, { method: 'PUT', json: { maxTravelMiles: 0 } }))).body.code).toBe('bad_travel')
    expect((await json(o(`/api/matching/caregiver/${ids.cy}/traits`, { method: 'PUT', json: { maxTravelMiles: 2, avoid: 'Pets' } }))).status).toBe(200)
    expect((await json(o(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { requiredCertifications: 'CNA', homeAttributes: 'Pets', mustHave: [] } }))).status).toBe(200)
    const prefs = (await json(o(`/api/matching/client/${ids.pat}/match-prefs`))).body
    expect(prefs).toMatchObject({ requiredCertifications: ['CNA'], homeAttributes: ['Pets'], mustHave: [] })
    expect((await json(o(`/api/matching/caregiver/${ids.cy}/traits`))).body).toMatchObject({ maxTravelMiles: 2, avoid: ['Pets'] })
  })

  test('not a must-have yet: everyone is suggested, the misses are marked down with a reason', async () => {
    const b = await suggest()
    expect(b.requiredCertifications).toEqual(['CNA'])
    expect(names(b)[0]).toBe('Ann')
    const cy = b.suggestions.find((s: any) => s.firstName === 'Cy')
    expect(cy.reasons).toEqual(expect.arrayContaining(['⚠️ No valid CNA', '⚠️ Prefers not to work with: Pets']))
    expect(cy.reasons.some((r: string) => r.startsWith('⚠️ Beyond their travel limit'))).toBe(true)
    expect(b.suggestions.find((s: any) => s.firstName === 'Bob').missingCertifications).toEqual(['CNA'])
  })

  test('marked a must-have: a caregiver who misses it is not suggested, unless blocked ones are asked for', async () => {
    await as('owner')(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { mustHave: ['certifications'] } })
    const b = await suggest()
    expect(b.mustHave).toEqual(['certifications'])
    expect(names(b)).toEqual(['Ann'])
    const all = await suggest('&includeBlocked=true')
    const bob = all.suggestions.find((s: any) => s.firstName === 'Bob')
    expect(bob).toMatchObject({ isRequirementMiss: true, hardMisses: ['Must hold: CNA'] })
    expect(bob.reasons).toContain('🚫 Must hold: CNA')
  })

  test('department and seniority narrow and order the list', async () => {
    await as('owner')(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { mustHave: [] } })
    const b = await suggest()
    expect(b.departments).toEqual(['Companion', 'Home Health'])
    expect(names(await suggest('&department=Home%20Health')).sort()).toEqual(['Ann', 'Cy'])
    const bySeniority = await suggest('&sort=seniority')
    expect(names(bySeniority)).toEqual(['Ann', 'Cy', 'Bob'])
    expect(bySeniority.suggestions[0].seniorityYears).toBeGreaterThanOrEqual(8)
  })

  test('auto-fill never places a caregiver who misses a must-have or is beyond their travel limit', async () => {
    await as('owner')(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { mustHave: ['certifications'] } })
    // Ann is busy with another visit then, so only Bob and Cy are left: Bob misses the CNA, Cy's CNA has expired
    ids.annVisit = (await ins(t.schema.schedules, { companyId, clientId: ids.pat, caregiverId: ids.ann, scheduleType: 'one-time', date: day(3), startTime: new Date(`${day(3)}T09:00:00`), endTime: new Date(`${day(3)}T11:00:00`), isActive: true })).id
    ids.shift = (await ins(t.schema.openShifts, { companyId, clientId: ids.pat, date: day(3), startTime: '09:00', endTime: '11:00', status: 'open' })).id
    const r = await json(as('owner')('/api/scheduling/auto-fill', { method: 'POST', json: { startDate: day(0), endDate: day(7), dryRun: true } }))
    const mine = r.body.results.find((x: any) => x.shiftId === ids.shift)
    expect(mine.status).toBe('unfilled')
    expect(mine.candidates.map((x: any) => x.reason).sort()).toEqual(expect.arrayContaining(['Must hold: CNA']))
    await t.db.delete(t.schema.schedules).where(eq(t.schema.schedules.id, ids.annVisit))
    const again = await json(as('owner')('/api/scheduling/auto-fill', { method: 'POST', json: { startDate: day(0), endDate: day(7), dryRun: true } }))
    expect(again.body.results.find((x: any) => x.shiftId === ids.shift)).toMatchObject({ status: 'filled', caregiverId: ids.ann })
  })

  test('a caregiver who misses a must-have does not see the open shift and cannot claim it; one who qualifies can', async () => {
    const seen = async (who: string) => (await json(as(who)('/api/open-shifts/available'))).body.data.map((x: any) => x.id)
    expect(await seen('bob')).not.toContain(ids.shift)
    expect(await seen('ann')).toContain(ids.shift)
    const claim = await json(as('bob')(`/api/open-shifts/${ids.shift}/claim`, { method: 'POST', json: {} }))
    expect([claim.status, claim.body.code]).toEqual([403, 'not_qualified'])
  })

  test('without the feature none of it applies', async () => {
    await setFeatures(BASE)
    const b = await suggest()
    expect(names(b).sort()).toEqual(['Ann', 'Bob', 'Cy'])
    expect(b.requiredCertifications).toEqual([])
    expect((await json(as('bob')('/api/open-shifts/available'))).body.data.map((x: any) => x.id)).toContain(ids.shift)
  })
})
