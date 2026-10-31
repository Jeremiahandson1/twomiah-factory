// What the store-upgrade suites share (2026-10-24): a store tenant on the real unified server with its three seats
// signed in for real (owner, manager, staff), the app's email answered in place, and Stripe's API answered here as its
// documentation describes it (Checkout Sessions, Coupons, Tax Settings, Refunds; webhooks signed with Stripe's own
// documented signature scheme and verified by the store with the SDK, as in production). Nothing leaves the machine.
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { encrypt, encryptJSON } from '../server/core/crypto.ts'

process.env.PAYMENT_ENC_KEY ||= 'store-upgrade-test-key'
process.env.SITE_URL ||= 'https://site.test'

export const WEBHOOK_SECRET = 'whsec_test_store_upgrade'

/** Stripe, as its API answers: every request recorded (path, method and the form-encoded params). */
export interface StripeCall {
  method: string; path: string; params: URLSearchParams
  /** The Stripe-Account header (a connected account's call), and the key the call was made with (Authorization). */
  account: string | null; key: string | null
}
export function stripeMock() {
  const calls: StripeCall[] = []
  /** What a retrieved session says when the success page asks: by session id. */
  const sessions = new Map<string, any>()
  const state = { taxStatus: 'active' as 'active' | 'pending', n: 0, /** 'refuse': Stripe answers a refund with a 4xx (nothing is sent). */ refund: 'ok' as 'ok' | 'refuse' }
  /** Payouts to the bank, and the balance transactions each is made of (by payout id): what the books read. */
  const payouts: any[] = []
  const balance = new Map<string, any[]>()
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
  const handle = async (url: string, init: any): Promise<Response> => {
    const u = new URL(url)
    const method = String(init?.method || 'GET').toUpperCase()
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : method === 'GET' ? u.search : '')
    const h = new Headers(init?.headers || {})
    calls.push({ method, path: u.pathname, params, account: h.get('stripe-account'), key: (h.get('authorization') || '').replace(/^Bearer\s+/i, '') || null })
    if (u.pathname === '/v1/tax/settings' && method === 'GET') return json({ object: 'tax.settings', status: state.taxStatus, defaults: {}, head_office: null, livemode: false })
    if (u.pathname === '/v1/coupons' && method === 'POST') return json({ id: `co_${++state.n}`, object: 'coupon', amount_off: Number(params.get('amount_off')), currency: params.get('currency') })
    if (u.pathname === '/v1/checkout/sessions' && method === 'POST') {
      const id = `cs_test_${++state.n}`
      return json({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, payment_status: 'unpaid', status: 'open' })
    }
    const m = u.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/)
    if (m && method === 'GET') {
      const s = sessions.get(decodeURIComponent(m[1]))
      return s ? json(s) : json({ error: { type: 'invalid_request_error', message: 'No such checkout.session' } }, 404)
    }
    if (u.pathname === '/v1/customers' && method === 'POST') return json({ id: `cus_${++state.n}`, object: 'customer', email: params.get('email'), name: params.get('name') })
    if (u.pathname === '/v1/payouts' && method === 'GET') {
      const since = Number(u.searchParams.get('arrival_date[gte]') || 0)
      return json({ object: 'list', url: '/v1/payouts', has_more: false, data: payouts.filter((p) => p.status === (u.searchParams.get('status') || p.status) && p.arrival_date >= since) })
    }
    if (u.pathname === '/v1/balance_transactions' && method === 'GET') return json({ object: 'list', url: '/v1/balance_transactions', has_more: false, data: balance.get(u.searchParams.get('payout') || '') || [] })
    if (u.pathname === '/v1/refunds' && method === 'POST' && state.refund === 'refuse') return json({ error: { type: 'invalid_request_error', code: 'charge_disputed', message: 'This charge cannot be refunded.' } }, 400)
    if (u.pathname === '/v1/refunds' && method === 'POST') return json({ id: `re_${++state.n}`, object: 'refund', status: 'succeeded', amount: Number(params.get('amount') || 0) || null, payment_intent: params.get('payment_intent') })
    return json({ error: { type: 'invalid_request_error', message: `Unrouted ${method} ${u.pathname}` } }, 404)
  }
  return { calls, sessions, state, payouts, balance, handle, last: (path: string) => [...calls].reverse().find((c) => c.path === path && c.method === 'POST') }
}

