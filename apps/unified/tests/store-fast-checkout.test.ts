// Parity row 6 against Shopify's accelerated checkout (2026-10-31): a signed-in shopper's card kept on the MERCHANT'S OWN Stripe
// customer — only after they agree — and paid in one tap at the next checkout and from order history; and Apple Pay / Google Pay /
// Link buttons on the product and cart pages. Behind store_fast_checkout (registered not ready), against the real server with
// Stripe answered in place (tests/storeKit.ts). Not here, because only an outside party can: Shop Pay's cross-merchant network,
// and anything that needs a real Apple Pay merchant domain or a real browser (Stripe.js is not run).
//   · CONSENT: nothing is kept for a shopper who did not tick the box; a guest cannot turn the feature on by sending the flag;
//   · ONE TAP: charges the kept card for exactly the order total (what a gift card pays is taken off), ships to the SAVED address
//     and prices for it, paid at once; a refusal leaves no order; the bank's confirmation page is followed and the success page finishes it;
//   · never offered when it cannot be honoured: no card, an expired card, Stripe Tax (tax is worked out on Stripe's page);
//   · the shopper can remove the card at any time (even with the feature off): detached at Stripe;
//   · wallet buttons: the server quotes and creates the order for the wallet's address; nothing is written by a quote.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootStore, paidSession, signedEvent } from './storeKit.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootStore>>
const A = '/api/public/account'
const db = () => k.t.db as any
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_accounts', 'store_fast_checkout']
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
let ann: any
let cookie = ''
let mug: any
const cookieOf = (res: { headers: Headers }) => (res.headers.get('set-cookie') || '').split(';')[0]
const signIn = async (email: string) => {
  const before = k.mails.filter((m) => m.to.toLowerCase() === email && m.template === 'storeSignIn').length
  await k.pub('POST', `${A}/sign-in`, { email })
  await k.settle()
  const mail = k.mails.filter((m) => m.to.toLowerCase() === email && m.template === 'storeSignIn')[before]
  const res = await k.pub('POST', `${A}/verify`, { email, code: mail.data.code })
  expect(res.status).toBe(200)
  return cookieOf(res)
}
const cardRow = async () => (await db().select().from(k.S.storeShopperCard).where(eq(k.S.storeShopperCard.contactId, ann.id)))[0]
const calls = (path: string | RegExp) => k.stripe.calls.filter((c) => (typeof path === 'string' ? c.path === path : path.test(c.path)))
const checkout = (body: Record<string, unknown>, who: string | null = cookie) => k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], ...body }, who ? { cookie: who } : {})
const ordersNow = async () => (await db().select().from(k.S.storeOrder)) as any[]
/** The kept card, as a paid payment leaves it: Stripe attached the card to the customer; the webhook says the order is paid. */
async function payByCheckoutAndKeep(save = true) {
  const r = await checkout(save ? { saveCard: true } : {})
  expect(r.status).toBe(200)
  const sid = (r.json.url as string).split('/').pop()!
  const o = await k.orderBySession(sid)
  const pi = `pi_keep_${sid}`
  const customer = (await cardRow())?.stripeCustomerId ?? null
  k.stripe.intents.set(pi, { id: pi, object: 'payment_intent', status: 'succeeded', customer, payment_method: 'pm_kept', metadata: {}, __card: { id: 'pm_kept', object: 'payment_method', type: 'card', customer, card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: new Date().getUTCFullYear() + 3 } } })
  await k.webhook('checkout.session.completed', paidSession(sid, { amountTotal: o.totalCents, email: 'ann@example.com', paymentIntent: pi }))
  await k.settle()
  return { o, pi }
}

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({
    companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 0,
    shippingZones: [{ name: 'California', countries: ['US'], states: ['CA'], rateCents: 1500 }],
  })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, qty: 20 })
  await k.product({ slug: 'bowl', name: 'Bowl', sku: 'BOWL-1', priceCents: 3000, qty: 20 })
  ;[ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann Able', email: 'ann@example.com', type: 'customer' }).returning()
  await db().insert(k.S.shopperAddress).values({ companyId: k.companyId, contactId: ann.id, name: 'Ann Able', label: 'Home', isDefault: true, address: { line1: '9 Ocean Ave', city: 'San Diego', state: 'CA', postalCode: '92101', country: 'US' } })
  await features(ON)
  cookie = await signIn('ann@example.com')
}, 120_000)
afterAll(() => k.restore())

