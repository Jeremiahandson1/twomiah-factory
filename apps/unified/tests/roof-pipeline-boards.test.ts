// Roofing parity row 19 — a company's own pipeline boards (JobNimbus boards; server/crm/roof/pipeline.ts; pipeline_custom_boards, not
// ready). Fails without the change: a company had the two fixed boards only.
//   · any number of boards, each a name, colour, job types and filters (assignee, rep, location, subcontractor) — the matching rule;
//   · visibility: everyone, just its owner, or chosen roles; a field seat may make a "just me" board only, and change only its own;
//   · off: the routes are shut; the stage names keep their own switch.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { boardMatches, boardVisibleTo } from '../server/crm/roof/pipeline.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let field = ''
let fieldId = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const as = (token: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['pipeline_custom_boards'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const password = 'Correct-horse-1'
  fieldId = ((await t.db.insert(t.schema.user).values({ companyId, email: 'rep@test.example', firstName: 'Rae', lastName: 'Rep', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') } as any).returning()) as any[])[0].id
  field = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'rep@test.example', password } })).json()).accessToken
}, 120_000)

describe('row 19: the rules', () => {
  test('a job is on a board when it matches every filter set; visibility', () => {
    const b = { jobTypes: ['insurance'], filters: { salesRepId: ['u1', 'u2'] } }
    expect(boardMatches(b, { jobType: 'insurance', assignedSalesRepId: 'u2' })).toBe(true)
    expect(boardMatches(b, { jobType: 'retail', assignedSalesRepId: 'u2' })).toBe(false)
    expect(boardMatches(b, { jobType: 'insurance', assignedSalesRepId: null })).toBe(false)
    expect(boardMatches({ jobTypes: [], filters: {} }, { jobType: 'retail' })).toBe(true)
    expect(boardMatches({ jobTypes: [], filters: { locationId: ['L1'] } }, { locationId: 'L1' })).toBe(true)
    expect(boardMatches({ jobTypes: [], filters: { subcontractorId: ['S1'] } }, { subcontractorId: 'S2' })).toBe(false)
    expect(boardVisibleTo({ visibility: 'me', roles: [], ownerId: 'a' }, { userId: 'b', role: 'admin' })).toBe(false)
    expect(boardVisibleTo({ visibility: 'roles', roles: ['field'], ownerId: 'a' }, { userId: 'b', role: 'field' })).toBe(true)
    expect(boardVisibleTo({ visibility: 'roles', roles: ['field'], ownerId: 'a' }, { userId: 'b', role: 'manager' })).toBe(false)
  })
})

describe('row 19: boards', () => {
  test('the office makes boards for everyone or roles; a field seat a “just me” one only; each sees what it may', async () => {
    const all = await json(await as(owner, '/api/roof-pipeline/boards', { method: 'POST', json: { name: 'Storm season', color: '#2563eb', jobTypes: ['insurance'], filters: { salesRepId: [fieldId] }, visibility: 'all' } }))
    expect(all.status).toBe(201)
    expect(all.body).toMatchObject({ name: 'Storm season', color: '#2563eb', jobTypes: ['insurance'], filters: { salesRepId: [fieldId] }, visibility: 'all' })
    const managers = await json(await as(owner, '/api/roof-pipeline/boards', { method: 'POST', json: { name: 'Managers only', visibility: 'roles', roles: ['manager'] } }))
    expect(managers.status).toBe(201)
    expect((await as(owner, '/api/roof-pipeline/boards', { method: 'POST', json: { name: 'No roles', visibility: 'roles', roles: [] } })).status).toBe(400)
    expect((await as(owner, '/api/roof-pipeline/boards', { method: 'POST', json: { name: '' } })).status).toBe(400)

    expect((await as(field, '/api/roof-pipeline/boards', { method: 'POST', json: { name: 'Mine', visibility: 'all' } })).status).toBe(403)
    const mine = await json(await as(field, '/api/roof-pipeline/boards', { method: 'POST', json: { name: 'My leads', visibility: 'me', filters: { salesRepId: [fieldId] } } }))
    expect(mine.status).toBe(201)

    const seenByField = (await json(await as(field, '/api/roof-pipeline/boards'))).body.data.map((b: any) => b.name)
    expect(seenByField).toEqual(['Storm season', 'My leads'])
    const seenByOwner = (await json(await as(owner, '/api/roof-pipeline/boards'))).body.data.map((b: any) => b.name)
    expect(seenByOwner).toEqual(['Storm season', 'Managers only'])

    // The field seat changes its own board, not the office's.
    const fieldView = (await json(await as(field, '/api/roof-pipeline/boards'))).body.data
    expect(fieldView.find((b: any) => b.name === 'Storm season').mayEdit).toBe(false)
    expect((await as(field, `/api/roof-pipeline/boards/${all.body.id}`, { method: 'PUT', json: { name: 'Hijack', visibility: 'me' } })).status).toBe(403)
    expect((await as(field, `/api/roof-pipeline/boards/${mine.body.id}`, { method: 'PUT', json: { name: 'My hot leads', visibility: 'me' } })).status).toBe(200)
    expect((await as(field, `/api/roof-pipeline/boards/${mine.body.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await as(owner, `/api/roof-pipeline/boards/${managers.body.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  test('off: the boards are shut, and the stage names keep their own switch; the switch is hidden and roofing’s', async () => {
    await setFeatures([])
    try {
      expect([403, 404]).toContain((await as(owner, '/api/roof-pipeline/boards')).status) // the mount's switch gate (403) or the route's (404)
    } finally { await setFeatures(['pipeline_custom_boards']) }
    // Boards on, stage names off: the names route stays shut.
    expect((await as(owner, '/api/roof-pipeline')).status).toBe(404)
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'pipeline_custom_boards') as any
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm-roof']])
  })
})
