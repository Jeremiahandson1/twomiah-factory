// "I already have a Stripe account — link it" (owner, 2026-10-25), the business's side. Settings › Integrations' Connect
// Stripe always created a NEW Standard account, so a business already on Stripe got a second one. The Factory now runs
// Stripe's OAuth (apps/api services/stripeConnectOAuth.ts — its half is tests/unified/factory/stripe-link.test.ts) and
// hands the account to /api/internal/stripe-link. Here: the choice is offered only when the Factory says it can work;
// only an owner/admin starts it; the hand-over is accepted only for that admin's one pending press (nonce, expiry,
// replay, someone else's, a demoted admin, already connected); a linked account is stored where a created one is, and
// its Disconnect withdraws the platform's access; Stripe's account.application.deauthorized forgets it; and the card
// draws the second choice only when offered. A stand-in Factory answers — no test reaches Stripe or the Factory.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const KEY = 'stripe-link-test-key'
const TENANT = '11111111-2222-3333-4444-555555555555'
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }

// The stand-in Factory: whether linking is offered, and every call it heard.
let offered = true
let deauthorizeAnswer: { status: number; body: any } = { status: 200, body: { deauthorized: true } }
const heard: Array<{ method: string; path: string; key: string | null; body: any }> = []
let server: ReturnType<typeof Bun.serve>

// A fake Stripe: the status page asks it about the stored account; nothing else is called.
const fakeStripe = { accounts: { retrieve: async (id: string) => ({ id, charges_enabled: true }) } }

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url)
      const body = req.method === 'POST' ? await req.json().catch(() => null) : null
      heard.push({ method: req.method, path: u.pathname, key: req.headers.get('X-Factory-Key'), body })
      const base = `/api/v1/factory/customers/${TENANT}`
      if (u.pathname === `${base}/stripe-oauth`) return Response.json({ available: offered })
      if (u.pathname === `${base}/stripe-oauth/start`) return Response.json({ url: 'https://connect.stripe.com/oauth/authorize?state=signed-by-factory' })
      if (u.pathname === `${base}/stripe-oauth/deauthorize`) return Response.json(deauthorizeAnswer.body, { status: deauthorizeAnswer.status })
      if (u.pathname === `${base}/stripe-connect`) return Response.json({ success: true })
      return new Response('gone', { status: 404 })
    },
  })
  setEnv('FACTORY_URL', `http://localhost:${server.port}`)
  setEnv('FACTORY_SYNC_KEY', KEY)
  setEnv('TENANT_ID', TENANT)
})

afterAll(() => {
  server?.stop(true)
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

async function boot() {
  const t = await bootTenant({ stripe: fakeStripe })
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'online_payments'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const [manager] = await t.db.insert(t.schema.user).values({
    email: 'manager@test.example', passwordHash: await Bun.password.hash(s.password, 'bcrypt'), firstName: 'Max', lastName: 'Manager', role: 'manager', companyId,
  }).returning()
  const [admin] = await t.db.insert(t.schema.user).values({
    email: 'admin@test.example', passwordHash: await Bun.password.hash(s.password, 'bcrypt'), firstName: 'Ada', lastName: 'Admin', role: 'admin', companyId,
  }).returning()
  const login = async (email: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: s.password } })).json() as any).accessToken as string
  const tokens: Record<string, string> = { owner: await login('owner@test.example'), manager: await login('manager@test.example'), admin: await login('admin@test.example') }
  const as = (who: string, p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
  const integrations = async () => ((await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId)))[0] as any).integrations || {}
  const setIntegrations = async (j: any) => { await t.db.update(t.schema.company).set({ integrations: j } as any).where(eq(t.schema.company.id, companyId)) }
  const handOver = (json: any, key = KEY) => t.call('/api/internal/stripe-link', { method: 'POST', json, headers: { 'X-Factory-Key': key } })
  /** Press the button as `who`; returns the nonce the Factory was given. */
  const press = async (who = 'owner') => {
    const r = await as(who, '/api/integrations/stripe/link-url')
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).linkUrl).toBe('https://connect.stripe.com/oauth/authorize?state=signed-by-factory')
    const start = heard.filter((h) => h.path.endsWith('/stripe-oauth/start')).at(-1)!
    return start.body as { nonce: string; userId: string; returnUrl: string }
  }
  return { t, s, companyId, manager, admin, as, integrations, setIntegrations, handOver, press }
}

let x: Awaited<ReturnType<typeof boot>>
beforeAll(async () => { offered = true; x = await boot() }, 120_000)

