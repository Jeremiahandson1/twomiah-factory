// Roofing parity row 18 — card fees passed on, and the payouts view (Roofr; data/cardSurcharge.ts, crm/roof/cardSurcharge.ts,
// tenant-backend payments/stripe.ts; card_surcharge and payments_overview, not ready), against a fake Stripe:
//   · the state rules: refused in CA, CT, ME, MA, TX, OK, PR; 2% in CO; the actual card rate in NY, NJ, NV, SD; 3% elsewhere; the
//     30-day notice confirmed before it can be on;
//   · a business that surcharges: the pay page is told to take the card first; a CREDIT card is quoted and charged the surcharge, a
//     debit card is not; the paid event adds "Card surcharge (x%)" to the invoice as its own line and the invoice is paid exactly;
//   · the payouts view reads the business's own Stripe account;
//   · off: the pay page is unchanged and the routes are shut.
// Fails without the change: none of it existed.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { documentLinkToken } from '@twomiah/tenant-backend'
import { surchargeRule, surchargeProblem } from '../server/data/cardSurcharge.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let homeId = ''
const created: any[] = []
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }
const fakeStripe: any = {
  customers: { create: async () => ({ id: 'cus_1' }), retrieve: async () => ({ id: 'cus_1' }) },
  paymentMethods: { retrieve: async (id: string) => ({ id, type: 'card', card: { funding: id.includes('debit') ? 'debit' : 'credit' } }) },
  paymentIntents: { create: async (args: any, opts: any) => { created.push({ args, opts }); return { id: `pi_${created.length}`, client_secret: 'sec', status: 'succeeded', amount: args.amount } } },
  balance: { retrieve: async () => ({ available: [{ amount: 125000, currency: 'usd' }], pending: [{ amount: 30000, currency: 'usd' }] }) },
  payouts: { list: async () => ({ data: [{ id: 'po_1', amount: 99000, status: 'paid', arrival_date: 1_780_000_000, failure_message: null }] }) },
}
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const BASE = ['jobs', 'contacts', 'invoices', 'online_payments']
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const setState = (state: string) => t.db.update(t.schema.company).set({ state } as any).where(eq(t.schema.company.id, companyId))

beforeAll(async () => {
  setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_roof')
  setEnv('FACTORY_SYNC_KEY', 'factory-key')
  t = await bootTenant({ vertical: 'roofing', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_roofer' }, state: 'WI' } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(['card_surcharge', 'payments_overview'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  homeId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', type: 'client' } as any).returning()) as any[])[0].id
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

async function sentInvoice(price: number) {
  const inv = await json(await auth('/api/invoices', { method: 'POST', json: { contactId: homeId, lineItems: [{ description: 'Roof', quantity: 1, unitPrice: price }] } }))
  await t.db.update(t.schema.invoice).set({ status: 'sent' } as any).where(eq(t.schema.invoice.id, inv.body.id))
  return { id: inv.body.id as string, token: (await documentLinkToken(t.db, t.schema.invoice, inv.body.id)) as string }
}
const portal = async (path: string, body: any) => json(await t.call(`/api/stripe/portal/${path}`, { method: 'POST', json: body }))

describe('row 18: the state rules', () => {
  test('refused, capped, actual rate, Visa’s 3%; on needs the 30-day notice', () => {
    for (const st of ['CA', 'CT', 'ME', 'MA', 'TX', 'OK', 'PR']) expect(surchargeRule(st).allowed).toBe(false)
    expect(surchargeRule('CO')).toMatchObject({ allowed: true, cap: 2 })
    expect(surchargeRule('ny')).toMatchObject({ allowed: true, cap: 3, needsActualFee: true })
    expect(surchargeRule('WI')).toMatchObject({ allowed: true, cap: 3, needsActualFee: false })
    expect(surchargeRule('').allowed).toBe(false)
    const ok = { on: true, pct: 3, actualFeePct: null, noticeGivenAt: '2026-10-01' }
    expect(surchargeProblem(ok, surchargeRule('WI'))).toBeNull()
    expect(surchargeProblem({ ...ok, pct: 3.5 }, surchargeRule('WI'))?.field).toBe('pct')
    expect(surchargeProblem({ ...ok, pct: 2.5 }, surchargeRule('CO'))?.field).toBe('pct')
    expect(surchargeProblem(ok, surchargeRule('NY'))?.field).toBe('actualFeePct')
    expect(surchargeProblem({ ...ok, actualFeePct: 2.7 }, surchargeRule('NY'))?.field).toBe('pct')
    expect(surchargeProblem({ ...ok, noticeGivenAt: null }, surchargeRule('WI'))?.field).toBe('noticeGivenAt')
  })

  test('the setting refuses a forbidden state, an over-cap percent and a missing notice', async () => {
    await setState('TX')
    expect((await auth('/api/card-payments/surcharge', { method: 'PUT', json: { on: true, pct: 2, noticeGiven: true } })).status).toBe(400)
    await setState('WI')
    expect((await auth('/api/card-payments/surcharge', { method: 'PUT', json: { on: true, pct: 4, noticeGiven: true } })).status).toBe(400)
    expect((await auth('/api/card-payments/surcharge', { method: 'PUT', json: { on: true, pct: 3 } })).status).toBe(400)
    const ok = await json(await auth('/api/card-payments/surcharge', { method: 'PUT', json: { on: true, pct: 3, noticeGiven: true } }))
    expect(ok.status).toBe(200)
    expect(ok.body.setting).toMatchObject({ on: true, pct: 3 })
    expect(ok.body.setting.noticeGivenAt).toBeTruthy()
  })
})

