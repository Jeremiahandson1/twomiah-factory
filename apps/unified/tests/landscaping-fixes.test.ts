// Four landscaping defects the move found in the template, fixed in the unified app (CUTOVER_LEDGER step 3e):
// a property on a route could be deleted and silently take the crew's stops with it; changing or deleting a rate left
// no audit row; removing a stop ignored which route it was asked from; and every job was stored as a 'repair' (T58).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token: string
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'recurring_routes', 'area_pricing', 'snow_billing'] }).where(eq(t.schema.company.id, s.company.id))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
})

async function routeWithStop() {
  const ct = await (await as('/api/contacts', { method: 'POST', json: { name: 'Pat Green', type: 'client' } })).json()
  const site = await (await as('/api/sites', { method: 'POST', json: { name: 'Pat\'s yard', contactId: ct.id } })).json()
  const route = await (await as('/api/recurring-routes', { method: 'POST', json: { name: 'Tuesday north', dayOfWeek: 2 } })).json()
  const stop = await (await as(`/api/recurring-routes/${route.id}/stops`, { method: 'POST', json: { siteId: site.id } })).json()
  return { site, route, stop }
}

describe('landscaping', () => {
  test('a property on a route is not deleted; the refusal names the route, and the stop is still there', async () => {
    const { site, stop } = await routeWithStop()
    const res = await as(`/api/sites/${site.id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('SITE_ON_ROUTES')
    expect(body.error).toContain('Tuesday north')
    expect((await t.db.select().from(t.schema.recurringRouteStop).where(eq(t.schema.recurringRouteStop.id, stop.id))).length).toBe(1)
  })

  test('…nor from the customer\'s page, nor by deleting the customer: every door holds', async () => {
    const { site, stop } = await routeWithStop()
    const fromPage = await as(`/api/contacts/sites/${site.id}`, { method: 'DELETE' })
    expect(fromPage.status).toBe(409)
    expect((await fromPage.json()).error).toContain('1 route stop')
    const customer = await as(`/api/contacts/${site.contactId}`, { method: 'DELETE' })
    expect(customer.status).toBe(409)
    expect((await customer.json()).error).toContain('1 route stop on their properties')
    expect((await t.db.select().from(t.schema.recurringRouteStop).where(eq(t.schema.recurringRouteStop.id, stop.id))).length).toBe(1)
  })

  test('a customer with a bare property and nothing on it can still go', async () => {
    const ct = await (await as('/api/contacts', { method: 'POST', json: { name: 'Gone Soon', type: 'client' } })).json()
    expect((await as('/api/sites', { method: 'POST', json: { name: 'Empty lot', contactId: ct.id } })).status).toBe(201)
    expect((await as(`/api/contacts/${ct.id}`, { method: 'DELETE' })).status).toBeLessThan(300)
  })

  test('a stop is removed only from the route it is on', async () => {
    const a = await routeWithStop()
    const other = await (await as('/api/recurring-routes', { method: 'POST', json: { name: 'Friday south', dayOfWeek: 5 } })).json()
    expect((await as(`/api/recurring-routes/${other.id}/stops/${a.stop.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await t.db.select().from(t.schema.recurringRouteStop).where(eq(t.schema.recurringRouteStop.id, a.stop.id))).length).toBe(1)
    expect((await as(`/api/recurring-routes/${a.route.id}/stops/${a.stop.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await t.db.select().from(t.schema.recurringRouteStop).where(eq(t.schema.recurringRouteStop.id, a.stop.id))).length).toBe(0)
  })

  test('changing and deleting a rate are in the audit log', async () => {
    const rate = await (await as('/api/area-pricing/rates', { method: 'POST', json: { serviceType: 'Mowing', ratePer1000Sqft: 4 } })).json()
    expect((await as(`/api/area-pricing/rates/${rate.id}`, { method: 'PUT', json: { ratePer1000Sqft: 5 } })).status).toBe(200)
    expect((await as(`/api/area-pricing/rates/${rate.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await as(`/api/area-pricing/rates/${rate.id}`, { method: 'DELETE' })).status).toBe(404)
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, rate.id))
    expect(rows.map((r: any) => r.action).sort()).toEqual(['create', 'delete', 'update'])
  })

  test('a landscaping job is not stored as a repair (T58)', async () => {
    const ct = await (await as('/api/contacts', { method: 'POST', json: { name: 'Lee Moss', type: 'client' } })).json()
    const res = await as('/api/jobs', { method: 'POST', json: { title: 'Spring cleanup', contactId: ct.id } })
    expect(res.status).toBe(201)
    const job = await res.json()
    const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, job.id))
    expect(row.jobType).not.toBe('repair')
  })
})