describe('offered only when it can work', () => {
  test('the status says the second choice is available while the Factory offers it', async () => {
    const st = ((await (await x.as('owner', '/api/integrations/status')).json()) as any).stripe
    expect(st).toMatchObject({ connected: false, configured: true, linkAvailable: true })
  })

  test('with no client id on the Factory, nothing is offered and the start is refused', async () => {
    offered = false
    try {
      const y = await boot()
      const st = ((await (await y.as('owner', '/api/integrations/status')).json()) as any).stripe
      expect(st.linkAvailable).toBe(false)
      const r = await y.as('owner', '/api/integrations/stripe/link-url')
      expect(r.status).toBe(503)
      expect(((await r.json()) as any).error).toContain('Create a new Stripe account')
      expect((await y.integrations()).stripeLinkPending).toBeUndefined()
    } finally { offered = true }
  }, 120_000)
})

describe('starting it', () => {
  test('a manager cannot start it; an owner can, and the Factory gets the nonce, the admin and the way back', async () => {
    expect((await x.as('manager', '/api/integrations/stripe/link-url')).status).toBe(403)
    const start = await x.press('owner')
    expect(start.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(start.userId).toBe(x.s.owner.id)
    expect(start.returnUrl).toMatch(/\/crm\/settings\/integrations$/)
    const pending = (await x.integrations()).stripeLinkPending
    // Only the hash is kept: the nonce itself is never stored.
    expect(pending.nonceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(pending)).not.toContain(start.nonce)
    expect(pending.userId).toBe(x.s.owner.id)
    expect(heard.filter((h) => h.path.includes('/stripe-oauth')).every((h) => h.key === KEY)).toBe(true)
  })
})

describe("the Factory's hand-over", () => {
  test('refused without the key', async () => {
    expect((await x.handOver({ nonce: 'x', userId: 'y', accountId: 'acct_1' }, 'wrong')).status).toBe(401)
  })

  test('a forged nonce is refused and nothing is stored', async () => {
    await x.setIntegrations({})
    await x.press('owner')
    const r = await x.handOver({ nonce: 'a'.repeat(43), userId: x.s.owner.id, accountId: 'acct_FORGED' })
    expect(r.status).toBe(410)
    expect((await x.integrations()).stripeAccountId).toBeUndefined()
  })

  test("someone else's id on the press is refused, and the press is spent", async () => {
    await x.setIntegrations({})
    const { nonce } = await x.press('owner')
    expect((await x.handOver({ nonce, userId: x.admin.id, accountId: 'acct_OTHER' })).status).toBe(403)
    expect((await x.integrations()).stripeAccountId).toBeUndefined()
    expect((await x.handOver({ nonce, userId: x.s.owner.id, accountId: 'acct_OTHER' })).status).toBe(410)
  })

  test('an expired press is refused', async () => {
    await x.setIntegrations({})
    const { nonce } = await x.press('owner')
    const j = await x.integrations()
    await x.setIntegrations({ ...j, stripeLinkPending: { ...j.stripeLinkPending, expiresAt: Date.now() - 1 } })
    expect((await x.handOver({ nonce, userId: x.s.owner.id, accountId: 'acct_LATE' })).status).toBe(410)
    expect((await x.integrations()).stripeAccountId).toBeUndefined()
  })

  test('an admin demoted after pressing cannot link', async () => {
    await x.setIntegrations({})
    const { nonce } = await x.press('admin')
    await x.t.db.update(x.t.schema.user).set({ role: 'manager' } as any).where(eq(x.t.schema.user.id, x.admin.id))
    try {
      expect((await x.handOver({ nonce, userId: x.admin.id, accountId: 'acct_DEMOTED' })).status).toBe(403)
      expect((await x.integrations()).stripeAccountId).toBeUndefined()
    } finally {
      await x.t.db.update(x.t.schema.user).set({ role: 'admin' } as any).where(eq(x.t.schema.user.id, x.admin.id))
    }
  })

  test('cancelled at Stripe: the press is cleared, nothing linked', async () => {
    await x.setIntegrations({})
    const { nonce } = await x.press('owner')
    const r = await x.handOver({ nonce, userId: x.s.owner.id, outcome: 'cancelled' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ cleared: true })
    const j = await x.integrations()
    expect(j.stripeLinkPending).toBeUndefined()
    expect(j.stripeAccountId).toBeUndefined()
  })

  test('accepted once, stored where a created account is; a replay finds nothing', async () => {
    await x.setIntegrations({})
    const { nonce } = await x.press('owner')
    const r = await x.handOver({ nonce, userId: x.s.owner.id, accountId: 'acct_LINKED1' })
    expect(r.status).toBe(200)
    const j = await x.integrations()
    expect(j).toMatchObject({ stripeAccountId: 'acct_LINKED1', stripeAccountSource: 'oauth' })
    expect(j.stripeLinkPending).toBeUndefined()
    expect((await x.handOver({ nonce, userId: x.s.owner.id, accountId: 'acct_REPLAY' })).status).toBe(410)
    expect((await x.integrations()).stripeAccountId).toBe('acct_LINKED1')
    const st = ((await (await x.as('owner', '/api/integrations/status')).json()) as any).stripe
    expect(st).toMatchObject({ connected: true, chargesEnabled: true, linked: true })
    // Connected: no second press.
    expect((await x.as('owner', '/api/integrations/stripe/link-url')).status).toBe(409)
  })

  test('an account connected meanwhile is not replaced', async () => {
    await x.setIntegrations({})
    const { nonce } = await x.press('owner')
    await x.setIntegrations({ ...(await x.integrations()), stripeAccountId: 'acct_CREATED' })
    expect((await x.handOver({ nonce, userId: x.s.owner.id, accountId: 'acct_LATECOMER' })).status).toBe(409)
    expect((await x.integrations()).stripeAccountId).toBe('acct_CREATED')
  })
})

describe('disconnect and deauthorization', () => {
  test("a linked account's Disconnect withdraws the platform's access through the Factory", async () => {
    await x.setIntegrations({ stripeAccountId: 'acct_LINKED2', stripeAccountSource: 'oauth' })
    const before = heard.length
    const r = await x.as('owner', '/api/integrations/stripe/disconnect', { method: 'POST' })
    expect(await r.json()).toMatchObject({ success: true, deauthorized: true })
    const deauth = heard.slice(before).find((h) => h.path.endsWith('/stripe-oauth/deauthorize'))!
    expect(deauth.body).toEqual({ accountId: 'acct_LINKED2' })
    expect((await x.integrations()).stripeAccountId).toBeUndefined()
  })

  test("when Stripe does not confirm, it is still disconnected here and the owner is told where to finish", async () => {
    await x.setIntegrations({ stripeAccountId: 'acct_LINKED3', stripeAccountSource: 'oauth' })
    deauthorizeAnswer = { status: 502, body: { error: 'Stripe did not confirm the disconnect' } }
    try {
      const body = (await (await x.as('owner', '/api/integrations/stripe/disconnect', { method: 'POST' })).json()) as any
      expect(body).toMatchObject({ success: true, deauthorized: false })
      expect(body.message).toContain('Stripe dashboard')
      expect((await x.integrations()).stripeAccountId).toBeUndefined()
    } finally { deauthorizeAnswer = { status: 200, body: { deauthorized: true } } }
  })

  test('an account we created is cleared as before, with no deauthorize call', async () => {
    await x.setIntegrations({ stripeAccountId: 'acct_CREATED2' })
    const before = heard.length
    expect((await x.as('owner', '/api/integrations/stripe/disconnect', { method: 'POST' })).status).toBe(200)
    expect(heard.slice(before).some((h) => h.path.endsWith('/deauthorize'))).toBe(false)
    expect((await x.integrations()).stripeAccountId).toBeUndefined()
  })

  test("Stripe's account.application.deauthorized forgets that account, and only that one", async () => {
    await x.setIntegrations({ stripeAccountId: 'acct_GONE', stripeAccountSource: 'oauth', smsKeep: 1 })
    const other = { id: 'evt_x', type: 'account.application.deauthorized', account: 'acct_SOMEONE_ELSE', data: { object: { id: 'ca_test', object: 'application' } } }
    expect((await x.t.call('/api/stripe/factory-event', { method: 'POST', json: { event: other }, headers: { 'X-Factory-Key': KEY } })).status).toBe(200)
    expect((await x.integrations()).stripeAccountId).toBe('acct_GONE')
    const ours = { ...other, account: 'acct_GONE' }
    const r = await x.t.call('/api/stripe/factory-event', { method: 'POST', json: { event: ours }, headers: { 'X-Factory-Key': KEY } })
    expect(await r.json()).toMatchObject({ received: true, handled: true, cleared: 1 })
    const j = await x.integrations()
    expect(j.stripeAccountId).toBeUndefined()
    expect(j.stripeAccountSource).toBeUndefined()
    expect(j.smsKeep).toBe(1)
  })
})
