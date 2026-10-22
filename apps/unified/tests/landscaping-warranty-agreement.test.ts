// Landscaping live test, 2026-10-22: a warranty could not be created (one came only from a project's templates, and
// landscaping has no projects), and a service agreement could not be cancelled (the server's POST /:id/cancel had no
// button). The Warranties page's New Warranty posts POST /api/warranties for a customer
// (packages/tenant-backend/src/warranties/warranties.ts createProjectWarranty, now checked); the Agreements page's
// Cancel posts POST /api/agreements/:id/cancel.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const ids: Record<string, string> = {}
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'warranties', 'service_agreements'] } as any).where(eq(t.schema.company.id, companyId))
  const [c] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Rae Fields', email: 'rae@test.example' } as any).returning()
  ids.customer = c.id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Lawns', slug: 'other-lawns' }).returning()
  const [stranger] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  ids.stranger = stranger.id
}, 120_000)

describe('a warranty written by hand', () => {
  test('for a customer, with no project: made, listed with the customer, and a claim can be filed on it', async () => {
    const r = await json(await as('/api/warranties', { method: 'POST', json: { contactId: ids.customer, name: '  Plantings — one-year replacement ', category: 'workmanship', startDate: '2026-10-01', durationMonths: 12 } }))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ name: 'Plantings — one-year replacement', projectId: null, contact: { id: ids.customer, name: 'Rae Fields' }, durationMonths: 12 })
    ids.warranty = r.body.id
    const list = await json(await as('/api/warranties'))
    expect(list.body.data.map((w: any) => w.id)).toContain(ids.warranty)
    const claim = await as('/api/warranties/claims', { method: 'POST', json: { warrantyId: ids.warranty, title: 'Shrub died', description: 'The boxwood by the gate' } })
    expect(claim.status).toBe(201)
  })

  test('refused: no name, no customer, a term that is not whole months, a bad start date', async () => {
    const post = (body: any) => as('/api/warranties', { method: 'POST', json: body })
    expect((await post({ contactId: ids.customer, name: '   ' })).status).toBe(400)
    expect((await post({ name: 'Lawn' })).status).toBe(400)
    expect((await post({ contactId: ids.customer, name: 'Lawn', durationMonths: 0 })).status).toBe(400)
    expect((await post({ contactId: ids.customer, name: 'Lawn', durationMonths: 2.5 })).status).toBe(400)
    expect((await post({ contactId: ids.customer, name: 'Lawn', startDate: 'soon' })).status).toBe(400)
  })

  test("another business's customer or project is not found", async () => {
    expect((await as('/api/warranties', { method: 'POST', json: { contactId: ids.stranger, name: 'Lawn' } })).status).toBe(404)
    expect((await as('/api/warranties', { method: 'POST', json: { contactId: ids.customer, projectId: 'nope', name: 'Lawn' } })).status).toBe(404)
  })
})

describe('a service agreement is cancelled', () => {
  test('POST /:id/cancel: the agreement is cancelled', async () => {
    const [a] = await t.db.insert(t.schema.serviceAgreement).values({
      companyId, contactId: ids.customer, number: 'AGR-0001', name: 'Weekly mowing', startDate: new Date('2026-04-01'), amount: '120.00',
    } as any).returning()
    const r = await as(`/api/agreements/${a.id}/cancel`, { method: 'POST', json: {} })
    expect(r.status).toBeLessThan(300)
    const [row] = await t.db.select().from(t.schema.serviceAgreement).where(eq(t.schema.serviceAgreement.id, a.id))
    expect(row.status).toBe('cancelled')
  })
})
