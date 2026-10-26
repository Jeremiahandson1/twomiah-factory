// The store takes Stripe on the business's CONNECTED account, as the rest of the app does (owner's decision, 2026-10-26):
//   · checkout makes its Checkout Session with the PLATFORM key and the Stripe-Account header — no key the owner pasted;
//   · the paid / refunded / dispute events arrive through the Factory's Connect forwarder (POST /api/stripe/factory-event,
//     X-Factory-Key) and are claimed by the store when they name one of its orders: an order is Paid only on Stripe's
//     word, once however often the event comes; anything else is left to the invoices;
//   · a refund goes back through the connected account;
//   · /api/admin/payments takes no Stripe secret key (Square and PayPal stay key-based — tests/store-checkout.test.ts);
//   · a store still on Stripe keys pasted before Connect keeps them working, and is told to connect; once it does, the
//     connected account is used.
// Stripe's API is answered by tests/storeKit.ts; nothing leaves the machine.
process.env.STRIPE_SECRET_KEY = 'sk_test_platform_store_connect'
process.env.FACTORY_SYNC_KEY = 'factory-key-store-connect'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'

const ACCT = 'acct_store_connected_1'
const PLATFORM_KEY = process.env.STRIPE_SECRET_KEY

let k: Awaited<ReturnType<typeof bootStore>>
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 0 })
  await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, qty: 10 })
}, 120_000)
afterAll(() => k.restore())

/** Connect Stripe as Settings › Integrations leaves it: the account id on company.integrations. */
const connectAccount = (id: string | null) => (k.t.db as any).update(k.S.company).set({ integrations: id ? { stripeAccountId: id } : {} }).where(eq(k.S.company.id, k.companyId))
/** An event on the connected account, as the Factory forwards it (apps/api services/connectWebhook.ts). */
const factoryEvent = (type: string, object: unknown, key = process.env.FACTORY_SYNC_KEY!) =>
  k.pub('POST', '/api/stripe/factory-event', { event: { id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, account: ACCT, data: { object } } }, { 'X-Factory-Key': key })
const checkout = () => k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'ada@example.com' })
const sessionOf = (r: { json: any }) => new URL(r.json.url).pathname.split('/').pop()!

describe('a store on Stripe keys pasted before Connect', () => {
  test('keeps taking orders on those keys and is told to connect instead', async () => {
    await k.connectStripe()
    const st = await k.O('GET', '/api/admin/payments')
    expect(st.status).toBe(200)
    expect(st.json.stripeKeysToReplace).toBe(true)
    expect(st.json.config).toMatchObject({ provider: 'stripe', via: 'keys', connected: true })
    const r = await checkout()
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.key).toBe('sk_test_store_upgrade')
    expect(call.account).toBeNull()
  })

  test('once Stripe is connected, the connected account is used and the old keys are not', async () => {
    await connectAccount(ACCT)
    const r = await checkout()
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.account).toBe(ACCT)
    expect(call.key).toBe(PLATFORM_KEY)
    const st = await k.O('GET', '/api/admin/payments')
    expect(st.json.stripeKeysToReplace).toBe(false)
    expect(st.json.config).toMatchObject({ provider: 'stripe', via: 'connect', connected: true, hasWebhookSecret: true })
    // Never the account's id, never a key.
    expect(JSON.stringify(st.json)).not.toContain(ACCT)
    expect(JSON.stringify(st.json)).not.toContain('sk_')
    // The pasted keys go; the connected account carries on alone.
    await (k.t.db as any).delete(k.S.paymentConfig).where(eq(k.S.paymentConfig.companyId, k.companyId))
  })
})

