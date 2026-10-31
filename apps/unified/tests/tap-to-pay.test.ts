// Tap to Pay on the phone (tap_to_pay, not ready) — the server's half, through the real server with a FAKE Stripe (nothing
// here reaches Stripe): the phone's Terminal SDK gets a connection token and the business's location, an in-person
// PaymentIntent for an invoice, and the server records the tap once Stripe says it succeeded.
//   · off without the feature (and without Online Payments); a seat that may not record payments is refused;
//   · everything is on the business's own connected account; none connected → refused in words, no Stripe call;
//   · the location is made once from the business's address (none → refused, saying what to add) and kept;
//   · the PaymentIntent is card_present for what is owed (or less), never more; a draft or void invoice is refused;
//   · recording: only a succeeded (or captured) tap of THIS business is written; written once, however often it is sent,
//     and Stripe's own webhook for it later is a repeat.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any })
const calls: Array<{ what: string; args?: any; opts?: any; id?: string }> = []
const intents = new Map<string, any>()
let n = 0
const fakeStripe: any = {
  terminal: {
    locations: { create: async (args: any, opts: any) => { calls.push({ what: 'location', args, opts }); return { id: `tml_${++n}` } } },
    connectionTokens: { create: async (args: any, opts: any) => { calls.push({ what: 'token', args, opts }); return { secret: `pst_test_${++n}` } } },
  },
  paymentIntents: {
    create: async (args: any, opts: any) => { calls.push({ what: 'pi', args, opts }); const id = `pi_${++n}`; const pi = { id, client_secret: `${id}_secret`, status: 'requires_payment_method', amount: args.amount, metadata: args.metadata }; intents.set(id, { ...pi, account: opts?.stripeAccount }); return pi },
    retrieve: async (id: string, opts: any) => { calls.push({ what: 'retrieve', id, opts }); const pi = intents.get(id); if (!pi || pi.account !== opts?.stripeAccount) throw new Error('No such payment_intent'); return pi },
    capture: async (id: string, _a: any, opts: any) => { calls.push({ what: 'capture', id, opts }); const pi = intents.get(id); pi.status = 'succeeded'; return pi },
  },
}

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', contactId = ''
const tokens: Record<string, string> = {}
const as = (who: string) => async (p: string, init: any = {}): Promise<Response> => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'online_payments']
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const setCompany = (patch: any) => t.db.update(t.schema.company).set(patch).where(eq(t.schema.company.id, companyId))
const token = (who = 'owner') => as(who)('/api/stripe/tap-to-pay/connection-token', { method: 'POST' }).then(json)
const intent = (invoiceId: string, body: any = {}, who = 'owner') => as(who)(`/api/stripe/tap-to-pay/invoices/${invoiceId}/intent`, { method: 'POST', json: body }).then(json)
const record = (pi: string, who = 'owner') => as(who)(`/api/stripe/tap-to-pay/payments/${pi}/record`, { method: 'POST' }).then(json)
async function sentInvoice(total = 200) {
  const inv = await json(await as('owner')('/api/invoices', { method: 'POST', json: { contactId, lineItems: [{ description: 'Repair', quantity: 1, unitPrice: total }], taxRate: 0 } }))
  expect(inv.status).toBe(201)
  await as('owner')(`/api/invoices/${inv.body.id}/send`, { method: 'POST' })
  return inv.body.id as string
}
const paymentsOn = async (invoiceId: string) => (await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, invoiceId))) as any[]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  tokens.owner = await login('owner@test.example', s.password)
  await t.db.insert(t.schema.user).values({ email: 'view@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId } as any)
  tokens.viewer = await login('view@test.example', 'Seat-pass-1')
  contactId = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Client', email: 'pat@x.example', type: 'client' } as any).returning() as any[])[0].id
  await setCompany({ name: 'Acme Heating', address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701', integrations: { stripeAccountId: 'acct_biz' } } as any)
  await setFeatures(FEATURES)
}, 120_000)

describe('off until switched on, and for the seats that record payments', () => {
  test('without tap_to_pay the routes are refused, and Stripe is never called', async () => {
    expect((await token()).status).toBe(403)
    expect(calls).toEqual([])
  })
  test('a viewer is refused', async () => {
    await setFeatures([...FEATURES, 'tap_to_pay'])
    expect((await token('viewer')).status).toBe(403)
  })
})

describe('the connection', () => {
  test('no connected Stripe account: refused in words, no Stripe call', async () => {
    await setCompany({ integrations: {} } as any)
    const r = await token()
    expect([r.status, r.body.code]).toEqual([400, 'stripe_not_connected'])
    expect(calls).toEqual([])
    await setCompany({ integrations: { stripeAccountId: 'acct_biz' } } as any)
  })
  test('the location is made once from the address, on the business\'s account; the token names it', async () => {
    const a = await token()
    expect(a.status).toBe(200)
    expect(a.body.secret).toMatch(/^pst_test_/)
    const b = await token()
    expect(b.body.locationId).toBe(a.body.locationId)
    const made = calls.filter((c) => c.what === 'location')
    expect(made.length).toBe(1)
    expect(made[0].args.address).toMatchObject({ line1: '1 Main St', city: 'Eau Claire', state: 'WI', postal_code: '54701' })
    expect(calls.filter((c) => c.what === 'location' || c.what === 'token').every((c) => c.opts?.stripeAccount === 'acct_biz')).toBe(true)
  })
})

describe('taking a tap on an invoice', () => {
  let invoiceId = ''
  test('a card_present PaymentIntent for what is owed, on the business\'s account; never more than owed', async () => {
    invoiceId = await sentInvoice(200)
    const r = await intent(invoiceId)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ amount: 200, clientSecret: expect.stringContaining('_secret') })
    const pi = calls.filter((c) => c.what === 'pi').at(-1)!
    expect(pi.args).toMatchObject({ amount: 20000, currency: 'usd', payment_method_types: ['card_present'] })
    expect(pi.args.metadata).toMatchObject({ invoice_id: invoiceId, company_id: companyId, kind: 'tap_to_pay' })
    expect(pi.opts.stripeAccount).toBe('acct_biz')
    expect((await intent(invoiceId, { amount: 250 })).body.code).toBe('over_balance')
    expect((await intent(invoiceId, { amount: 50 })).body.amount).toBe(50)
  })

  test('only a succeeded tap is recorded — once, however often; a captured authorisation too', async () => {
    const r = await intent(invoiceId, { amount: 120 })
    const pi = r.body.paymentIntentId
    const early = await record(pi)
    expect([early.status, early.body.recorded]).toEqual([200, false])
    expect(await paymentsOn(invoiceId)).toEqual([])
    intents.get(pi).status = 'succeeded'
    const done = await record(pi)
    expect(done.body).toMatchObject({ recorded: true, amount: 120 })
    const again = await record(pi)
    expect(again.body.duplicate).toBe(true)
    expect((await paymentsOn(invoiceId)).map((p) => Number(p.amount))).toEqual([120])
    // An authorised-only tap is captured, then recorded.
    const r2 = await intent(invoiceId, { amount: 80 })
    intents.get(r2.body.paymentIntentId).status = 'requires_capture'
    expect((await record(r2.body.paymentIntentId)).body).toMatchObject({ recorded: true, amount: 80 })
    expect(calls.some((c) => c.what === 'capture' && c.id === r2.body.paymentIntentId)).toBe(true)
    // Paid in full: nothing more can be tapped.
    expect((await intent(invoiceId)).body.code).toBe('nothing_owed')
  })

  test("another business's PaymentIntent, or one that is not a tap, is not found", async () => {
    intents.set('pi_other', { id: 'pi_other', status: 'succeeded', amount: 100, metadata: { company_id: 'someone-else', kind: 'tap_to_pay', invoice_id: invoiceId }, account: 'acct_biz' })
    intents.set('pi_web', { id: 'pi_web', status: 'succeeded', amount: 100, metadata: { company_id: companyId, kind: 'invoice', invoice_id: invoiceId }, account: 'acct_biz' })
    expect((await record('pi_other')).status).toBe(404)
    expect((await record('pi_web')).status).toBe(404)
    expect((await record('pi_missing')).status).toBe(404)
  })

  test('a draft invoice is refused', async () => {
    const draft = await json(await as('owner')('/api/invoices', { method: 'POST', json: { contactId, lineItems: [{ description: 'X', quantity: 1, unitPrice: 10 }] } }))
    expect((await intent(draft.body.id)).status).toBe(400)
  })
})
