// The store's checkout group (server/crm/store/checkout) through the real unified server, as the store vertical. The
// behaviour is templates/crm-store's own suite (tests/store: checkout-charge, order-receipt, loyalty, paypal-refunds'
// webhook part, account-lock's shopper side), re-asserted here:
//   · the amount the provider is told to charge is the order's total — a plain cart, a code, a loyalty reward, both;
//   · two orders paid at the same moment both take their units off the stock; a confirmation revisited takes nothing;
//   · a payment webhook delivered twice pays (and mails, and counts the code) once; one without a good signature is
//     refused and changes nothing;
//   · the shopper is a 'customer' contact and the order carries its contact_id — given at checkout, or at payment when
//     the email only arrives from the provider;
//   · the return address is the request's origin, never a body field;
//   · a closed store answers 503 STORE_UNAVAILABLE on the store's own public paths only (status, the order summary and
//     the webhooks stay open; /api/public/ads-experiments is not the store's and is untouched);
//   · the receipt (order summary) carries the discount lines so the lines add to the total;
//   · the abandoned-cart reminder and the review request are each sent once, even with two passes at once;
//   · reviews land pending and only approved ones show; a buyer's review is verified;
//   · the refund and supplier-shipped notices go to the orders group's hooks (a fake here), and answer 503 until wired;
//   · the merchant's payment connection: payments:update, encrypted, never sent back; PayPal's webhook events updated.
// The payment providers' HTTP is answered here (globalThis.fetch); nothing leaves the machine.
process.env.PAYMENT_ENC_KEY = 'store-checkout-test-key'
process.env.SITE_URL = 'https://site.test'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { forgetAccountLock } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { createStoreCore } from '../server/crm/store/core.ts'
import { encrypt, encryptJSON } from '../server/core/crypto.ts'
import { createCheckoutService } from '../server/crm/store/checkout/checkoutService.ts'
import { createStorePublicRoutes, checkoutImageUrl, type OrderHooks } from '../server/crm/store/checkout/publicRoutes.ts'
import { ensurePayPalWebhookEvents, PAYPAL_WEBHOOK_EVENTS } from '../server/crm/store/checkout/paymentRoutes.ts'
import { storefrontCatalogue, storefrontProduct } from '../server/crm/store/checkout/catalogue.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let deps: any
let core: ReturnType<typeof createStoreCore>
let svc: ReturnType<typeof createCheckoutService>
const S = () => t.schema as any
const mails: Array<{ to: string; template: string; data: any }> = []

