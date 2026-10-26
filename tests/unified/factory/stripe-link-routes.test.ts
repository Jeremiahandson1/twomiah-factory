// The Factory's Stripe-link doors (apps/api routes/factory/stripeOAuth.ts) over a stand-in Factory DB: each tenant call
// needs that tenant's own X-Factory-Key; the start is refused while no client id is set, for a template tenant, and for
// a way back that is not the business's own app; deauthorize cuts only the account recorded for THAT business; and
// Stripe's redirect is carried through to the right business and recorded. Stripe and the business are stand-ins (fetch).
import { test, expect, mock, beforeAll, beforeEach, afterAll, describe } from 'bun:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sharedFactoryDb } from './fakeStore.ts'

const supabase = sharedFactoryDb
mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts'), () => ({ supabase, authenticate: async () => {}, requireRole: () => async () => {} }))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const T = '33333333-3333-4333-8333-333333333333'
const NONCE = 'n'.repeat(43)
const saved: Record<string, string | undefined> = {}
const ENV: Record<string, string> = { STRIPE_CONNECT_CLIENT_ID: 'ca_TEST123', STRIPE_SECRET_KEY: 'sk_test_platform', FACTORY_PUBLIC_URL: 'https://factory.example' }

const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
let app: any
beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v }
  const { registerStripeOAuthRoutes } = await import('../../../apps/api/src/routes/factory/stripeOAuth')
  app = new Hono()
  registerStripeOAuthRoutes(app as any)
})
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })
beforeEach(() => {
  supabase.tables.tenants = [
    { id: A, slug: 'acme', engine: 'unified', render_backend_url: 'https://acme-app.onrender.com', domain: 'acme.com', factory_sync_key: 'key-a', stripe_connect_account_id: null },
    { id: B, slug: 'beta', engine: 'unified', render_backend_url: 'https://beta-app.onrender.com', factory_sync_key: 'key-b', stripe_connect_account_id: 'acct_BETA' },
    { id: T, slug: 'tmpl', render_backend_url: 'https://tmpl-api.onrender.com', website_url: 'https://tmpl-site.onrender.com', factory_sync_key: 'key-t' },
  ]
  supabase.tables.tenant_audit_log = []
  supabase.writes.length = 0
})