describe('row 18: paying with the surcharge', () => {
  test('the page takes the card first; credit is quoted and charged 3%, debit nothing', async () => {
    const inv = await sentInvoice(1000)
    const start = await portal('payment-intent', { invoiceId: inv.id, linkToken: inv.token })
    expect(start.body).toMatchObject({ deferred: true, surchargePct: 3, amount: 1000, stripeAccount: 'acct_roofer' })
    expect(start.body.clientSecret).toBeUndefined()
    const credit = await portal('surcharge-quote', { invoiceId: inv.id, linkToken: inv.token, paymentMethodId: 'pm_credit1' })
    expect(credit.body).toMatchObject({ funding: 'credit', surcharge: 30, total: 1030 })
    const debit = await portal('surcharge-quote', { invoiceId: inv.id, linkToken: inv.token, paymentMethodId: 'pm_debit1' })
    expect(debit.body).toMatchObject({ funding: 'debit', surcharge: 0, total: 1000 })
    expect((await portal('surcharge-quote', { invoiceId: inv.id, linkToken: inv.token, paymentMethodId: 'not-a-pm' })).status).toBe(400)
    // Pays: the amount is worked out again on the server; the surcharge rides in the metadata, on the roofer's account.
    const paid = await portal('surcharge-pay', { invoiceId: inv.id, linkToken: inv.token, paymentMethodId: 'pm_credit1', surcharge: 0.01 })
    expect(paid.status).toBe(200)
    const pi = created.at(-1)
    expect([pi.args.amount, pi.args.metadata.surcharge_cents, pi.args.metadata.surcharge_pct, pi.opts?.stripeAccount, pi.args.confirm]).toEqual([103000, '3000', '3', 'acct_roofer', true])
    // Stripe's paid event: the surcharge becomes its own line, the invoice is paid exactly; a retry adds nothing.
    const event = { event: { type: 'payment_intent.succeeded', account: 'acct_roofer', data: { object: { id: pi.args.metadata && 'pi_sur_1', amount: 103000, created: Math.floor(Date.now() / 1000), payment_method_types: ['card'], metadata: pi.args.metadata } } } }
    for (let i = 0; i < 2; i++) expect((await t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key' }, json: event })).status).toBe(200)
    const [row] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id))
    expect([row.status, Number(row.total), Number(row.amountPaid)]).toEqual(['paid', 1030, 1030])
    const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.id))
    expect(lines.filter((l: any) => l.description === 'Card surcharge (3%)').map((l: any) => Number(l.total))).toEqual([30])
  })

  test('a debit card is charged no surcharge', async () => {
    const inv = await sentInvoice(500)
    await portal('surcharge-pay', { invoiceId: inv.id, linkToken: inv.token, paymentMethodId: 'pm_debit2' })
    const pi = created.at(-1)
    expect(pi.args.amount).toBe(50000)
    expect(pi.args.metadata.surcharge_cents).toBeUndefined()
  })
})

describe('row 18: payouts, and off', () => {
  test('the payouts view reads the roofer’s own Stripe', async () => {
    const r = await json(await auth('/api/card-payments/payouts'))
    expect(r.body).toMatchObject({ available: 1250, pending: 300 })
    expect(r.body.payouts[0]).toMatchObject({ amount: 990, status: 'paid' })
  })

  test('off: the pay page is unchanged and the routes are shut; both switches are hidden and roofing’s', async () => {
    await setFeatures([])
    try {
      const inv = await sentInvoice(700)
      const start = await portal('payment-intent', { invoiceId: inv.id, linkToken: inv.token })
      expect(start.body.deferred).toBeUndefined()
      expect(start.body.clientSecret).toBeTruthy()
      expect((await auth('/api/card-payments/surcharge')).status).toBe(404)
      expect((await auth('/api/card-payments/payouts')).status).toBe(404)
      const q = await portal('surcharge-quote', { invoiceId: inv.id, linkToken: inv.token, paymentMethodId: 'pm_credit9' })
      expect(q.body.surcharge).toBe(0)
    } finally { await setFeatures(['card_surcharge', 'payments_overview']) }
    for (const id of ['card_surcharge', 'payments_overview']) {
      const f = FEATURE_REGISTRY.find((x: any) => x.id === id) as any
      expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof', 'crm']]) // the general contractor too (contractor parity row 12)
    }
  })
})