// ── PayPal, answered here ────────────────────────────────────────────────────────────────────────────────────────────
const charged = new Map<string, number>()   // PayPal order id → cents it was told to charge
const createBodies = new Map<string, any>()  // PayPal order id → the body it was sent
let pp = 0
let payerEmail = 'ada@example.com'
let hookEvents: string[] = ['PAYMENT.CAPTURE.COMPLETED']
const hookPatches: any[] = []
const realFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.includes('paypal.com')) return realFetch(input, init)
  const method = String(init?.method || 'GET').toUpperCase()
  if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 'tok' })
  if (url.endsWith('/v1/notifications/verify-webhook-signature') && method === 'POST') {
    const b = JSON.parse(init.body)
    return json({ verification_status: b.transmission_sig === 'good-sig' && b.webhook_id === 'WH-TEST' ? 'SUCCESS' : 'FAILURE' })
  }
  if (url.endsWith('/v1/notifications/webhooks/WH-TEST') && method === 'GET') return json({ id: 'WH-TEST', event_types: hookEvents.map((name) => ({ name })) })
  if (url.endsWith('/v1/notifications/webhooks/WH-TEST') && method === 'PATCH') { hookPatches.push(JSON.parse(init.body)); return json({ id: 'WH-TEST' }) }
  if (url.endsWith('/v2/checkout/orders') && method === 'POST') {
    const body = JSON.parse(init.body)
    const id = `PP-${++pp}`
    charged.set(id, Math.round(parseFloat(body.purchase_units[0].amount.value) * 100))
    createBodies.set(id, body)
    return json({ id, links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/approve/${id}` }] })
  }
  const cap = url.match(/\/v2\/payments\/captures\/([^/]+)$/)
  if (cap) return json({ id: decodeURIComponent(cap[1]), status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' } })
  const m = url.match(/\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    const cents = charged.get(id) ?? 0
    return json({ id, status: 'COMPLETED', payer: { email_address: payerEmail }, purchase_units: [{ payments: { captures: [{ id: `CAP-${id}`, amount: { currency_code: 'USD', value: (cents / 100).toFixed(2) } }] } }] })
  }
  return json({}, 404)
}) as any

const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, app?: Hono<any>) => {
  const init: any = { method, headers: { host: 'shop.test', ...headers } }
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body) }
  const res = app ? await app.request(path, init) : await t.app.request(path, init)
  const text = await res.text(); let j: any = text; try { j = JSON.parse(text) } catch {}
  return { status: res.status, json: j, text, headers: res.headers }
}
const settle = () => new Promise((r) => setTimeout(r, 250))
const orderById = async (id: string) => (await t.db.select().from(S().storeOrder).where(eq(S().storeOrder.id, id)))[0]
const stock = async () => (await t.db.select().from(S().storeProductVariant).where(eq(S().storeProductVariant.sku, 'MUG-1')))[0].inventoryQty
const setStock = (n: number) => t.db.update(S().storeProductVariant).set({ inventoryQty: n }).where(eq(S().storeProductVariant.sku, 'MUG-1'))
const pointsOf = async (contactId: string) => (await t.db.select().from(S().loyaltyMember).where(eq(S().loyaltyMember.contactId, contactId)))[0]?.pointsBalance

/** A checkout through the real route: the PayPal order it opened, what PayPal was told to charge, and the order. */
const checkout = async (extra: Record<string, unknown>, qty = 2, headers: Record<string, string> = {}) => {
  const before = pp
  const r = await req('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: qty }], customerEmail: 'ada@example.com', ...extra }, headers)
  const id = pp > before ? `PP-${pp}` : null
  const order: any = id ? (await t.db.select().from(S().storeOrder).where(eq(S().storeOrder.providerSessionId, id)))[0] : null
  return { r, id, order, sent: id ? charged.get(id)! : null, body: id ? createBodies.get(id) : null }
}
/** PayPal's PAYMENT.CAPTURE.COMPLETED for a PayPal order, signed (or not). */
let evt = 0
const paidHook = (ppOrderId: string, sig: string | null = 'good-sig', app?: Hono<any>) => req('POST', '/api/public/webhooks/payment', {
  id: `WH-EVT-${++evt}`, event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: `CAP-${ppOrderId}`, amount: { value: ((charged.get(ppOrderId) ?? 0) / 100).toFixed(2), currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: ppOrderId } } },
}, sig ? { 'paypal-transmission-id': `t-${evt}`, 'paypal-transmission-time': '2026-10-19T12:00:00Z', 'paypal-cert-url': 'https://api.sandbox.paypal.com/c', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-sig': sig } : {}, app)

let ada = ''
let tenOff: any
let mug: any

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(S().company).set({ email: 'owner@shop.test', settings: { loyalty: { enabled: true, pointsPerDollar: 1 } } }).where(eq(S().company.id, companyId))
  // The app's email service, answered here: every message the store sends is recorded.
  ;(t.services.crm.emailService as any).send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
  deps = {
    db: t.db, audit: t.services.audit, logger: { info() {}, warn() {}, error() {} }, authenticate: t.services.authenticate,
    permissions: t.services.permissions, features: t.services.features, realtime: t.services.realtime, services: t.services.crm,
  }
  core = createStoreCore(deps)
  svc = createCheckoutService(deps, core)

  await t.db.insert(S().storeSettings).values({ companyId, currency: 'usd', flatShippingCents: 599, taxRateBps: 825 })
  await t.db.insert(S().paymentConfig).values({ companyId, provider: 'paypal', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'sk', publishableKey: 'pk' }), webhookSecretEnc: encrypt('WH-TEST') })
  ;[mug] = (await t.db.insert(S().storeProduct).values({ companyId, slug: 'mug', name: 'Mug', status: 'active', position: 1 }).returning()) as any[]
  await t.db.insert(S().storeProduct).values({ companyId, slug: 'hidden', name: 'Draft thing', status: 'draft' })
  await t.db.insert(S().storeProductVariant).values({ productId: mug.id, sku: 'MUG-1', name: 'Mug', priceCents: 2500, inventoryQty: 10 })
  await t.db.insert(S().discountCode).values({ companyId, code: 'SAVE10', type: 'percent', value: 10, active: true })
  ;[tenOff] = (await t.db.insert(S().loyaltyReward).values({ companyId, name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000, minSubtotalCents: 2000 }).returning()) as any[]
  ;[{ id: ada }] = (await t.db.insert(S().contact).values({ companyId, type: 'customer', name: 'Ada', email: 'ada@example.com' }).returning()) as any[]
  await t.db.insert(S().loyaltyMember).values({ companyId, contactId: ada, pointsBalance: 500 })
}, 120_000)

afterAll(() => { globalThis.fetch = realFetch })

describe('the catalogue', () => {
  test('active products only, with their variants; one by slug; the website reads the same', async () => {
    const all = await req('GET', '/api/public/products')
    expect(all.status).toBe(200)
    expect(all.json.data.map((p: any) => p.slug)).toEqual(['mug'])
    expect(all.json.data[0].variants[0]).toMatchObject({ sku: 'MUG-1', priceCents: 2500 })
    expect(all.json.data[0].companyId).toBeUndefined()
    expect((await req('GET', '/api/public/products/mug')).json).toMatchObject({ slug: 'mug', name: 'Mug' })
    expect((await req('GET', '/api/public/products/hidden')).status).toBe(404)
    expect((await storefrontCatalogue(deps, companyId)).map((p) => p.slug)).toEqual(['mug'])
    expect((await storefrontProduct(deps, companyId, 'mug'))!.variants.length).toBe(1)
    expect(await storefrontProduct(deps, companyId, 'hidden')).toBeNull()
  })
  test('settings: the shop\'s name and support email are the company\'s; checkout is on', async () => {
    const s = await req('GET', '/api/public/settings')
    expect(s.json).toMatchObject({ companyName: 'Test Builders', supportEmail: 'owner@shop.test', currency: 'usd', flatShippingCents: 599, taxRateBps: 825, checkoutEnabled: true })
  })
})

describe('the amount charged is the order total', () => {
  for (const [label, extra] of [
    ['a plain cart', {}],
    ['a discount code', { discountCode: 'save10' }],
    ['a loyalty reward', { loyaltyRewardId: 'REWARD' }],
    ['a code and a loyalty reward', { discountCode: 'SAVE10', loyaltyRewardId: 'REWARD' }],
  ] as const) {
    test(label, async () => {
      const body: Record<string, unknown> = { ...extra }
      if (body.loyaltyRewardId) body.loyaltyRewardId = tenOff.id
      const { r, order, sent } = await checkout(body)
      expect(r.status).toBe(200)
      expect(r.json.url).toStartWith('https://www.sandbox.paypal.com/approve/')
      expect(sent).toBe(order.totalCents)
      if (body.loyaltyRewardId) expect(order.loyaltyDiscountCents).toBe(1000)
      if (body.discountCode) expect(order.discountCode).toBe('SAVE10')
    })
  }

  test('a paid loyalty order: charged the reduced total, and its points spent once', async () => {
    const before = await pointsOf(ada)
    const { order, sent } = await checkout({ loyaltyRewardId: tenOff.id }, 1)
    const s = await req('GET', `/api/public/order-summary?ref=${order.id}`)
    await settle()
    expect(s.json.status).toBe('paid')
    expect(sent).toBe(order.totalCents)
    expect(s.json.totalCents).toBe(order.totalCents)
    // 60 spent, (2500 − 1000)/100 = 15 earned
    expect(await pointsOf(ada)).toBe(before - 60 + 15)
  })

  test('the picture never stops the payment: only an https address goes to the payment page', async () => {
    expect(checkoutImageUrl('data:image/svg+xml;base64,AAAA')).toBeUndefined()
    expect(checkoutImageUrl('/media/a.png')).toBeUndefined()
    expect(checkoutImageUrl('http://cdn.example.com/a.png')).toBeUndefined()
    expect(checkoutImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    await t.db.insert(S().storeProductImage).values({ productId: mug.id, url: 'data:image/svg+xml;base64,AAAA', isPrimary: true })
    const r = await checkout({}, 1)
    expect(r.r.status).toBe(200)
    // The order exists. Its line keeps the product's own picture, for the order-received page (store live test,
    // 2026-10-26: a shop's own /media photo was dropped and the thank-you page showed an empty box); only the payment
    // page is held to an https address (placeOrder.ts checkoutImageUrl at createCheckout).
    const [line] = await t.db.select().from(S().storeOrderItem).where(eq(S().storeOrderItem.orderId, r.order.id))
    expect(line.imageUrl).toBe('data:image/svg+xml;base64,AAAA')
  })

  test('a refused cart: 400 with the template\'s sentence and the fields', async () => {
    const r = await req('POST', '/api/public/checkout', { items: [] })
    expect(r.status).toBe(400)
    expect(r.json).toMatchObject({ error: 'Invalid cart', code: 'validation_failed' })
    expect(Object.keys(r.json.fields)).toContain('items')
    const short = await req('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 999 }] })
    expect(short.status).toBe(409)
    expect(short.json.error).toMatch(/^Only \d+ of Mug left$/)
  })
})

describe('the return address', () => {
  test('is the request\'s origin; a body origin is ignored', async () => {
    const { body } = await checkout({ origin: 'https://evil.example' }, 1, { 'x-forwarded-host': 'shop.example.com', 'x-forwarded-proto': 'https' })
    const sent = JSON.stringify(body)
    expect(sent).not.toContain('evil.example')
    expect(body.application_context.return_url).toStartWith('https://shop.example.com/checkout/success?ref=')
    expect(body.application_context.cancel_url).toBe('https://shop.example.com/cart')
  })
})

describe('stock, and paying once', () => {
  test('two orders paid at the same moment both take their units', async () => {
    await setStock(10)
    const a = await checkout({}, 3), b = await checkout({}, 4)
    const results = await Promise.all([req('GET', `/api/public/order-summary?ref=${a.order.id}`), req('GET', `/api/public/order-summary?ref=${b.order.id}`)])
    expect(results.map((x) => x.json.status)).toEqual(['paid', 'paid'])
    expect(await stock()).toBe(3)
    await req('GET', `/api/public/order-summary?ref=${a.order.id}`)
    expect(await stock()).toBe(3)
  })

  test('a webhook delivered twice pays once: one stock move, one code use, one receipt', async () => {
    await setStock(10)
    const usedBefore = (await t.db.select().from(S().discountCode))[0].usedCount
    const { id, order } = await checkout({ discountCode: 'SAVE10' }, 2)
    const m0 = mails.length
    const [h1, h2] = await Promise.all([paidHook(id!), paidHook(id!)])
    await settle()
    expect([h1.status, h2.status]).toEqual([200, 200])
    expect(h1.json).toEqual({ success: true })
    const now = await orderById(order.id)
    expect(now.status).toBe('paid')
    expect(now.providerPaymentId).toBe(`CAP-${id}`)
    expect(now.orderNumber).toBe(order.orderNumber)
    expect(await stock()).toBe(8)
    expect((await t.db.select().from(S().discountCode))[0].usedCount).toBe(usedBefore + 1)
    const sentNow = mails.slice(m0)
    expect(sentNow.filter((m) => m.template === 'storeOrderConfirmation').length).toBe(1)
    expect(sentNow.filter((m) => m.template === 'storeMerchantNewOrder').map((m) => m.to)).toEqual(['owner@shop.test'])
  })

  test('a notice without a good signature is refused and changes nothing', async () => {
    const { id, order } = await checkout({}, 1)
    const forged = await paidHook(id!, 'forged-sig')
    const unsigned = await paidHook(id!, null)
    expect([forged.status, unsigned.status]).toEqual([400, 400])
    expect(forged.json.error).toBe('Invalid signature')
    expect((await orderById(order.id)).status).toBe('pending')
  })
})

describe('a shopper is a customer', () => {
  test('checkout with an email: the order carries the existing contact', async () => {
    const { order } = await checkout({}, 1)
    expect(order.contactId).toBe(ada)
  })
  test('an email that arrives from the provider: a new customer contact, on the order, earning there', async () => {
    payerEmail = 'Grace@Example.com'
    const r = await req('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }] })
    expect(r.status).toBe(200)
    const order = (await t.db.select().from(S().storeOrder).where(eq(S().storeOrder.providerSessionId, `PP-${pp}`)))[0]
    expect(order.customerEmail).toBe('pending@checkout')
    expect(order.contactId).toBeNull()
    await req('GET', `/api/public/order-summary?ref=${order.id}`)
    await settle()
    const paid = await orderById(order.id)
    expect(paid.contactId).toBeTruthy()
    const [who] = await t.db.select().from(S().contact).where(eq(S().contact.id, paid.contactId))
    expect(who).toMatchObject({ type: 'customer', email: 'grace@example.com', source: 'online_store', companyId })
    expect(await pointsOf(paid.contactId)).toBe(25)
    payerEmail = 'ada@example.com'
  })
})

describe('the receipt', () => {
  test('the order summary carries the discount, its code and the loyalty share, so the lines add up', async () => {
    const [o] = await (t.db as any).insert(S().storeOrder).values({
      companyId, orderNumber: 'ORD-RCPT1', provider: 'paypal', providerSessionId: 'rcpt_1', status: 'paid', customerEmail: 'shopper@example.com',
      subtotalCents: 3700, discountCents: 370, discountCode: 'TEST10', loyaltyDiscountCents: 0, shippingCents: 500, taxCents: 241, totalCents: 4071, currency: 'usd',
    }).returning()
    await t.db.insert(S().storeOrderItem).values({ orderId: o.id, productName: 'Test Mug', variantName: 'Default', sku: 'M1', unitPriceCents: 3700, quantity: 1, lineTotalCents: 3700 })
    const s = (await req('GET', `/api/public/order-summary?ref=${o.id}`)).json
    expect(s).toMatchObject({ orderNumber: 'ORD-RCPT1', status: 'paid', email: 'shopper@example.com', discountCents: 370, discountCode: 'TEST10', loyaltyDiscountCents: 0, refundedCents: 0 })
    expect(s.subtotalCents - s.discountCents + s.shippingCents + s.taxCents).toBe(s.totalCents)
    expect(s.items).toEqual([{ productName: 'Test Mug', variantName: 'Default', quantity: 1, lineTotalCents: 3700, imageUrl: null }])
    expect((await req('GET', '/api/public/order-summary?session_id=rcpt_1')).json.orderNumber).toBe('ORD-RCPT1')
    expect((await req('GET', '/api/public/order-summary')).status).toBe(400)
    expect((await req('GET', '/api/public/order-summary?ref=nope')).status).toBe(404)
  })
  test('the confirmation sent on payment is the store\'s, to the shopper, from the paid order', async () => {
    const m = mails.filter((x) => x.template === 'storeOrderConfirmation').at(-1)!
    expect(m.data.order.totalCents).toBeGreaterThan(0)
    expect(m.data.supportEmail).toBe('owner@shop.test')
  })
})

describe('loyalty quote (the cart reads it directly)', () => {
  test('a known shopper: balance and rewards priced on this cart', async () => {
    const q = await req('GET', '/api/public/loyalty?email=ada@example.com&subtotalCents=5000.9')
    expect(q.status).toBe(200)
    expect(q.json.pointsBalance).toBeGreaterThan(0)
    expect(q.json.rewards.find((r: any) => r.id === tenOff.id)).toMatchObject({ available: true, discountCents: 1000 })
  })
  test('no email, an unknown address, a bad subtotal, the programme off: 200 with the empty shape', async () => {
    const empty = { pointsBalance: 0, punchCard: { enabled: false, visitsRequired: 0, progress: 0, remaining: 0, unclaimed: 0 }, rewards: [] }
    expect((await req('GET', '/api/public/loyalty')).json).toEqual(empty)
    const stranger = await req('GET', '/api/public/loyalty?email=nobody@example.com&subtotalCents=abc')
    expect(stranger.status).toBe(200)
    expect(stranger.json.pointsBalance).toBe(0)
    const [co] = await t.db.select().from(S().company).where(eq(S().company.id, companyId))
    await t.db.update(S().company).set({ settings: { ...co.settings, loyalty: { enabled: false } } }).where(eq(S().company.id, companyId))
    expect((await req('GET', '/api/public/loyalty?email=ada@example.com&subtotalCents=5000')).json).toEqual(empty)
    await t.db.update(S().company).set({ settings: co.settings }).where(eq(S().company.id, companyId))
  })
})

describe('reviews', () => {
  test('land pending; only approved ones show; a buyer\'s is verified', async () => {
    const r = await req('POST', '/api/public/products/mug/reviews', { rating: 5, authorName: 'Ada', authorEmail: 'ada@example.com', body: 'Lovely' })
    expect(r.status).toBe(201)
    expect(r.json).toEqual({ success: true, message: 'Thanks! Your review will appear once it is approved.' })
    const [row] = await t.db.select().from(S().productReview)
    expect(row).toMatchObject({ status: 'pending', verifiedPurchase: true, companyId })
    expect((await req('GET', '/api/public/products/mug/reviews')).json).toEqual({ reviews: [], summary: { average: 0, count: 0 } })
    await t.db.update(S().productReview).set({ status: 'approved' }).where(eq(S().productReview.id, row.id))
    const shown = (await req('GET', '/api/public/products/mug/reviews')).json
    expect(shown.reviews.length).toBe(1)
    expect(shown.reviews[0]).toMatchObject({ authorName: 'Ada', rating: 5, verifiedPurchase: true })
    expect(shown.reviews[0].authorEmail).toBeUndefined()
    expect(shown.summary).toEqual({ average: 5, count: 1 })
    expect((await req('POST', '/api/public/products/mug/reviews', { rating: 9, authorName: '' })).status).toBe(400)
    await t.db.update(S().storeSettings).set({ reviewsEnabled: false }).where(eq(S().storeSettings.companyId, companyId))
    expect((await req('POST', '/api/public/products/mug/reviews', { rating: 4, authorName: 'X' })).status).toBe(403)
    await t.db.update(S().storeSettings).set({ reviewsEnabled: true }).where(eq(S().storeSettings.companyId, companyId))
  })
})

describe('the sweeps', () => {
  const pendingCart = async (email: string, ageMs: number) => {
    const [o] = await (t.db as any).insert(S().storeOrder).values({
      companyId, provider: 'paypal', providerSessionId: 'cart_' + Math.random().toString(36).slice(2), status: 'pending', customerEmail: email,
      subtotalCents: 2500, totalCents: 2500, createdAt: new Date(Date.now() - ageMs),
    }).returning()
    await t.db.insert(S().storeOrderItem).values({ orderId: o.id, productId: mug.id, productName: 'Mug', variantName: 'Mug', sku: 'MUG-1', unitPriceCents: 2500, quantity: 1, lineTotalCents: 2500 })
    return o
  }

  test('an abandoned cart is reminded once — never the placeholder address — and its link reopens checkout', async () => {
    const real = await pendingCart('cart@example.com', 2 * 3600_000)
    const anon = await pendingCart('pending@checkout', 2 * 3600_000)
    const m0 = mails.length
    await Promise.all([svc.sweepAbandonedCarts(), svc.sweepAbandonedCarts()])
    await svc.sweepAbandonedCarts()
    const sent = mails.slice(m0).filter((m) => m.template === 'storeAbandonedCart')
    expect(sent.map((m) => m.to)).toEqual(['cart@example.com'])
    const after = await orderById(real.id)
    expect(sent[0].data.recoverUrl).toBe(`https://site.test/api/public/recover/${after.recoveryToken}`)
    expect((await orderById(anon.id)).abandonedEmailSentAt).toBeNull()

    const before = pp
    const r = await req('GET', `/api/public/recover/${after.recoveryToken}`)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe(`https://www.sandbox.paypal.com/approve/PP-${before + 1}`)
    // PayPal fills no placeholder: the shopper comes back by our order id, to the storefront's real success page.
    expect(createBodies.get(`PP-${before + 1}`).application_context.return_url).toBe(`https://shop.test/checkout/success?ref=${real.id}`)
    expect((await orderById(real.id)).recoveredAt).toBeTruthy()
    expect((await req('GET', '/api/public/recover/not-a-token')).status).toBe(404)
  })

  test('a pending order older than 7 days is cancelled; a newer one is left', async () => {
    const old = await pendingCart('old@example.com', 8 * 24 * 3600_000)
    const fresh = await pendingCart('fresh@example.com', 3600_000)
    expect(await svc.sweepStalePending()).toBeGreaterThanOrEqual(1)
    expect((await orderById(old.id)).status).toBe('cancelled')
    expect((await orderById(fresh.id)).status).toBe('pending')
  })

  test('a review request goes once, days after the order shipped, linking the product page', async () => {
    const [o] = await (t.db as any).insert(S().storeOrder).values({
      companyId, provider: 'paypal', providerSessionId: 'shipped_1', status: 'shipped', customerEmail: 'rev@example.com',
      subtotalCents: 2500, totalCents: 2500, updatedAt: new Date(Date.now() - 10 * 24 * 3600_000),
    }).returning()
    await t.db.insert(S().storeOrderItem).values({ orderId: o.id, productId: mug.id, productName: 'Mug', variantName: 'Mug', sku: 'MUG-1', unitPriceCents: 2500, quantity: 1, lineTotalCents: 2500 })
    const m0 = mails.length
    await Promise.all([svc.sweepReviewRequests(), svc.sweepReviewRequests()])
    await svc.sweepReviewRequests()
    const sent = mails.slice(m0).filter((m) => m.template === 'storeReviewRequest')
    expect(sent.map((m) => m.to)).toEqual(['rev@example.com'])
    expect(sent[0].data.reviewUrl).toBe('https://site.test/product/mug#reviews')
  })
})

