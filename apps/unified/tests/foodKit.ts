// What the food-service suites share (2026-10-24): a bar (or restaurant) tenant on the real unified server with an
// owner, a manager and a bartender signed in for real, its own Stripe account connected (integrations.stripeAccountId),
// and Stripe's API answered here AS ITS DOCUMENTATION DESCRIBES IT — Terminal locations, readers, process_payment_intent,
// the simulated reader's present_payment_method test helper, cancel_action, PaymentIntents, Checkout Sessions and
// Refunds — over the SDK's fetch transport. Nothing leaves the machine (noLiveKeys.ts blanks every real key first).
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

export interface StripeCall { method: string; path: string; params: URLSearchParams; account: string | null }

/** Stripe's form encoding as the SDK sends it: a[b][c]=v. */
const param = (p: URLSearchParams, k: string) => p.get(k)
/** An array as the SDK sends it: a[0]=x&a[1]=y (or a[]=x). */
export const arr = (p: URLSearchParams, k: string) => [...p.entries()].filter(([key]) => key === k + '[]' || (key.startsWith(k + '[') && /^\[\d+\]$/.test(key.slice(k.length)))).map(([, v]) => v)

export function terminalStripeFake() {
  const calls: StripeCall[] = []
  const state = { n: 0, offline: false }
  const readers = new Map<string, any>()
  const intents = new Map<string, any>()
  const sessions = new Map<string, any>()
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
  const err = (status: number, message: string, code?: string) => json({ error: { type: 'invalid_request_error', message, ...(code ? { code } : {}) } }, status)
  const handle = async (url: string, init: any): Promise<Response> => {
    const u = new URL(url)
    const method = String(init?.method || 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    const p = u.pathname
    calls.push({ method, path: p, params, account: headers.get('stripe-account') })
    let m: RegExpMatchArray | null
    if (p === '/v1/terminal/locations' && method === 'POST') return json({ id: `tml_${++state.n}`, object: 'terminal.location', display_name: param(params, 'display_name'), address: { line1: param(params, 'address[line1]'), city: param(params, 'address[city]'), state: param(params, 'address[state]'), postal_code: param(params, 'address[postal_code]'), country: param(params, 'address[country]') } })
    if ((m = p.match(/^\/v1\/terminal\/locations\/([^/]+)$/)) && method === 'POST') return json({ id: m[1], object: 'terminal.location', configuration_overrides: param(params, 'configuration_overrides') })
    if (p === '/v1/terminal/configurations' && method === 'POST') return json({ id: `tmc_${++state.n}`, object: 'terminal.configuration', tipping: { usd: { percentages: arr(params, 'tipping[usd][percentages]').map(Number) } } })
    if (p === '/v1/terminal/readers' && method === 'POST') {
      const code = param(params, 'registration_code')
      if (code !== 'simulated-wpe' && code !== 'quick-brown-fox') return err(400, 'The registration code is invalid or has expired.')
      const r = { id: `tmr_${++state.n}`, object: 'terminal.reader', device_type: code === 'simulated-wpe' ? 'simulated_wisepos_e' : 'bbpos_wisepos_e', label: param(params, 'label'), location: param(params, 'location'), serial_number: `SN${state.n}`, status: 'online', action: null as any }
      readers.set(r.id, r)
      return json(r)
    }
    if ((m = p.match(/^\/v1\/terminal\/readers\/([^/]+)$/))) {
      const r = readers.get(m[1]); if (!r) return err(404, 'No such reader')
      if (method === 'GET') return json(r)
      if (method === 'DELETE') { readers.delete(m[1]); return json({ id: m[1], object: 'terminal.reader', deleted: true }) }
    }
    if ((m = p.match(/^\/v1\/terminal\/readers\/([^/]+)\/process_payment_intent$/)) && method === 'POST') {
      const r = readers.get(m[1]); if (!r) return err(404, 'No such reader')
      if (state.offline) return err(400, 'Reader is currently offline, please ensure the reader is powered on and connected to the internet before retrying your request.', 'terminal_reader_offline')
      if (r.action?.status === 'in_progress') return err(409, 'Reader is currently busy processing another request.', 'terminal_reader_busy')
      r.action = { type: 'process_payment_intent', status: 'in_progress', failure_code: null, failure_message: null, process_payment_intent: { payment_intent: param(params, 'payment_intent') } }
      return json(r)
    }
    if ((m = p.match(/^\/v1\/terminal\/readers\/([^/]+)\/cancel_action$/)) && method === 'POST') {
      const r = readers.get(m[1]); if (!r) return err(404, 'No such reader')
      r.action = null
      return json(r)
    }
    if ((m = p.match(/^\/v1\/test_helpers\/terminal\/readers\/([^/]+)\/present_payment_method$/)) && method === 'POST') {
      const r = readers.get(m[1]); if (!r?.action) return err(400, 'The reader has no action to complete.')
      const pi = intents.get(r.action.process_payment_intent.payment_intent)
      const number = param(params, 'card_present[number]') || '4242424242424242'
      if (number === '4000000000000002') {
        r.action = { ...r.action, status: 'failed', failure_code: 'card_declined', failure_message: 'Your card was declined.' }
      } else {
        const tip = Number(param(params, 'amount_tip') || 0)
        Object.assign(pi, { status: 'succeeded', amount: pi.amount + tip, amount_received: pi.amount + tip, amount_details: { tip: tip ? { amount: tip } : {} }, latest_charge: `ch_${pi.id}` })
        r.action = { ...r.action, status: 'succeeded' }
      }
      return json(r)
    }
    if (p === '/v1/payment_intents' && method === 'POST') {
      const pi = { id: `pi_${++state.n}`, object: 'payment_intent', amount: Number(param(params, 'amount')), currency: param(params, 'currency'), status: 'requires_payment_method', amount_received: 0, capture_method: param(params, 'capture_method'), payment_method_types: arr(params, 'payment_method_types'), metadata: {} as Record<string, string>, amount_details: {} }
      for (const [k, v] of params) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) pi.metadata[mm[1]] = v }
      intents.set(pi.id, pi)
      return json(pi)
    }
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)$/)) && method === 'GET') { const pi = intents.get(m[1]); return pi ? json(pi) : err(404, 'No such payment_intent') }
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)\/cancel$/)) && method === 'POST') {
      const pi = intents.get(m[1]); if (!pi) return err(404, 'No such payment_intent')
      if (pi.status === 'succeeded') return err(400, 'You cannot cancel this PaymentIntent because it has a status of succeeded.', 'payment_intent_unexpected_state')
      pi.status = 'canceled'; return json(pi)
    }
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)\/capture$/)) && method === 'POST') { const pi = intents.get(m[1]); pi.status = 'succeeded'; pi.amount_received = pi.amount; return json(pi) }
    if (p === '/v1/refunds' && method === 'POST') return json({ id: `re_${++state.n}`, object: 'refund', status: 'succeeded', amount: Number(param(params, 'amount')), payment_intent: param(params, 'payment_intent') })
    if (p === '/v1/checkout/sessions' && method === 'POST') {
      const id = `cs_test_${++state.n}`
      const s = { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, payment_status: 'unpaid', status: 'open', amount_total: 0, payment_intent: null as string | null, metadata: {} as Record<string, string> }
      let total = 0
      for (let i = 0; params.get(`line_items[${i}][quantity]`); i++) total += Number(params.get(`line_items[${i}][quantity]`)) * Number(params.get(`line_items[${i}][price_data][unit_amount]`))
      s.amount_total = total
      for (const [k, v] of params) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) s.metadata[mm[1]] = v }
      sessions.set(id, s)
      return json(s)
    }
    if ((m = p.match(/^\/v1\/checkout\/sessions\/([^/]+)$/)) && method === 'GET') { const s = sessions.get(decodeURIComponent(m[1])); return s ? json(s) : err(404, 'No such checkout.session') }
    return err(404, `Unrouted ${method} ${p}`)
  }
  /** The customer pays on Stripe's page: the session completes. */
  const paySession = (id: string) => { const s = sessions.get(id); Object.assign(s, { payment_status: 'paid', status: 'complete', payment_intent: `pi_for_${id}` }) }
  return { calls, state, readers, intents, sessions, handle, paySession, posts: (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path) }
}

