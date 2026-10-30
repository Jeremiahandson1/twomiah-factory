// Home care depth, item 5 (docs/parity/homecare-matching.md): suggested caregivers weigh the skills a client needs, a
// gender preference and a language — and say why, per caregiver. Off (and refused) without care_match_prefs.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { matchTraits, splitList, normGender } from '../server/crm/homecare/core/matchTraits.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
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
const suggest = async () => (await json(await as('owner')(`/api/scheduling/suggest-caregivers?clientId=${ids.pat}&date=2026-12-02&startTime=09:00&endTime=11:00`))).body
const byName = (b: any, name: string) => b.suggestions.find((s: any) => s.firstName === name)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bob', 'cy']) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId })).id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  const other = await ins(t.schema.company, { name: 'Other Care', slug: 'other-care' })
  ids.zed = (await ins(t.schema.clients, { companyId: other.id, firstName: 'Zed', lastName: 'Elsewhere' })).id
  await setFeatures(BASE)
}, 90_000)

describe('home care — matching pure rules (item 5)', () => {
  test('lists, genders, and the factors a client left blank', () => {
    expect(splitList('Dementia care, hoyer lift;  dementia CARE\n')).toEqual(['Dementia care', 'hoyer lift'])
    expect(normGender('F')).toBe('female'); expect(normGender('Man')).toBe('male'); expect(normGender('other')).toBeNull()
    const none = matchTraits({}, { capabilities: 'x', gender: 'male', languages: 'Spanish' })
    expect(none).toMatchObject({ scoreDelta: 0, reasons: [], hasRequiredSkills: true, genderOk: null, languageOk: null })
  })
})

describe('home care — suggested caregivers weigh skills, gender and language (item 5)', () => {
  test('without the feature nothing changes, and the preferences cannot be saved', async () => {
    const put = await json(await as('owner')(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { requiredSkills: ['Dementia care'] } }))
    expect(put.status).toBe(400)
    expect(put.body.code).toBe('match_prefs_not_available')
    const cg = await json(await as('owner')(`/api/matching/caregiver/${ids.ann}/traits`, { method: 'PUT', json: { gender: 'female' } }))
    expect(cg.body.code).toBe('match_prefs_not_available')
    const b = await suggest()
    expect(b.suggestions.length).toBe(3)
    expect(byName(b, 'Ann').hasRequiredSkills).toBe(true)
    expect(byName(b, 'Ann').reasons.some((r: string) => /skill|prefers/i.test(r))).toBe(false)
  })

  test('with it: the office records both sides, and each suggestion says what matched and what did not', async () => {
    await setFeatures([...BASE, 'care_match_prefs'])
    const o = as('owner')
    expect((await json(await o(`/api/matching/caregiver/${ids.ann}/traits`, { method: 'PUT', json: { gender: 'female', languages: ['English', 'Spanish'] } }))).status).toBe(200)
    expect((await json(await o(`/api/matching/caregiver/${ids.ann}/capabilities`, { method: 'PUT', json: { capabilities: ['Dementia care', 'Hoyer lift'] } }))).status).toBe(200)
    expect((await json(await o(`/api/matching/caregiver/${ids.bob}/traits`, { method: 'PUT', json: { gender: 'male' } }))).status).toBe(200)
    expect((await json(await o(`/api/matching/caregiver/${ids.cy}/traits`, { method: 'PUT', json: { gender: 'female', languages: 'English' } }))).status).toBe(200)
    const prefs = await json(await o(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { requiredSkills: 'Dementia care', caregiverGender: 'female', language: 'Spanish' } }))
    expect(prefs.status).toBe(200)
    expect((await json(await o(`/api/matching/client/${ids.pat}/match-prefs`))).body).toMatchObject({ requiredSkills: ['Dementia care'], caregiverGender: 'female', language: 'Spanish' })
    expect((await json(await o(`/api/matching/caregiver/${ids.ann}/traits`))).body).toMatchObject({ gender: 'female', languages: ['English', 'Spanish'], skills: ['Dementia care', 'Hoyer lift'] })

    const b = await suggest()
    expect(b.requiredSkills).toEqual(['Dementia care'])
    const ann = byName(b, 'Ann'), bob = byName(b, 'Bob'), cy = byName(b, 'Cy')
    expect(b.suggestions[0].firstName).toBe('Ann')
    expect(ann).toMatchObject({ hasRequiredSkills: true, missingSkills: [], genderOk: true, languageOk: true })
    expect(ann.reasons).toEqual(expect.arrayContaining(['✓ Has the skills needed (Dementia care)', '✓ Client prefers a female caregiver', '✓ Speaks Spanish']))
    expect(bob).toMatchObject({ hasRequiredSkills: false, missingSkills: ['Dementia care'], genderOk: false, languageOk: null })
    expect(bob.reasons).toEqual(expect.arrayContaining(['⚠️ Missing skill: Dementia care', '⚠️ Client prefers a female caregiver', "Client prefers Spanish — this caregiver's languages are not recorded"]))
    expect(cy).toMatchObject({ hasRequiredSkills: false, genderOk: true, languageOk: false })
    expect(cy.reasons).toContain('⚠️ Client prefers Spanish; this caregiver speaks English')
    // A miss is a warning and a lower score, never a hiding — the office decides.
    expect(b.suggestions.map((s: any) => s.firstName).sort()).toEqual(['Ann', 'Bob', 'Cy'])
    expect(ann.score).toBeGreaterThan(cy.score)
    expect(cy.score).toBeGreaterThan(bob.score)
  })

  test('a bad gender is refused; another company\'s client is not found; blanks clear a preference', async () => {
    const o = as('owner')
    expect((await json(await o(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { caregiverGender: 'purple' } }))).body.code).toBe('bad_gender')
    expect((await json(await o(`/api/matching/caregiver/${ids.ann}/traits`, { method: 'PUT', json: { gender: 'x' } }))).body.code).toBe('bad_gender')
    expect((await json(await o(`/api/matching/client/${ids.zed}/match-prefs`, { method: 'PUT', json: { language: 'French' } }))).status).toBe(404)
    expect((await json(await o(`/api/matching/caregiver/${ids.zed}/traits`, { method: 'PUT', json: { gender: 'male' } }))).status).toBe(404)
    await o(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { requiredSkills: [], caregiverGender: '', language: '' } })
    const b = await suggest()
    expect(byName(b, 'Bob').reasons.some((r: string) => /skill|prefers/i.test(r))).toBe(false)
    await o(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { requiredSkills: 'Dementia care', caregiverGender: 'female', language: 'Spanish' } })
  })

  test('a caregiver cannot read or change any of it, or ask for suggestions', async () => {
    const a = as('ann')
    expect((await a(`/api/matching/client/${ids.pat}/match-prefs`)).status).toBe(403)
    expect((await a(`/api/matching/client/${ids.pat}/match-prefs`, { method: 'PUT', json: { language: 'French' } })).status).toBe(403)
    expect((await a(`/api/matching/caregiver/${ids.ann}/traits`, { method: 'PUT', json: { gender: 'male' } })).status).toBe(403)
    expect((await a(`/api/scheduling/suggest-caregivers?clientId=${ids.pat}`)).status).toBe(403)
  })
})