describe('the orders group\'s notices', () => {
  const NEXT: Record<string, string[]> = { pending: ['paid', 'cancelled'], paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'], fulfilled: ['shipped', 'refunded'], shipped: ['delivered', 'refunded'], delivered: ['refunded'] }
  const calls: any[] = []
  const hooks: OrderHooks = {
    mayMove: (from, to) => from === to || (NEXT[from] || []).includes(to),
    applyProviderRefund: async (...a) => { calls.push(['provider', ...a]); return 'refunded' },
    applyRefundUpdate: async (...a) => { calls.push(['update', ...a]); return 'unknown' },
  }
  let wired: Hono
  beforeAll(() => { wired = new Hono().route('/api/public', createStorePublicRoutes(deps, core, svc, hooks)) })

  const refundHook = (app?: Hono<any>) => req('POST', '/api/public/webhooks/payment', {
    id: `WH-EVT-${++evt}`, event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: { id: 'REF-1', status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' }, seller_payable_breakdown: { total_refunded_amount: { value: '50.00', currency_code: 'USD' } }, links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/CAP-X' }] },
  }, { 'paypal-transmission-id': `t-${evt}`, 'paypal-transmission-time': '2026-10-19T12:00:00Z', 'paypal-cert-url': 'https://api.sandbox.paypal.com/c', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-sig': 'good-sig' }, app)

  test('a refund notice: matched to the store\'s own first, else a dashboard refund — for this company', async () => {
    const r = await refundHook(wired)
    expect(r.status).toBe(200)
    expect(calls).toEqual([['update', companyId, 'paypal', 'REF-1', 'completed'], ['provider', companyId, 'paypal', 'CAP-X', 5000, 5000]])
  })
  test('unwired: a refund notice answers 503, so the provider sends it again; a paid notice still pays', async () => {
    const unwired = new Hono().route('/api/public', createStorePublicRoutes(deps, core, svc))
    const r = await refundHook(unwired)
    expect([r.status, calls.length]).toEqual([503, 2])
    // A paid notice needs nothing from the orders group.
    const { id, order } = await checkout({}, 1)
    expect((await paidHook(id!, 'good-sig', unwired)).status).toBe(200)
    expect((await orderById(order.id)).status).toBe('paid')
  })

  test('the supplier\'s "shipped" follows the lifecycle; tracking is always recorded; a wrong token changes nothing', async () => {
    await t.db.insert(S().supplierConfig).values({ companyId, provider: 'printful', mode: 'test', connected: true, autoForward: false, credentialsEnc: encryptJSON({ apiKey: 'k', webhookToken: 'hook-tok' }) })
    let n = 0
    const mk = async (status: string) => ((await t.db.insert(S().storeOrder).values({
      companyId, orderNumber: `ORD-SUP-${status}-${++n}`, provider: 'paypal', providerSessionId: `sup_${status}_${n}`, status, customerEmail: 'ada@example.com',
      subtotalCents: 2500, totalCents: 2500,
    }).returning()) as any[])[0]
    const notice = (o: any, token = 'hook-tok', app: Hono<any> | undefined = wired) => req('POST', `/api/public/webhooks/supplier?t=${token}`, { type: 'package_shipped', data: { order: { id: 9000, external_id: o.id }, shipment: { carrier: 'USPS', tracking_number: `TRK-${o.status}` } } }, {}, app)
    const want: Record<string, string> = { paid: 'shipped', fulfilled: 'shipped', cancelled: 'cancelled', refunded: 'refunded', delivered: 'delivered' }
    for (const [from, to] of Object.entries(want)) {
      const o = await mk(from)
      const r = await notice(o)
      const after = await orderById(o.id)
      expect(r.status).toBe(200)
      expect(after).toMatchObject({ status: to, trackingNumber: `TRK-${from}`, supplierStatus: 'shipped' })
      if (from === to) expect(after.fulfilledAt).toBeNull()
    }
    const o = await mk('paid')
    expect((await notice(o, 'wrong-token')).status).toBe(400)
    expect((await orderById(o.id)).trackingNumber).toBeNull()
    // Unwired, the order's lifecycle is unknown: 503, nothing written, the supplier sends it again.
    const unwired = new Hono().route('/api/public', createStorePublicRoutes(deps, core, svc))
    expect((await notice(o, 'hook-tok', unwired)).status).toBe(503)
    expect((await orderById(o.id))).toMatchObject({ status: 'paid', trackingNumber: null })
  })
})

describe('a closed store', () => {
  test('503 STORE_UNAVAILABLE on the store\'s own shopper paths only', async () => {
    const [co] = await t.db.select().from(S().company).where(eq(S().company.id, companyId))
    await t.db.update(S().company).set({ settings: { ...co.settings, subscriptionStatus: 'canceled', billingStatus: 'canceled' } }).where(eq(S().company.id, companyId))
    forgetAccountLock()
    try {
      const st = await req('GET', '/api/public/status')
      expect(st.json).toEqual({ open: false, storeName: 'Test Builders' })
      const refused = await Promise.all(['/api/public/products', '/api/public/products/mug', '/api/public/settings', '/api/public/loyalty?email=a%40b.c', '/api/public/recover/x', '/api/public/products/mug/reviews'].map((p) => req('GET', p)))
      expect(refused.map((r) => [r.status, r.json?.code])).toEqual(refused.map(() => [503, 'STORE_UNAVAILABLE']))
      const co2 = await req('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }] })
      expect([co2.status, co2.json.code]).toEqual([503, 'STORE_UNAVAILABLE'])
      const open = await Promise.all([
        req('POST', '/api/public/webhooks/payment', {}), req('POST', '/api/public/webhooks/supplier', {}), req('GET', '/api/public/order-summary?ref=x'),
        req('POST', '/api/public/ads-experiments/assign', { experimentId: 'x' }),
      ])
      for (const r of open) { expect(r.status).not.toBe(503); expect(r.json?.code).not.toBe('STORE_UNAVAILABLE') }
    } finally {
      await t.db.update(S().company).set({ settings: co.settings }).where(eq(S().company.id, companyId))
      forgetAccountLock()
    }
    expect((await req('GET', '/api/public/status')).json.open).toBe(true)
  })
})

describe('the payment connection', () => {
  const PASS = 'Correct-horse-1'
  let owner = '', staff = ''
  const as = (tok: string) => (method: string, path: string, body?: unknown) => req(method, path, body, { Authorization: `Bearer ${tok}` })
  beforeAll(async () => {
    await t.db.insert(S().user).values({ email: 'staff@test.example', passwordHash: await Bun.password.hash(PASS, 'bcrypt'), firstName: 'Sam', lastName: 'Staff', role: 'field', companyId })
    const login = async (email: string) => (await req('POST', '/api/auth/login', { email, password: PASS })).json.accessToken as string
    owner = await login('owner@test.example'); staff = await login('staff@test.example')
  })

  test('status never carries a key; connect and disconnect are payments:update', async () => {
    const st = await as(owner)('GET', '/api/admin/payments')
    expect(st.status).toBe(200)
    expect(st.json.config).toMatchObject({ provider: 'paypal', mode: 'test', connected: true, hasWebhookSecret: true })
    expect(JSON.stringify(st.json)).not.toContain('credentialsEnc')
    expect(st.json.webhookUrl).toEndWith('/api/public/webhooks/payment')
    // Which account takes the money, and in which mode, is the owner's to read too (the template's GET asked nothing).
    expect((await as(staff)('GET', '/api/admin/payments')).status).toBe(403)
    expect((await as(staff)('POST', '/api/admin/payments/disconnect')).status).toBe(403)
    expect((await as(staff)('POST', '/api/admin/payments/connect', { provider: 'paypal', secretKey: 's' })).status).toBe(403)
    expect((await req('GET', '/api/admin/payments')).status).toBe(401)

    const bad = await as(owner)('POST', '/api/admin/payments/connect', { provider: 'bitcoin' })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('Invalid payment credentials')

    const conn = await as(owner)('POST', '/api/admin/payments/connect', { provider: 'paypal', mode: 'test', secretKey: 'sk_plain_2', publishableKey: 'pk2', webhookSecret: 'WH-TEST' })
    expect(conn.status).toBe(200)
    expect(conn.json).toEqual({ config: { provider: 'paypal', mode: 'test', connected: true }, webhookConfigured: true, webhookNote: null })
    const rows: any[] = await t.db.select().from(S().paymentConfig).where(eq(S().paymentConfig.companyId, companyId))
    expect(rows.length).toBe(1)
    // '_' is outside base64's alphabet, so the ciphertext can never spell this key by chance ('sk2' did once, in CI).
    expect(rows[0].credentialsEnc).not.toContain('sk_plain_2')

    expect((await as(owner)('POST', '/api/admin/payments/disconnect')).json).toEqual({ success: true })
    expect((await req('GET', '/api/public/settings')).json.checkoutEnabled).toBe(false)
    expect((await req('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }] })).status).toBe(503)
    await t.db.update(S().paymentConfig).set({ connected: true }).where(and(eq(S().paymentConfig.companyId, companyId)))
  })

  test('PayPal\'s webhook events: an older store\'s is updated in place, then left alone', async () => {
    const want = ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED', 'PAYMENT.REFUND.PENDING', 'PAYMENT.REFUND.FAILED']
    expect([...PAYPAL_WEBHOOK_EVENTS].sort()).toEqual([...want].sort())
    hookEvents = ['PAYMENT.CAPTURE.COMPLETED']
    expect(await ensurePayPalWebhookEvents(deps, core)).toBe('updated')
    const patch = hookPatches.at(-1)
    expect(patch[0]).toMatchObject({ op: 'replace', path: '/event_types' })
    expect(patch[0].value.map((v: any) => v.name).sort()).toEqual([...want].sort())
    hookEvents = [...want]
    const n0 = hookPatches.length
    expect(await ensurePayPalWebhookEvents(deps, core)).toBe('current')
    expect(hookPatches.length).toBe(n0)
  })
})