export async function bootFood(opts: { vertical?: string; features: string[]; adminDist?: string }) {
  const stripe = terminalStripeFake()
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://api.stripe.com/')) return stripe.handle(url, init)
    return realFetch(input, init)
  }) as any
  const t = await bootTenant({ vertical: opts.vertical ?? 'bar', ...(opts.adminDist ? { adminDist: opts.adminDist } : {}) })
  // A stand-in platform key (the harness blanked the real ones): the SDK only reaches the fake above.
  process.env.STRIPE_SECRET_KEY = 'sk_test_food_service'
  process.env.SITE_URL = 'https://bar.test'
  const S = t.schema as any
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  await (t.db as any).update(S.company).set({ address: '214 Water St', city: 'Eau Claire', state: 'WI', zip: '54703', phone: '7155550100', email: 'owner@bar.test', integrations: { stripeAccountId: 'acct_biz' }, enabledFeatures: opts.features }).where(eq(S.company.id, companyId))
  t.services.features.forgetFeatures()
  const tokens: Record<string, string> = {}
  tokens.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  const ids: Record<string, string> = { owner: s.owner.id }
  for (const [key, role] of [['manager', 'manager'], ['bartender', 'field']]) {
    const [u] = await (t.db as any).insert(S.user).values({ email: `${key}@bar.test`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key[0].toUpperCase() + key.slice(1), lastName: 'Seat', role, companyId }).returning()
    ids[key] = u.id
    tokens[key] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@bar.test`, password: 'Seat-pass-1' } })).json()).accessToken
  }
  const mails: Array<{ to: string; subject: string; html: string }> = []
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  const texts: Array<{ to: string; message: string }> = []
  ;(t.services.crm.sms as any).sendSMS = async (_co: string, m: any) => { texts.push({ to: m.toPhone, message: m.message }); return { status: 'sent' } }
  const read = async (res: Response) => { const text = await res.text(); let j: any = text; try { j = JSON.parse(text) } catch {}; return { status: res.status, json: j, text, headers: res.headers } }
  const as = (who: 'owner' | 'manager' | 'bartender') => async (method: string, path: string, body?: unknown) =>
    read(await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) }))
  const pub = async (method: string, path: string, body?: unknown) =>
    read(await t.app.request(path, { method, headers: { host: 'bar.test', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
  const features = async (list: string[]) => { await (t.db as any).update(S.company).set({ enabledFeatures: list }).where(eq(S.company.id, companyId)); t.services.features.forgetFeatures() }
  /** A menu with a burger (to the grill, $12.00) and a soda (a drink, $3.00). */
  const menu = async () => {
    const [food] = await (t.db as any).insert(S.barMenuSection).values({ companyId, name: 'Burgers', slug: 'burgers', kind: 'food' }).returning()
    const [drink] = await (t.db as any).insert(S.barMenuSection).values({ companyId, name: 'Soft drinks', slug: 'soft-drinks', kind: 'drink' }).returning()
    const [burger] = await (t.db as any).insert(S.barMenuItem).values({ companyId, sectionId: food.id, slug: 'burger', name: 'Burger', priceCents: 1200, modifiers: [{ id: 'modbacon01', name: 'Add bacon', priceCents: 200 }, { id: 'modnoonion', name: 'No onions', priceCents: 0 }] }).returning()
    const [soda] = await (t.db as any).insert(S.barMenuItem).values({ companyId, sectionId: drink.id, slug: 'soda', name: 'Soda', priceCents: 300 }).returning()
    return { burger, soda }
  }
  const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms))
  const restore = () => { globalThis.fetch = realFetch }
  return { t, S, companyId, ids, tokens, stripe, mails, texts, as, pub, features, menu, settle, restore, O: as('owner'), M: as('manager'), B: as('bartender') }
}
