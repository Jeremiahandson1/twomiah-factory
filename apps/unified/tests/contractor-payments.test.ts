// Contractor parity row 12 (part b) — against a fake Stripe (docs/parity/contractor-payments.md; Jobber / Buildertrend / JobTread
// Payments): card, bank or both per invoice (the payment method types Stripe is asked for); a tip on an online payment, recorded as
// the payment's tip and never as money toward the invoice; a payment plan whose installments add up to the total, whose next one
// is the invoice's due date (so the automatic reminders follow it) and the portal's offered amount. Fails without the change.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { documentLinkToken, FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { evenPlan } from '../web/src/crm/evenPlan.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', homeId = ''
const created: any[] = []
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }
const fakeStripe: any = {
  customers: { create: async () => ({ id: 'cus_1' }), retrieve: async () => ({ id: 'cus_1' }) },
  paymentMethods: { retrieve: async (id: string) => ({ id, type: 'card', card: { funding: 'credit' } }) },
  paymentIntents: { create: async (args: any, opts: any) => { created.push({ args, opts }); return { id: `pi_${created.length}`, client_secret: 'sec', status: 'requires_payment_method', amount: args.amount } } },
}
const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const BASE = ['contacts', 'invoices', 'online_payments']
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const portal = async (path: string, body: any) => json(await t.call(`/api/stripe/portal/${path}`, { method: 'POST', json: body }))
async function sentInvoice(price: number) {
  const inv = await json(await auth('/api/invoices', { method: 'POST', json: { contactId: homeId, lineItems: [{ description: 'Kitchen', quantity: 1, unitPrice: price }] } }))
  await t.db.update(t.schema.invoice).set({ status: 'sent' } as any).where(eq(t.schema.invoice.id, inv.body.id))
  return { id: inv.body.id as string, token: (await documentLinkToken(t.db, t.schema.invoice, inv.body.id)) as string }
}
const paidEvent = (pi: any, amount: number) => ({ event: { type: 'payment_intent.succeeded', account: 'acct_builder', data: { object: { id: `pi_evt_${created.length}`, amount, created: Math.floor(Date.now() / 1000), payment_method_types: ['card'], metadata: pi.args.metadata } } } })

