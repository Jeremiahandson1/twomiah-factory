// What the food-service suites share (2026-10-24): a bar (or restaurant) tenant on the real unified server with an
// owner, a manager and a bartender signed in for real, its own Stripe account connected (integrations.stripeAccountId),
// and Stripe's API answered here AS ITS DOCUMENTATION DESCRIBES IT — Terminal locations, readers, process_payment_intent,
// the simulated reader's present_payment_method test helper, cancel_action, PaymentIntents, Checkout Sessions and
// Refunds — over the SDK's fetch transport. Nothing leaves the machine (noLiveKeys.ts blanks every real key first).
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { bootTenant, seedOwner } from './harness.ts'

export interface StripeCall { method: string; path: string; params: URLSearchParams; account: string | null }

/** Stripe's form encoding as the SDK sends it: a[b][c]=v. */
const param = (p: URLSearchParams, k: string) => p.get(k)
/** An array as the SDK sends it: a[0]=x&a[1]=y (or a[]=x). */
/** Stripe's test bank accounts as payment methods: pm_bank_* are us_bank_account methods (the browser's confirm made one). */
const isBank = (pm: string | null | undefined) => !!pm && pm.startsWith('pm_bank')
export const arr = (p: URLSearchParams, k: string) => [...p.entries()].filter(([key]) => key === k + '[]' || (key.startsWith(k + '[') && /^\[\d+\]$/.test(key.slice(k.length)))).map(([, v]) => v)