const call = (p: string, key: string | null, body?: any) => app.request(p, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Factory-Key': key } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const start = (id: string, key: string, body: any) => call(`/customers/${id}/stripe-oauth/start`, key, body)
const good = { nonce: NONCE, userId: 'owner-1', returnUrl: 'https://acme-app.onrender.com/crm/settings/integrations' }

describe('the tenant doors', () => {
  test("each needs that tenant's own key", async () => {
    expect((await call(`/customers/${A}/stripe-oauth`, null)).status).toBe(401)
    expect((await call(`/customers/${A}/stripe-oauth`, 'key-b')).status).toBe(401)
    expect((await start(A, 'key-b', good)).status).toBe(401)
    expect((await call(`/customers/${A}/stripe-oauth/deauthorize`, 'key-b', { accountId: 'acct_BETA' })).status).toBe(401)
  })

  test('offered to a unified business; not to a template tenant; not without a client id', async () => {
    expect(await (await call(`/customers/${A}/stripe-oauth`, 'key-a')).json()).toEqual({ available: true })
    expect(await (await call(`/customers/${T}/stripe-oauth`, 'key-t')).json()).toEqual({ available: false })
    expect((await start(T, 'key-t', { ...good, returnUrl: 'https://tmpl-site.onrender.com/crm/settings/integrations' })).status).toBe(503)
    delete process.env.STRIPE_CONNECT_CLIENT_ID
    try {
      expect(await (await call(`/customers/${A}/stripe-oauth`, 'key-a')).json()).toEqual({ available: false })
      expect((await start(A, 'key-a', good)).status).toBe(503)
    } finally { process.env.STRIPE_CONNECT_CLIENT_ID = ENV.STRIPE_CONNECT_CLIENT_ID }
  })

  test("the start: Stripe's authorize link with a signed state; the way back must be the business's own app", async () => {
    const r = await start(A, 'key-a', good)
    expect(r.status).toBe(200)
    const u = new URL(((await r.json()) as any).url)
    expect(u.searchParams.get('client_id')).toBe('ca_TEST123')
    expect(u.searchParams.get('redirect_uri')).toBe('https://factory.example/api/v1/factory/stripe/oauth/callback')
    expect(u.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    // its own domain is its own; anyone else's, or a look-alike host, is not
    expect((await start(A, 'key-a', { ...good, returnUrl: 'https://app.acme.com/crm/settings/integrations' })).status).toBe(200)
    for (const returnUrl of ['https://beta-app.onrender.com/crm/settings/integrations', 'https://acme-app.onrender.com.evil.com/x', 'http://acme-app.onrender.com/x', 'javascript:alert(1)']) {
      expect((await start(A, 'key-a', { ...good, returnUrl })).status).toBe(400)
    }
    expect((await start(A, 'key-a', { ...good, nonce: 'short' })).status).toBe(400)
    expect((await start(A, 'key-a', { ...good, userId: '' })).status).toBe(400)
  })

  test("deauthorize: only the account recorded for this business", async () => {
    const r = await call(`/customers/${A}/stripe-oauth/deauthorize`, 'key-a', { accountId: 'acct_BETA' })
    expect(r.status).toBe(409)
  })
})

describe("Stripe's redirect", () => {
  test('a forged state: a plain page, nothing written', async () => {
    const r = await app.request('/stripe/oauth/callback?code=ac_1&state=forged.state')
    expect(r.status).toBe(400)
    expect(r.headers.get('location')).toBeNull()
    expect(await r.text()).toContain('not valid or has expired')
    expect(supabase.writes).toHaveLength(0)
  })

  test('end to end: the code exchanged once, the account handed to that business with its key, recorded, owner sent back', async () => {
    const url = new URL(((await (await start(A, 'key-a', good)).json()) as any).url)
    const state = url.searchParams.get('state')!
    const realFetch = globalThis.fetch
    const seen: Array<{ url: string; key: string | null; body: any }> = []
    ;(globalThis as any).fetch = async (u: any, init: any) => {
      const s = String(u)
      seen.push({ url: s, key: init?.headers?.['X-Factory-Key'] ?? null, body: init?.body })
      if (s === 'https://connect.stripe.com/oauth/token') return Response.json({ stripe_user_id: 'acct_ACME', token_type: 'bearer' })
      if (s === 'https://acme-app.onrender.com/api/internal/stripe-link') return Response.json({ linked: true })
      return new Response('unexpected', { status: 599 })
    }
    try {
      const r = await app.request(`/stripe/oauth/callback?code=ac_1&scope=read_write&state=${encodeURIComponent(state)}`)
      expect(r.status).toBe(302)
      expect(r.headers.get('location')).toBe('https://acme-app.onrender.com/crm/settings/integrations?stripe=linked')
      expect(seen.map((s) => s.url)).toEqual(['https://connect.stripe.com/oauth/token', 'https://acme-app.onrender.com/api/internal/stripe-link'])
      expect(seen[1].key).toBe('key-a')
      expect(JSON.parse(seen[1].body)).toEqual({ nonce: NONCE, userId: 'owner-1', accountId: 'acct_ACME' })
      expect(supabase.tables.tenants.find((t: any) => t.id === A).stripe_connect_account_id).toBe('acct_ACME')
      expect(supabase.tables.tenants.find((t: any) => t.id === B).stripe_connect_account_id).toBe('acct_BETA')
      // The same state again: refused, no second exchange.
      const again = await app.request(`/stripe/oauth/callback?code=ac_1&state=${encodeURIComponent(state)}`)
      expect(again.status).toBe(400)
      expect(seen).toHaveLength(2)
    } finally { (globalThis as any).fetch = realFetch }
  })
})