describe('checkout on the connected account', () => {
  let orderId = '', sid = '', pi = ''
  test('the storefront is open and the Checkout Session is made on the account with the platform key — no pasted key exists', async () => {
    expect((await (k.t.db as any).select().from(k.S.paymentConfig)).length).toBe(0)
    expect((await k.pub('GET', '/api/public/settings')).json.checkoutEnabled).toBe(true)
    const r = await checkout()
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.account).toBe(ACCT)
    expect(call.key).toBe(PLATFORM_KEY)
    expect(call.params.get('line_items[0][price_data][unit_amount]')).toBe('2000')
    sid = sessionOf(r)
    const o = await k.orderBySession(sid)
    expect(o.status).toBe('pending')
    expect(o.provider).toBe('stripe')
    expect(o.totalCents).toBe(2500)
    orderId = o.id
    pi = `pi_${sid}`
  })

  test('the store\'s own webhook has no secret for it: a notice posted there is refused and pays nothing', async () => {
    const r = await k.webhook('checkout.session.completed', paidSession(sid, { amountTotal: 2500 }))
    expect(r.status).toBe(400)
    expect((await k.order(orderId)).status).toBe('pending')
  })

  test('a forward without the Factory\'s key is refused and pays nothing', async () => {
    const r = await factoryEvent('checkout.session.completed', paidSession(sid, { amountTotal: 2500 }), 'wrong')
    expect(r.status).toBe(401)
    expect((await k.order(orderId)).status).toBe('pending')
  })

  test('Stripe\'s word through the Connect forwarder pays the order — once, however often it comes', async () => {
    const stockBefore = (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, 'MUG-1')))[0].inventoryQty
    const a = await factoryEvent('checkout.session.completed', paidSession(sid, { amountTotal: 2500 }))
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ received: true, handled: true, store: true })
    const b = await factoryEvent('checkout.session.completed', paidSession(sid, { amountTotal: 2500 }))
    expect(b.status).toBe(200)
    await k.settle()
    const o = await k.order(orderId)
    expect(o.status).toBe('paid')
    expect(o.providerPaymentId).toBe(pi)
    const stockAfter = (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, 'MUG-1')))[0].inventoryQty
    expect(stockAfter).toBe(stockBefore - 1)
    expect(k.mails.filter((m) => m.template === 'storeOrderConfirmation').length).toBe(1)
  })

  test('a refund goes back through the connected account', async () => {
    const r = await k.O('POST', `/api/admin/orders/${orderId}/refunds`, { items: [], shippingCents: 0, amountCents: 900, restock: false })
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/refunds')!
    expect(call.account).toBe(ACCT)
    expect(call.key).toBe(PLATFORM_KEY)
    expect(call.params.get('payment_intent')).toBe(pi)
    expect(call.params.get('amount')).toBe('900')
    expect((await k.order(orderId)).refundedCents).toBe(900)
  })

  test('the refund\'s own notice, forwarded, is matched to it — not counted twice', async () => {
    const r = await factoryEvent('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: pi, amount: 2500, amount_refunded: 900, currency: 'usd' })
    expect(r.status).toBe(200)
    expect(r.json.store).toBe(true)
    expect((await k.order(orderId)).refundedCents).toBe(900)
  })

  test('a chargeback on the account marks the order', async () => {
    const dispute = { id: 'dp_connect_1', object: 'dispute', amount: 2500, currency: 'usd', charge: 'ch_1', payment_intent: pi, reason: 'fraudulent', status: 'needs_response', livemode: false, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 } }
    const r = await factoryEvent('charge.dispute.created', dispute)
    expect(r.status).toBe(200)
    expect(r.json.store).toBe(true)
    expect((await k.order(orderId)).disputeStatus).toBe('needs_response')
  })

  test('an event that names no store order is left to the invoices', async () => {
    const r = await factoryEvent('checkout.session.completed', paidSession('cs_not_a_store_order', { amountTotal: 100 }))
    expect(r.status).toBe(200)
    expect(r.json.store).toBeUndefined()
  })
})

describe('the Payments page\'s server', () => {
  test('takes no Stripe secret key — it points at Connect Stripe, and stores nothing', async () => {
    const r = await k.O('POST', '/api/admin/payments/connect', { provider: 'stripe', mode: 'test', secretKey: 'sk_test_pasted_by_owner' })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('stripe_uses_connect')
    expect(r.json.error).toContain('Connect Stripe')
    expect((await (k.t.db as any).select().from(k.S.paymentConfig)).length).toBe(0)
    expect(k.stripe.calls.some((c) => c.key === 'sk_test_pasted_by_owner')).toBe(false)
  })

  test('the page itself has no Stripe key field', async () => {
    const src = await Bun.file(new URL('../web/src/crm/pages/store/orders/PaymentsPage.tsx', import.meta.url)).text()
    expect(src).not.toContain('<option value="stripe">')
    expect(src).not.toContain('sk_test_… or sk_live_…')
    expect(src).toContain('/api/integrations/stripe/link-url')
    expect(src).toContain('/api/integrations/stripe/connect-url')
  })
})

describe("the store's own Connect buttons", () => {
  // The Stripe doors were gated by Online Payments, which a store doesn't have (its checkout is Orders): the store's
  // "I already have a Stripe account" answered "This module is not enabled" (store live test, 2026-10-26).
  test('a store owner reaches the create and link doors (not refused for a missing feature)', async () => {
    for (const path of ['/api/integrations/stripe/connect-url', '/api/integrations/stripe/link-url']) {
      const r = await k.O('GET', path)
      expect({ path, refusedForFeature: r.status === 403 && /not enabled/i.test(JSON.stringify(r.json)) }).toEqual({ path, refusedForFeature: false })
    }
  })
})