describe('offered, never switched on', () => {
  test('registered not ready and offered to the store; off, nothing is kept or charged and the wallet routes are closed', async () => {
    const f = FEATURE_MAP.store_fast_checkout
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
    expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain('store_fast_checkout')
    await features(ON.filter((x) => x !== 'store_fast_checkout'))
    const me = await k.pub('GET', `${A}/me`, undefined, { cookie })
    expect(me.json.fastCheckout).toBe(false)
    expect(me.json.savedCard).toBeNull()
    const r = await checkout({ saveCard: true })
    expect(r.status).toBe(200)
    expect(String(r.json.url)).toContain('checkout.stripe.com')
    expect(calls('/v1/payment_intents').length).toBe(0)
    expect(await cardRow()).toBeUndefined()
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('payment_intent_data[setup_future_usage]')).toBeNull()
    expect((await k.pub('GET', '/api/public/express/config')).status).toBe(404)
    expect((await checkout({ useSavedCard: true })).json.url).toContain('checkout.stripe.com')
    await features(ON)
  })
})

describe('keeping the card', () => {
  test('only a signed-in shopper who ticks the box has their card kept: their own customer on the merchant account, and the payment page asked to keep it', async () => {
    const guest = await checkout({ saveCard: true }, null)
    expect(guest.status).toBe(200)
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('payment_intent_data[setup_future_usage]')).toBeNull()
    expect(await cardRow()).toBeUndefined()

    const plain = await checkout({})
    expect(plain.status).toBe(200)
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('payment_intent_data[setup_future_usage]')).toBeNull()
    expect(await cardRow()).toBeUndefined()

    const ticked = await checkout({ saveCard: true })
    expect(ticked.status).toBe(200)
    const sent = k.stripe.last('/v1/checkout/sessions')!.params
    expect(sent.get('payment_intent_data[setup_future_usage]')).toBe('on_session')
    const row = await cardRow()
    expect(row.stripeCustomerId).toMatch(/^cus_/)
    expect(row.consentAt).toBeTruthy()
    expect(row.paymentMethodId).toBeNull() // asked for, not kept until it is paid
    expect(sent.get('customer')).toBe(row.stripeCustomerId)
    const me = await k.pub('GET', `${A}/me`, undefined, { cookie })
    expect(me.json.fastCheckout).toBe(true)
    expect(me.json.savedCard).toBeNull()
  })

  test('once paid, the card the payment left on the customer is kept and shown as brand and last four — nothing that could be charged', async () => {
    await payByCheckoutAndKeep()
    const row = await cardRow()
    expect(row).toMatchObject({ paymentMethodId: 'pm_kept', brand: 'visa', last4: '4242' })
    const me = await k.pub('GET', `${A}/me`, undefined, { cookie })
    expect(me.json.savedCard).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: new Date().getUTCFullYear() + 3 })
    expect(JSON.stringify(me.json)).not.toContain('pm_kept')
    expect(JSON.stringify(me.json)).not.toContain(row.stripeCustomerId)
  })

  test('a payment that did not leave the card on the customer keeps nothing, and a shopper who never agreed has nothing kept even if Stripe attached one', async () => {
    await db().update(k.S.storeShopperCard).set({ paymentMethodId: null, brand: null, last4: null, expMonth: null, expYear: null }).where(eq(k.S.storeShopperCard.contactId, ann.id))
    k.stripe.state.cardAttached = false
    await payByCheckoutAndKeep()
    k.stripe.state.cardAttached = true
    expect((await cardRow()).paymentMethodId).toBeNull()
    // Never agreed: the consent is cleared, the next payment attaches a card at Stripe, and still nothing is kept.
    await db().update(k.S.storeShopperCard).set({ consentAt: null }).where(eq(k.S.storeShopperCard.contactId, ann.id))
    await payByCheckoutAndKeep(false)
    expect((await cardRow()).paymentMethodId).toBeNull()
  })
})

