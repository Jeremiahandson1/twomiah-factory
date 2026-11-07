// The own-it licence from a CRM's Billing page (salon live test 11/07): GET /customers/:id/license and POST …/license-checkout are the
// tenant's calls, made with its X-Factory-Key — but the Factory's gate (routes/factory.ts) asked every path not on its list for a staff
// sign-in first, and these two were never on it: every CRM's Billing page said "The licence could not be reached". Now the gate lets them
// through to their own key check (lifecycle.ts), as it does the subscription and portal-link calls beside them; a wrong key is still 401,
// and the admin-only license checkout under /checkout/license still needs staff.
import { test, expect, beforeEach } from 'bun:test'
import { stubAuth } from './stubs.ts'
import { sharedFactoryDb } from './fakeStore.ts'

const supabase = sharedFactoryDb
const STAFF_ONLY = { status: 401, error: 'Missing Authorization header' }
// No staff session anywhere: what a tenant's server-to-server call looks like to the gate.
stubAuth({ supabase, authenticate: async (c: any) => c.json({ error: STAFF_ONLY.error }, 401), requireRole: () => async (c: any) => c.json({ error: 'Forbidden' }, 403) })
const A = '11111111-1111-4111-8111-111111111111'
const factory = (await import('../../../apps/api/src/routes/factory.ts')).default

beforeEach(() => {
  supabase.tables.tenants = [{ id: A, slug: 'acme', name: 'Acme', engine: 'unified', plan: 'starter', factory_sync_key: 'key-a', render_backend_url: 'https://acme-app.onrender.com' }]
})
const call = async (method: string, p: string, key: string | null, body?: unknown) => {
  const r = await factory.request(p, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Factory-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await r.text()
  return { status: r.status, text }
}

test('the tenant\'s licence calls reach their own key check, past the staff gate', async () => {
  const offer = await call('GET', `/customers/${A}/license`, 'key-a')
  expect(offer.text).not.toContain(STAFF_ONLY.error)
  expect(offer.status).not.toBe(401)
  const checkout = await call('POST', `/customers/${A}/license-checkout`, 'key-a', { githubUsername: 'x' })
  expect(checkout.text).not.toContain(STAFF_ONLY.error)
})

test('a wrong key is still refused — by the route\'s own check', async () => {
  const r = await call('GET', `/customers/${A}/license`, 'key-wrong')
  expect(r.status).toBe(401)
  expect(r.text).not.toContain(STAFF_ONLY.error)
})

test('the admin-only licence checkout still needs staff', async () => {
  const r = await call('POST', `/customers/${A}/checkout/license`, 'key-a', {})
  expect([r.status, r.text.includes(STAFF_ONLY.error)]).toEqual([401, true])
})