beforeAll(async () => {
  setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_builder')
  setEnv('FACTORY_SYNC_KEY', 'factory-key')
  t = await bootTenant({ vertical: 'contractor', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_builder' } } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(['payment_method_choice', 'invoice_tips', 'payment_plans'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  // Tips are the business's own switch on the Card payments page, which the feature offers (contractor live test 11/07: "No tip switch").
  expect((await t.call('/api/card-payments/tips', { method: 'PUT', json: { on: true }, headers: { Authorization: `Bearer ${owner}` } })).status).toBe(200)
  homeId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', type: 'client' } as any).returning()) as any[])[0].id
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

describe('row 12b', () => {
  test('the three switches are registered, not ready, and the general contractor’s', () => {
    for (const id of ['payment_method_choice', 'invoice_tips', 'payment_plans']) {
      const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
      expect([id, f?.hidden, f?.templates]).toEqual([id, true, ['crm']])
    }
  })

  test('card, bank or both: what Stripe is asked to offer', async () => {
    const inv = await sentInvoice(1000)
    const ask = async () => { await portal('payment-intent', { invoiceId: inv.id, linkToken: inv.token }); return created.at(-1).args }
    expect((await ask()).automatic_payment_methods).toEqual({ enabled: true })
    expect((await json(await auth(`/api/invoice-payments/${inv.id}/methods`, { method: 'PUT', json: { paymentMethods: 'bank' } }))).body).toEqual({ paymentMethods: 'bank' })
    const bank = await ask()
    expect([bank.payment_method_types, bank.automatic_payment_methods]).toEqual([['us_bank_account'], undefined])
    await auth(`/api/invoice-payments/${inv.id}/methods`, { method: 'PUT', json: { paymentMethods: 'card' } })
    expect((await ask()).payment_method_types).toEqual(['card'])
    await auth(`/api/invoice-payments/${inv.id}/methods`, { method: 'PUT', json: { paymentMethods: 'both' } })
    expect((await ask()).automatic_payment_methods).toEqual({ enabled: true })
    expect((await auth(`/api/invoice-payments/${inv.id}/methods`, { method: 'PUT', json: { paymentMethods: 'cash' } })).status).toBe(400)
  }, 90_000)

  test('a tip rides on top, is kept as the payment’s tip, and the invoice is paid exactly', async () => {
    const inv = await sentInvoice(500)
    const r = await portal('payment-intent', { invoiceId: inv.id, linkToken: inv.token, tip: 50 })
    expect(r.body.tip).toBe(50)
    const pi = created.at(-1)
    expect([pi.args.amount, pi.args.metadata.tip_cents]).toEqual([55000, '5000'])
    expect((await portal('payment-intent', { invoiceId: inv.id, linkToken: inv.token, tip: 600 })).status).toBe(400)
    for (let i = 0; i < 2; i++) expect((await t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key' }, json: paidEvent(pi, 55000) })).status).toBe(200)
    const [row] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id)) as any[]
    expect([row.status, Number(row.amountPaid)]).toEqual(['paid', 500])
    const pays = await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, inv.id)) as any[]
    expect(pays.map((p) => [Number(p.amount), Number(p.tipAmount)])).toEqual([[500, 50]])
    // off: refused in words
    await setFeatures(['payment_method_choice', 'payment_plans'])
    const inv2 = await sentInvoice(100)
    expect((await portal('payment-intent', { invoiceId: inv2.id, linkToken: inv2.token, tip: 5 })).body.error).toBe('This business does not take tips online.')
    await setFeatures(['payment_method_choice', 'invoice_tips', 'payment_plans'])
  }, 90_000)

  test('a payment plan: adds up to the total, the due date follows the next installment, the portal offers it', async () => {
    const inv = await sentInvoice(3000)
    const bad = await json(await auth(`/api/invoice-payments/${inv.id}/plan`, { method: 'PUT', json: { installments: [{ dueDate: '2026-12-01', amount: 1000 }, { dueDate: '2027-01-01', amount: 1000 }] } }))
    expect([bad.status, bad.body.error]).toEqual([400, 'The installments come to 2000.00; the invoice is 3000.00. They must add up to it exactly.'])
    const plan = evenPlan(3000, 3, '2026-12-01')
    expect(plan.map((p) => [p.dueDate, p.amount])).toEqual([['2026-12-01', 1000], ['2027-01-01', 1000], ['2027-02-01', 1000]])
    const ok = await json(await auth(`/api/invoice-payments/${inv.id}/plan`, { method: 'PUT', json: { installments: plan } }))
    expect(ok.body.next).toEqual({ dueDate: '2026-12-01', owed: 1000 })
    let [row] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id)) as any[]
    expect(new Date(row.dueDate).toISOString().slice(0, 10)).toBe('2026-12-01')
    // the customer's copy: the plan, and part payment on with it
    const view = await json(await t.call(`/api/portal/d/${inv.token}/invoices/${inv.id}`))
    expect([view.body.partPayment, view.body.plan.next, view.body.tips]).toEqual([true, { dueDate: '2026-12-01', owed: 1000 }, true])
    // the first installment paid from the office: the due date moves to the second
    expect((await auth(`/api/invoices/${inv.id}/payments`, { method: 'POST', json: { amount: 1000, method: 'check' } })).status).toBeLessThan(300)
    // the after-payment steps run beside the reply, never holding it up: give them a moment
    for (let i = 0; i < 40; i++) {
      ;[row] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id)) as any[]
      if (new Date(row.dueDate).toISOString().slice(0, 10) === '2027-01-01') break
      await Bun.sleep(50)
    }
    expect(new Date(row.dueDate).toISOString().slice(0, 10)).toBe('2027-01-01')
    const after = await json(await auth(`/api/invoice-payments/${inv.id}/plan`))
    expect(after.body.installments.map((i: any) => i.state)).toEqual(['paid', expect.any(String), expect.any(String)])
  }, 90_000)

  test('off: no plan or method routes', async () => {
    await setFeatures([])
    const inv = await sentInvoice(100)
    expect((await auth(`/api/invoice-payments/${inv.id}/plan`)).status).toBe(404)
    expect((await auth(`/api/invoice-payments/${inv.id}/methods`, { method: 'PUT', json: { paymentMethods: 'card' } })).status).toBe(404)
  }, 90_000)
})