describe('one tap', () => {
  const keep = async (o: { expYear?: number; expMonth?: number } = {}) => {
    await db().update(k.S.storeShopperCard).set({
      paymentMethodId: 'pm_kept', brand: 'visa', last4: '4242', expMonth: o.expMonth ?? 12, expYear: o.expYear ?? new Date().getUTCFullYear() + 3, consentAt: new Date(),
    }).where(eq(k.S.storeShopperCard.contactId, ann.id))
  }
  test('charges the kept card for the order total at once, to the saved address and its shipping rate — never the typed region — with no payment page', async () => {
    await keep()
    const before = calls('/v1/checkout/sessions').length
    const r = await checkout({ useSavedCard: true, shipTo: { country: 'US', state: 'WI' } })
    expect(r.status).toBe(200)
    expect(calls('/v1/checkout/sessions').length).toBe(before)
    const pi = k.stripe.last('/v1/payment_intents')!.params
    const row = await cardRow()
    // 2 mugs + California's rate (1500), NOT the flat 500 the typed Wisconsin would have got.
    expect(pi.get('amount')).toBe('5500')
    expect(pi.get('customer')).toBe(row.stripeCustomerId)
    expect(pi.get('payment_method')).toBe('pm_kept')
    expect(pi.get('confirm')).toBe('true')
    expect(pi.get('shipping[address][line1]')).toBe('9 Ocean Ave')
    expect(pi.get('metadata[twomiah_flow]')).toBe('saved_card')
    expect(r.json.url).toContain('/checkout/success?ref=')
    const orderId = new URL(r.json.url).searchParams.get('ref')!
    const o = await k.order(orderId)
    expect(o).toMatchObject({ status: 'paid', totalCents: 5500, shippingCents: 1500, provider: 'stripe' })
    expect(o.providerSessionId).toMatch(/^pi_test_/)
    expect(o.shippingAddress).toMatchObject({ line1: '9 Ocean Ave', city: 'San Diego' })
    const variant = (await db().select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, mug.variant.id)))[0]
    expect(variant.inventoryQty).toBeLessThan(20)
    const summary = await k.pub('GET', `/api/public/order-summary?ref=${orderId}`)
    expect(summary.json).toMatchObject({ status: 'paid', totalCents: 5500 })
  })

  test('a refusal by the bank leaves no order and says what to do; the card stays', async () => {
    await keep()
    k.stripe.state.charge = 'declined'
    const n = (await ordersNow()).length
    const r = await checkout({ useSavedCard: true })
    k.stripe.state.charge = 'succeeded'
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('card_declined')
    expect(r.json.error).toContain('another card')
    expect((await ordersNow()).length).toBe(n)
    expect((await cardRow()).paymentMethodId).toBe('pm_kept')
  })

  test('a bank that wants confirmation sends the shopper to its page; coming back, the success page finds the payment and finishes the order', async () => {
    await keep()
    k.stripe.state.charge = 'requires_action'
    const r = await checkout({ useSavedCard: true })
    k.stripe.state.charge = 'succeeded'
    expect(r.status).toBe(200)
    expect(r.json.url).toContain('hooks.stripe.com/3d_secure/')
    const piId = (r.json.url as string).split('/').pop()!
    const pending = await k.orderBySession(piId)
    expect(pending.status).toBe('pending')
    // The shopper confirms with the bank: Stripe now says the payment succeeded.
    k.stripe.intents.get(piId).status = 'succeeded'
    k.stripe.intents.get(piId).amount_received = k.stripe.intents.get(piId).amount
    const summary = await k.pub('GET', `/api/public/order-summary?ref=${pending.id}`)
    expect(summary.json.status).toBe('paid')
    expect((await k.order(pending.id)).status).toBe('paid')
  })

  test('refused, with the reason, when it cannot be honoured: no kept card, an expired card, or tax worked out on Stripe\'s page; a guest cannot ask for it', async () => {
    await db().update(k.S.storeShopperCard).set({ paymentMethodId: null, brand: null, last4: null, expMonth: null, expYear: null }).where(eq(k.S.storeShopperCard.contactId, ann.id))
    const none = await checkout({ useSavedCard: true })
    expect(none.status).toBe(400)
    expect(none.json.code).toBe('card_unavailable')
    await keep({ expYear: new Date().getUTCFullYear() - 1 })
    expect((await checkout({ useSavedCard: true })).json.code).toBe('card_unavailable')
    await keep()
    await db().update(k.S.storeSettings).set({ stripeTaxEnabled: true }).where(eq(k.S.storeSettings.companyId, k.companyId))
    const taxed = await checkout({ useSavedCard: true })
    await db().update(k.S.storeSettings).set({ stripeTaxEnabled: false }).where(eq(k.S.storeSettings.companyId, k.companyId))
    expect(taxed.status).toBe(400)
    expect(taxed.json.code).toBe('card_unavailable')
    // A guest sending the flag gets the ordinary payment page, never a charge.
    const n = calls('/v1/payment_intents').length
    const guest = await checkout({ useSavedCard: true, customerEmail: 'ann@example.com' }, null)
    expect(guest.status).toBe(200)
    expect(String(guest.json.url)).toContain('checkout.stripe.com')
    expect(calls('/v1/payment_intents').length).toBe(n)
  })

  test('reorder and pay from order history: the same lines at today\'s prices, paid with the kept card; an order that has changed is not charged', async () => {
    await keep()
    const history = await k.pub('GET', `${A}/orders`, undefined, { cookie })
    const first = history.json.data.find((o: any) => o.items.some((i: any) => i.productName === 'Mug'))
    // Today's price is what is charged, not what was paid then.
    await db().update(k.S.storeProductVariant).set({ priceCents: 2200 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
    const lines = first.items.reduce((n: number, i: any) => n + i.quantity * 2200, 0)
    const r = await k.pub('POST', `${A}/orders/${first.id}/pay-again`, {}, { cookie })
    expect(r.status).toBe(200)
    expect(r.json.url).toContain('/checkout/success?ref=')
    const o = await k.order(r.json.orderId)
    expect(o.status).toBe('paid')
    expect(o.subtotalCents).toBe(lines)
    expect(k.stripe.last('/v1/payment_intents')!.params.get('amount')).toBe(String(o.totalCents))
    // Sold out: nothing is charged.
    await db().update(k.S.storeProductVariant).set({ inventoryQty: 0 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
    const n = calls('/v1/payment_intents').length
    const gone = await k.pub('POST', `${A}/orders/${first.id}/pay-again`, {}, { cookie })
    await db().update(k.S.storeProductVariant).set({ inventoryQty: 20, priceCents: 2000 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
    expect(gone.status).toBe(409)
    expect(gone.json.code).toBe('reorder_changed')
    expect(calls('/v1/payment_intents').length).toBe(n)
    // Someone else's order is not theirs to pay for.
    expect((await k.pub('POST', `${A}/orders/not-an-order/pay-again`, {}, { cookie })).status).toBe(404)
  })
})

describe('taking the card away', () => {
  test('the shopper removes it at any time — even with the feature off: detached at Stripe, consent cleared, one tap refused after', async () => {
    await features(ON.filter((x) => x !== 'store_fast_checkout'))
    const row = await cardRow()
    const gone = await k.pub('DELETE', `${A}/card`, {}, { cookie })
    expect(gone.status).toBe(200)
    expect(calls(`/v1/payment_methods/${row.paymentMethodId}/detach`).length).toBe(1)
    expect(await cardRow()).toMatchObject({ paymentMethodId: null, consentAt: null, last4: null })
    await features(ON)
    expect((await k.pub('GET', `${A}/me`, undefined, { cookie })).json.savedCard).toBeNull()
    expect((await checkout({ useSavedCard: true })).json.code).toBe('card_unavailable')
    // Not signed in: nothing to remove.
    expect((await k.pub('DELETE', `${A}/card`, {})).status).toBe(401)
  })
})

describe('wallet buttons (Apple Pay, Google Pay, Link)', () => {
  const wallet = { items: [{ sku: 'MUG-1', quantity: 2 }], shipping: { name: 'Wally Wallet', address: { line1: '1 Wallet Way', city: 'Los Angeles', state: 'CA', postalCode: '90001', country: 'US' } } }
  test('the config gives Stripe.js its key; not available for Square/PayPal-only or Stripe Tax stores', async () => {
    const c = await k.pub('GET', '/api/public/express/config')
    expect(c.json).toMatchObject({ available: true, publishableKey: 'pk_test', currency: 'usd' })
    await db().update(k.S.storeSettings).set({ stripeTaxEnabled: true }).where(eq(k.S.storeSettings.companyId, k.companyId))
    const taxed = await k.pub('GET', '/api/public/express/config')
    const quote = await k.pub('POST', '/api/public/express/quote', wallet)
    await db().update(k.S.storeSettings).set({ stripeTaxEnabled: false }).where(eq(k.S.storeSettings.companyId, k.companyId))
    expect(taxed.json).toEqual({ available: false })
    expect(quote.status).toBe(400)
    expect(quote.json.code).toBe('express_unavailable')
  })

  test('a quote prices the cart for the wallet\'s address by the same rule as checkout, and writes nothing', async () => {
    const n = (await ordersNow()).length
    const ca = await k.pub('POST', '/api/public/express/quote', wallet)
    expect(ca.json).toMatchObject({ subtotalCents: 4000, shippingCents: 1500, taxCents: 0, totalCents: 5500 })
    const wi = await k.pub('POST', '/api/public/express/quote', { ...wallet, shipping: { ...wallet.shipping, address: { ...wallet.shipping.address, state: 'WI' } } })
    expect(wi.json).toMatchObject({ shippingCents: 500, totalCents: 4500 })
    expect((await ordersNow()).length).toBe(n)
    expect(calls('/v1/payment_intents').length).toBe(calls('/v1/payment_intents').length)
  })

  test('the intent is for the server\'s total and the wallet\'s address; the success page finishes the order once Stripe says it is paid', async () => {
    const before = calls('/v1/payment_intents').length
    const r = await k.pub('POST', '/api/public/express/intent', { ...wallet, email: 'wally@example.com' })
    expect(r.status).toBe(200)
    expect(r.json.clientSecret).toMatch(/_secret_/)
    expect(calls('/v1/payment_intents').length).toBe(before + 1)
    const pi = k.stripe.last('/v1/payment_intents')!.params
    expect(pi.get('amount')).toBe('5500')
    expect(pi.get('metadata[twomiah_flow]')).toBe('express')
    expect(pi.get('confirm')).toBeNull() // the browser confirms it with the wallet
    const o = await k.order(r.json.orderId)
    expect(o).toMatchObject({ status: 'pending', totalCents: 5500, customerEmail: 'wally@example.com' })
    expect(r.json.returnUrl).toContain(`/checkout/success?ref=${o.id}`)
    // Stripe confirms the wallet payment; the shopper lands on the success page.
    const piId = o.providerSessionId
    k.stripe.intents.get(piId).status = 'succeeded'
    k.stripe.intents.get(piId).amount_received = 5500
    const summary = await k.pub('GET', `/api/public/order-summary?ref=${o.id}`)
    expect(summary.json.status).toBe('paid')
    const paid = await k.order(o.id)
    expect(paid.status).toBe('paid')
    expect(paid.shippingAddress).toMatchObject({ line1: '1 Wallet Way', city: 'Los Angeles', state: 'CA' })
  })

  test('a ship order with no address from the wallet is refused and leaves nothing; with the feature off the routes are closed', async () => {
    const n = (await ordersNow()).length
    const bad = await k.pub('POST', '/api/public/express/intent', { items: wallet.items })
    expect(bad.status).toBe(400)
    expect(bad.json.code).toBe('express_unavailable')
    expect((await ordersNow()).length).toBe(n)
    await features(ON.filter((x) => x !== 'store_fast_checkout'))
    expect((await k.pub('POST', '/api/public/express/intent', wallet)).status).toBe(404)
    expect((await k.pub('POST', '/api/public/express/quote', wallet)).status).toBe(404)
    await features(ON)
  })
})
