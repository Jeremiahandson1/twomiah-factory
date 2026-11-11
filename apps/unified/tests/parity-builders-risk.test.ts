// Parity tier 3 (11/10, contractor): a project's square footage — price and budget per square foot — and its builder's risk policy.
// Through the real server as the contractor:
//   · set and cleared; per square foot from the estimated value and the budget; the money only for a seat that sees project money;
//   · the policy validated (ends after it starts) and flagged near its end, or ended while the project is open;
//   · switched off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { policyStanding } from '../server/crm/projects/projectDetails.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', proj = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['projects', 'builders_risk'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  proj = ((await (t.db as any).insert(t.schema.project).values({ companyId, number: 'PRJ-1', name: 'New house', estimatedValue: '450000', budget: '360000', status: 'active' }).returning())[0]).id
}, 120_000)

test('the policy standing', () => {
  const today = new Date('2026-11-10T12:00:00Z')
  expect(policyStanding({ endsOn: '2026-12-01' }, true, today)).toBe('ending_soon')
  expect(policyStanding({ endsOn: '2027-06-01' }, true, today)).toBe('ok')
  expect(policyStanding({ endsOn: '2026-11-01' }, true, today)).toBe('ended')
  expect(policyStanding({ endsOn: '2026-11-01' }, false, today)).toBe('ok')
  expect(policyStanding(null, true, today)).toBeNull()
})

test('square feet gives price and budget per square foot', async () => {
  const r = await json(await call(`/api/project-details/${proj}`, { method: 'PUT', json: { squareFeet: 3000 } }))
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ squareFeet: 3000, perSquareFoot: { price: 150, budget: 120 }, buildersRisk: null })
})

test("the builder's risk policy: validated, saved, cleared", async () => {
  expect((await call(`/api/project-details/${proj}`, { method: 'PUT', json: { buildersRisk: { carrier: 'Acme Mutual', startsOn: '2027-01-10', endsOn: '2027-01-01' } } })).status).toBe(400)
  const r = await json(await call(`/api/project-details/${proj}`, { method: 'PUT', json: { buildersRisk: { carrier: 'Acme Mutual', policyNumber: 'BR-889', coverage: 450000, startsOn: '2026-10-01', endsOn: '2099-12-31' } } }))
  expect(r.body.buildersRisk).toMatchObject({ carrier: 'Acme Mutual', policyNumber: 'BR-889', coverage: 450000 })
  expect(r.body.policyStanding).toBe('ok')
  expect(r.body.squareFeet).toBe(3000)
  const cleared = await json(await call(`/api/project-details/${proj}`, { method: 'PUT', json: { buildersRisk: null } }))
  expect(cleared.body.buildersRisk).toBeNull()
})

test('switched off: closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['projects'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await call(`/api/project-details/${proj}`)).status)
})