export function terminalStripeFake() {
  const calls: StripeCall[] = []
  const state = { n: 0, offline: false, declineIncrement: false, bankCapability: true }
  const readers = new Map<string, any>()
  const intents = new Map<string, any>()
  const sessions = new Map<string, any>()
  // Every refund, as Stripe keeps them: GET /v1/refunds?payment_intent= lists them (newest first, as Stripe does).
  const refunds: any[] = []
  const setups = new Map<string, any>()
  const mandates = new Map<string, any>()
  const detached: string[] = []
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
        if (pi.capture_method === 'manual') {
          // Authorised and held: the card was read, nothing is taken until capture (Stripe's requires_capture).
          Object.assign(pi, { status: 'requires_capture', amount_capturable: pi.amount, latest_charge: { id: `ch_${pi.id}`, object: 'charge', payment_method_details: { type: 'card_present', card_present: { brand: 'visa', last4: '4242', cardholder_name: 'MIKE TESTER', capture_before: Math.floor(Date.now() / 1000) + 2 * 86400 } } } })
          r.action = { ...r.action, status: 'succeeded' }
          return json(r)
        }
        Object.assign(pi, { status: 'succeeded', amount: pi.amount + tip, amount_received: pi.amount + tip, amount_details: { tip: tip ? { amount: tip } : {} }, latest_charge: `ch_${pi.id}` })
        r.action = { ...r.action, status: 'succeeded' }
      }
      return json(r)
    }
    // Customers, saved cards and SetupIntents (the event depth: a card left for the rest of an event, charged off session).
    if (p === '/v1/customers' && method === 'POST') return json({ id: `cus_${++state.n}`, object: 'customer', name: param(params, 'name') })
    if (p === '/v1/setup_intents' && method === 'POST') {
      const si: any = { id: `seti_${++state.n}`, object: 'setup_intent', client_secret: `seti_secret_${state.n}`, status: 'requires_payment_method', customer: param(params, 'customer'), payment_method: null, payment_method_types: arr(params, 'payment_method_types'), usage: param(params, 'usage'), mandate: null, next_action: null, metadata: {} as Record<string, string> }
      for (const [k, v] of params) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) si.metadata[mm[1]] = v }
      setups.set(si.id, si)
      return json(si)
    }
    if ((m = p.match(/^\/v1\/setup_intents\/([^/]+)$/)) && method === 'GET') { const si = setups.get(m[1]); return si ? json(si) : err(404, 'No such setup_intent') }
    if ((m = p.match(/^\/v1\/payment_methods\/([^/]+)\/detach$/)) && method === 'POST') { detached.push(m[1]); return json({ id: m[1], object: 'payment_method', customer: null }) }
    if ((m = p.match(/^\/v1\/payment_methods\/([^/]+)$/)) && method === 'GET') {
      // A bank account (Stripe's us_bank_account payment method): its bank's name and last four, never the number.
      if (isBank(m[1])) return json({ id: m[1], object: 'payment_method', type: 'us_bank_account', us_bank_account: { bank_name: 'STRIPE TEST BANK', last4: '6789', account_holder_type: 'individual', account_type: 'checking', routing_number: '110000000' } })
      return json({ id: m[1], object: 'payment_method', type: 'card', card: { brand: 'visa', last4: m[1] === 'pm_declined' ? '0002' : '4242' } })
    }
    // A mandate, as Stripe keeps one for a bank account saved with a SetupIntent (or a PaymentIntent with setup_future_usage).
    if ((m = p.match(/^\/v1\/mandates\/([^/]+)$/)) && method === 'GET') { const md = mandates.get(m[1]); return md ? json(md) : err(404, 'No such mandate') }
    // The connected account itself: whether bank debits are switched on for it (capabilities.us_bank_account_ach_payments).
    if ((m = p.match(/^\/v1\/accounts\/([^/]+)$/)) && method === 'GET') return json({ id: m[1], object: 'account', capabilities: { card_payments: 'active', transfers: 'active', us_bank_account_ach_payments: state.bankCapability ? 'active' : 'inactive' } })
    if (p === '/v1/payment_intents' && method === 'POST') {
      const pi: any = { id: `pi_${++state.n}`, object: 'payment_intent', created: Math.floor(Date.now() / 1000), client_secret: `pi_secret_${state.n}`, payment_method: param(params, 'payment_method'), amount: Number(param(params, 'amount')), currency: param(params, 'currency'), status: 'requires_payment_method', amount_received: 0, capture_method: param(params, 'capture_method'), payment_method_types: arr(params, 'payment_method_types'), customer: param(params, 'customer'), setup_future_usage: param(params, 'setup_future_usage'), metadata: {} as Record<string, string>, amount_details: {}, last_payment_error: null, next_action: null, payment_method_options: { card_present: { request_incremental_authorization_support: param(params, 'payment_method_options[card_present][request_incremental_authorization_support]') } } }
      // confirm=true with a saved card is an off-session charge: the declining test card fails the way Stripe's does.
      if (param(params, 'confirm') === 'true') {
        if (isBank(pi.payment_method)) {
          // A saved bank account debited off session: Stripe takes the request and the debit is PROCESSING — it settles (or fails) days later.
          if (!pi.payment_method_types.includes('us_bank_account')) return err(400, 'The payment method us_bank_account is not in payment_method_types.', 'payment_intent_invalid_parameter')
          if (!state.bankCapability) return err(400, 'The us_bank_account payment method type is not enabled for this account.', 'payment_method_unactivated')
          pi.status = 'processing'
        } else {
          if (pi.payment_method === 'pm_declined') return err(402, 'Your card was declined.', 'card_declined')
          pi.status = 'succeeded'; pi.amount_received = pi.amount
        }
      } else if (pi.payment_method_types.includes('us_bank_account') && !state.bankCapability) return err(400, 'The us_bank_account payment method type is not enabled for this account.', 'payment_method_unactivated')
      for (const [k, v] of params) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) pi.metadata[mm[1]] = v }
      intents.set(pi.id, pi)
      return json(pi)
    }
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)$/)) && method === 'GET') {
      const pi = intents.get(m[1]); if (!pi) return err(404, 'No such payment_intent')
      // expand[]=latest_charge answers the charge itself; otherwise just its id, as Stripe does.
      const expanded = [...u.searchParams.values()].includes('latest_charge')
      return json(!expanded && pi.latest_charge && typeof pi.latest_charge === 'object' ? { ...pi, latest_charge: pi.latest_charge.id } : pi)
    }
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)\/cancel$/)) && method === 'POST') {
      const pi = intents.get(m[1]); if (!pi) return err(404, 'No such payment_intent')
      if (pi.status === 'succeeded') return err(400, 'You cannot cancel this PaymentIntent because it has a status of succeeded.', 'payment_intent_unexpected_state')
      pi.status = 'canceled'; return json(pi)
    }
    // An incremental authorisation, as Stripe documents it (docs.stripe.com/terminal/features/incremental-authorizations):
    // only on a card_present PaymentIntent that asked for it when made (payment_method_options[card_present]
    // [request_incremental_authorization_support]=true) and is requires_capture; the new amount is above the old; the card
    // may refuse (card_declined), and a card that cannot do it at all answers incremental_authorization_not_supported.
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)\/increment_authorization$/)) && method === 'POST') {
      const pi = intents.get(m[1]); if (!pi) return err(404, 'No such payment_intent')
      if (pi.status !== 'requires_capture') return err(400, `This PaymentIntent could not be incremented because it has a status of ${pi.status}.`, 'payment_intent_unexpected_state')
      if (pi.payment_method_options?.card_present?.request_incremental_authorization_support !== 'true') return err(400, 'This PaymentIntent does not support incremental authorizations.', 'incremental_authorization_not_supported')
      const amount = Number(param(params, 'amount'))
      if (!(amount > pi.amount)) return err(400, 'The amount must be greater than the current amount.', 'parameter_invalid_integer')
      if (state.declineIncrement) return err(402, 'Your card was declined.', 'card_declined')
      Object.assign(pi, { amount, amount_capturable: amount })
      return json(pi)
    }
    if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)\/capture$/)) && method === 'POST') {
      const pi = intents.get(m[1]); if (!pi) return err(404, 'No such payment_intent')
      if (pi.status !== 'requires_capture' && !(pi.status === 'requires_payment_method' && pi.capture_method === 'manual')) return err(400, `This PaymentIntent could not be captured because it has a status of ${pi.status}.`, 'payment_intent_unexpected_state')
      const want = param(params, 'amount_to_capture') ? Number(param(params, 'amount_to_capture')) : pi.amount
      // Stripe captures up to what was authorised, never more: raising the hold is increment_authorization, above.
      if (want > pi.amount) return err(400, `The amount_to_capture (${want}) must be less than or equal to the amount_capturable (${pi.amount}).`, 'amount_too_large')
      Object.assign(pi, { status: 'succeeded', amount_received: want, amount_capturable: 0 })
      return json(pi)
    }
    if (p === '/v1/refunds' && method === 'POST') {
      const metadata: Record<string, string> = {}
      for (const [k, v] of params) { const mm = k.match(/^metadata[(.+)]$/); if (mm) metadata[mm[1]] = v }
      const r = { id: `re_${++state.n}`, object: 'refund', status: 'succeeded', amount: Number(param(params, 'amount')), payment_intent: param(params, 'payment_intent'), metadata, created: Math.floor(Date.now() / 1000) + state.n }
      refunds.push(r); return json(r)
    }
    if (p === '/v1/refunds' && method === 'GET') return json({ object: 'list', has_more: false, data: refunds.filter((r) => r.payment_intent === u.searchParams.get('payment_intent')).slice().reverse() })
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
  /** The cardholder confirmed the SetupIntent in the browser: the card is saved. */
  const completeSetup = (id: string, pm: string) => { Object.assign(setups.get(id), { status: 'succeeded', payment_method: pm }) }
  /** The cardholder paid a PaymentIntent in the browser. */
  const succeedIntent = (id: string, pm = 'pm_card') => { const pi = intents.get(id); Object.assign(pi, { status: 'succeeded', amount_received: pi.amount, payment_method: pm }) }
  // ── Bank debits (ACH), as Stripe documents them (docs.stripe.com/payments/ach-direct-debit): confirming a us_bank_account
  // PaymentIntent leaves it PROCESSING (up to four business days; `payment_intent.processing`); it then SUCCEEDS
  // (`payment_intent.succeeded`) or goes back to requires_payment_method with last_payment_error (`payment_intent.payment_failed`).
  // A bank that must be verified with micro-deposits sits in requires_action (next_action.verify_with_microdeposits) until verified.
  const mandateFor = (pm: string) => { const md = { id: `mandate_${++state.n}`, object: 'mandate', status: 'active', type: 'multi_use', payment_method: pm, customer_acceptance: { type: 'online', accepted_at: Math.floor(Date.now() / 1000), online: { ip_address: '203.0.113.7', user_agent: 'test' } }, payment_method_details: { type: 'us_bank_account', us_bank_account: { collection_method: 'paperless' } } }; mandates.set(md.id, md); return md.id }
  /** The client confirmed a PaymentIntent with their bank account in the browser: processing, or (micro-deposits) waiting to be verified. */
  const confirmBankIntent = (id: string, pm = 'pm_bank_ok', opts: { microdeposits?: boolean } = {}) => {
    const pi = intents.get(id)
    Object.assign(pi, { payment_method: pm, last_payment_error: null })
    if (opts.microdeposits) Object.assign(pi, { status: 'requires_action', next_action: { type: 'verify_with_microdeposits', verify_with_microdeposits: { arrival_date: Math.floor(Date.now() / 1000) + 2 * 86400, hosted_verification_url: `https://payments.stripe.com/microdeposit/pacs_test_${pi.id}`, microdeposit_type: 'descriptor_code' } } })
    else Object.assign(pi, { status: 'processing', next_action: null })
    if (pi.setup_future_usage) pi.mandate = mandateFor(pm)
    return pi
  }
  /** The client verified the micro-deposits: the debit is now processing. */
  const verifyBankIntent = (id: string) => Object.assign(intents.get(id), { status: 'processing', next_action: null })
  /** The bank settled the debit. */
  const settleBank = (id: string) => { const pi = intents.get(id); return Object.assign(pi, { status: 'succeeded', amount_received: pi.amount, latest_charge: `ch_${pi.id}`, next_action: null }) }
  /** The bank returned the debit (or the micro-deposits were never verified): back to requires_payment_method with the reason. */
  const failBank = (id: string, code = 'insufficient_funds', message = 'The customer\u2019s account has insufficient funds to cover the payment.') => Object.assign(intents.get(id), { status: 'requires_payment_method', payment_method: null, next_action: null, last_payment_error: { type: 'invalid_request_error', code, message } })
  /** The cardholder-equivalent for a SetupIntent: the bank account was linked and the mandate accepted (or must be verified first). */
  const confirmBankSetup = (id: string, pm = 'pm_bank_ok', opts: { microdeposits?: boolean } = {}) => {
    const si = setups.get(id)
    Object.assign(si, { payment_method: pm, mandate: mandateFor(pm) })
    if (opts.microdeposits) Object.assign(si, { status: 'requires_action', next_action: { type: 'verify_with_microdeposits', verify_with_microdeposits: { arrival_date: Math.floor(Date.now() / 1000) + 2 * 86400, hosted_verification_url: `https://payments.stripe.com/microdeposit/pacs_test_${si.id}`, microdeposit_type: 'descriptor_code' } } })
    else Object.assign(si, { status: 'succeeded', next_action: null })
    return si
  }
  const verifyBankSetup = (id: string) => Object.assign(setups.get(id), { status: 'succeeded', next_action: null })
  /** The event Stripe sends (through the Factory's Connect forwarder) when an object changes: the object as it is now. */
  const eventFor = (type: string, object: any, account = 'acct_biz') => ({ id: `evt_${++state.n}`, object: 'event', type, account, data: { object: JSON.parse(JSON.stringify(object)) } })
  /** A refund made in Stripe's own dashboard (not through this app): no metadata. */
  const dashboardRefund = (paymentIntent: string, amount: number) => { const r = { id: `re_${++state.n}`, object: 'refund', status: 'succeeded', amount, payment_intent: paymentIntent, metadata: {}, created: Math.floor(Date.now() / 1000) + state.n }; refunds.push(r); return r }
  return { calls, state, readers, intents, sessions, setups, mandates, refunds, dashboardRefund, detached, completeSetup, succeedIntent, confirmBankIntent, verifyBankIntent, settleBank, failBank, confirmBankSetup, verifyBankSetup, eventFor, handle, paySession, posts: (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path) }
}

/**
 * `sharedStripe`: give the app the platform Stripe client as production has it (the payments module's — webhooks such as a
 * charge refunded in Stripe's own dashboard), pointed at the fake above. Off: the module has none, as these suites always ran.
 */
export async function bootFood(opts: { vertical?: string; features: string[]; adminDist?: string; sharedStripe?: boolean }) {
  const stripe = terminalStripeFake()
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://api.stripe.com/')) return stripe.handle(url, init)
    return realFetch(input, init)
  }) as any
  const t = await bootTenant({ vertical: opts.vertical ?? 'bar', ...(opts.adminDist ? { adminDist: opts.adminDist } : {}), ...(opts.sharedStripe ? { stripe: new Stripe('sk_test_food_service', { apiVersion: '2023-10-16' as any, httpClient: Stripe.createFetchHttpClient() }) } : {}) })
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
