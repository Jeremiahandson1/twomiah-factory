// Roofing parity row 16 — pay any amount, pay from the estimate (JobNimbus; portal_pay_options, not ready), against a fake Stripe:
//   · the invoice page says the customer may choose the amount only where the switch is on; the server takes a part amount from $1
//     up to the balance and refuses the rest;
//   · an approved quote's page offers paying toward it (what is left), the payment raises a sent invoice billed on the quote, the
//     page goes to its link; a second press reuses the unpaid one; more than is left is refused; a draft quote is not payable;
//   · off: neither is offered, and the pay route is a 404.
// Fails without the change: the page had no amount box and quotes could not be paid from their page.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { documentLinkToken } from '@twomiah/tenant-backend'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let homeId = ''
const stripeCalls: any[] = []
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }
const fakeStripe = {
  customers: { create: async () => ({ id: 'cus_1' }), retrieve: async () => ({ id: 'cus_1' }) },
  paymentIntents: { create: async (args: any, opts: any) => { stripeCalls.push({ args, opts }); return { id: `pi_${stripeCalls.length}`, client_secret: 's', amount: args.amount } } },
}
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const BASE = ['jobs', 'contacts', 'invoices', 'quotes', 'online_payments']
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  setEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_roof')
  t = await bootTenant({ vertical: 'roofing', stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_roofer' } } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(['portal_pay_options'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  homeId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', type: 'client' } as any).returning()) as any[])[0].id
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

async function sentInvoice(price: number) {
  const inv = await json(await auth('/api/invoices', { method: 'POST', json: { contactId: homeId, lineItems: [{ description: 'Roof', quantity: 1, unitPrice: price }] } }))
  expect(inv.status).toBe(201)
  await t.db.update(t.schema.invoice).set({ status: 'sent' } as any).where(eq(t.schema.invoice.id, inv.body.id))
  return { id: inv.body.id as string, token: (await documentLinkToken(t.db, t.schema.invoice, inv.body.id)) as string }
}
async function approvedQuote(price: number) {
  const q = await json(await auth('/api/quotes', { method: 'POST', json: { contactId: homeId, name: 'Re-roof', lineItems: [{ description: 'Tear off and shingle', quantity: 1, unitPrice: price }] } }))
  expect(q.status).toBe(201)
  await t.db.update(t.schema.quote).set({ status: 'approved', approvedAt: new Date() } as any).where(eq(t.schema.quote.id, q.body.id))
  return { id: q.body.id as string, token: (await documentLinkToken(t.db, t.schema.quote, q.body.id)) as string }
}

describe('row 16: the amount box', () => {
  test('the invoice page offers choosing the amount; the server takes $1 up to the balance', async () => {
    const inv = await sentInvoice(5000)
    const page = await json(await t.call(`/api/portal/d/${inv.token}/invoices/${inv.id}`))
    expect([page.status, page.body.partPayment, page.body.payOnline]).toEqual([200, true, true])
    const part = await json(await t.call('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: inv.token, amount: 1250 } }))
    expect(part.status).toBe(200)
    expect(stripeCalls.at(-1).args.amount).toBe(125000)
    expect((await json(await t.call('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: inv.token, amount: 0.25 } }))).status).toBe(400)
    expect((await json(await t.call('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: inv.token, amount: 9000 } }))).status).toBe(400)
    expect((await json(await t.call('/api/stripe/portal/payment-intent', { method: 'POST', json: { invoiceId: inv.id, linkToken: inv.token, amount: 'lots' } }))).status).toBe(400)
  })
})

describe('row 16: pay from the estimate', () => {
  test('an approved quote offers what is left; paying raises a sent invoice on the quote and goes to its link; a second press reuses it', async () => {
    const q = await approvedQuote(12000)
    const page = await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}`))
    expect(page.body.payToward).toEqual({ left: '12000.00' })
    expect((await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}/pay`, { method: 'POST', json: { amount: 20000 } }))).status).toBe(409)
    expect((await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}/pay`, { method: 'POST', json: { amount: 0 } }))).status).toBe(400)
    const paid = await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}/pay`, { method: 'POST', json: { amount: 3000 } }))
    expect(paid.status).toBe(200)
    expect(paid.body.reused).toBe(false)
    expect(paid.body.path).toMatch(/^\/d\/[0-9a-f]{64}$/)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.billedQuoteId, q.id))
    expect([inv.status, Number(inv.total), inv.billKind]).toEqual(['sent', 3000, 'progress'])
    // The invoice's own page takes the card.
    const token = paid.body.path.replace('/d/', '')
    expect((await json(await t.call(`/api/portal/d/${token}/invoices/${inv.id}`))).body.balance).toBe(3000)
    // Pressed again before paying: the same invoice, not a second.
    const again = await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}/pay`, { method: 'POST', json: { amount: 500 } }))
    expect([again.body.reused, again.body.number]).toEqual([true, paid.body.number])
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.billedQuoteId, q.id))).length).toBe(1)
    // What is left now counts the invoice.
    expect((await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}`))).body.payToward).toEqual({ left: '9000.00' })
  })

  test('a quote not approved offers nothing and refuses; off, neither the box nor the pay is offered', async () => {
    const q = await approvedQuote(4000)
    await t.db.update(t.schema.quote).set({ status: 'sent' } as any).where(eq(t.schema.quote.id, q.id))
    expect((await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}`))).body.payToward).toBeUndefined()
    expect((await json(await t.call(`/api/portal/d/${q.token}/quotes/${q.id}/pay`, { method: 'POST', json: { amount: 100 } }))).status).toBe(400)

    await setFeatures([])
    try {
      const q2 = await approvedQuote(4000)
      expect((await json(await t.call(`/api/portal/d/${q2.token}/quotes/${q2.id}`))).body.payToward).toBeUndefined()
      expect((await json(await t.call(`/api/portal/d/${q2.token}/quotes/${q2.id}/pay`, { method: 'POST', json: { amount: 100 } }))).status).toBe(404)
      const inv = await sentInvoice(800)
      expect((await json(await t.call(`/api/portal/d/${inv.token}/invoices/${inv.id}`))).body.partPayment).toBeUndefined()
    } finally { await setFeatures(['portal_pay_options']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'portal_pay_options') as any
    // Opened to the general contractor's CRM too (contractor parity row 12, crm/billing/paymentTools.ts).
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof', 'crm']])
  })
})