/** A paid Checkout Session as Stripe describes it (the fields the store reads). */
export function paidSession(id: string, o: { amountTotal: number; tax?: number; email?: string; shipping?: boolean; paymentIntent?: string }) {
  const address = { line1: '1 Main St', line2: null, city: 'Eau Claire', state: 'WI', postal_code: '54701', country: 'US' }
  return {
    id, object: 'checkout.session', payment_status: 'paid', status: 'complete', currency: 'usd', amount_total: o.amountTotal,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: o.tax ?? 0 }, payment_intent: o.paymentIntent ?? `pi_${id}`,
    customer_details: { email: o.email ?? 'ada@example.com', name: 'Ada Shopper', phone: '+17155550100', address },
    collected_information: o.shipping === false ? null : { shipping_details: { name: 'Ada Shopper', address } },
  }
}

/**
 * A webhook as Stripe sends it: the event JSON and its Stripe-Signature, signed as Stripe documents it — `t=<unix
 * seconds>,v1=<hex HMAC-SHA256 of "<t>.<payload>" with the endpoint's secret>` — and verified by the store with the SDK.
 */
export function signedEvent(type: string, object: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object }, api_version: '2024-06-20', created: Math.floor(Date.now() / 1000) })
  const ts = Math.floor(Date.now() / 1000)
  return { payload, signature: `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')}` }
}

export async function bootStore(opts: { adminDist?: string } = {}) {
  const stripe = stripeMock()
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://api.stripe.com/')) return stripe.handle(url, init)
    return realFetch(input, init)
  }) as any
  const t = await bootTenant({ vertical: 'store', ...(opts.adminDist ? { adminDist: opts.adminDist } : {}) })
  const S = t.schema as any
  const s = await seedOwner(t)
  const companyId = s.company.id
  await (t.db as any).update(S.company).set({ email: 'owner@shop.test' }).where(eq(S.company.id, companyId))
  const tokens: Record<string, string> = {}
  tokens.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  for (const [key, role] of [['manager', 'manager'], ['staff', 'staff']]) {
    await (t.db as any).insert(S.user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId })
    tokens[key] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: 'Seat-pass-1' } })).json()).accessToken
  }
  const mails: Array<{ to: string; template: string; data: any }> = []
  ;(t.services.email as any).send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
  ;(t.services.crm.emailService as any).send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }

  const read = async (res: Response) => { const text = await res.text(); let j: any = text; try { j = JSON.parse(text) } catch {}; return { status: res.status, json: j, text, headers: res.headers } }
  /** A signed-in seat's request. */
  const as = (who: 'owner' | 'manager' | 'staff') => async (method: string, path: string, body?: unknown) =>
    read(await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}`, host: 'shop.test' }, ...(body === undefined ? {} : { json: body }) }))
  /** A shopper's (or a provider's) request, no sign-in. */
  const pub = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    read(await t.app.request(path, { method, headers: { host: 'shop.test', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }))
  /** A Stripe webhook, signed (or with the signature given). */
  const webhook = (type: string, object: unknown, signature?: string) => {
    const e = signedEvent(type, object)
    return pub('POST', '/api/public/webhooks/payment', e.payload, { 'stripe-signature': signature ?? e.signature, 'content-type': 'application/json' })
  }
  const connectStripe = () => (t.db as any).insert(S.paymentConfig).values({
    companyId, provider: 'stripe', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'sk_test_store_upgrade', publishableKey: 'pk_test' }), webhookSecretEnc: encrypt(WEBHOOK_SECRET),
  })
  /** A product on sale with one variant. */
  const product = async (p: { slug: string; name: string; sku: string; priceCents: number; kind?: string; category?: string; qty?: number | null; extra?: Record<string, unknown> }) => {
    const [row] = await (t.db as any).insert(S.storeProduct).values({ companyId, slug: p.slug, name: p.name, status: 'active', kind: p.kind ?? 'physical', category: p.category ?? null, ...(p.extra || {}) }).returning()
    const [v] = await (t.db as any).insert(S.storeProductVariant).values({ productId: row.id, sku: p.sku, name: 'Default', priceCents: p.priceCents, inventoryQty: p.qty === undefined ? 10 : p.qty }).returning()
    return { product: row, variant: v }
  }
  const order = async (id: string) => (await (t.db as any).select().from(S.storeOrder).where(eq(S.storeOrder.id, id)))[0]
  const orderBySession = async (sid: string) => (await (t.db as any).select().from(S.storeOrder).where(eq(S.storeOrder.providerSessionId, sid)))[0]
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
  const restore = () => { globalThis.fetch = realFetch }
  return { t, S, companyId, tokens, mails, stripe, as, pub, webhook, connectStripe, product, order, orderBySession, settle, restore, O: as('owner'), M: as('manager'), ST: as('staff') }
}
