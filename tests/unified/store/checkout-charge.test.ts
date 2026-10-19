// ADAPTED COPY of tests/store/checkout-charge.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except
// the lines marked "unified:", each saying what the unified build changed and why. The original keeps running against
// the template.
// crm-store — what the shopper is CHARGED is what the order says, and stock moves once per paid order.
//
// Checkout computes the totals server-side and hands the payment provider the pieces to charge: line items,
// shipping, tax, and a discount. It handed over the DISCOUNT-CODE amount only. A loyalty reward was taken off the
// order's total and off the taxable amount — and never off the charge. So a shopper who redeemed "$10 off" paid the
// full price, and when the order was paid their points were spent as well. Nothing compared the two: finalizeOrder
// marks an order paid whatever the provider says it took.
//
// Asserted through the real /api/public routes and the real PayPal adapter (its HTTP calls answered here, so the
// amount read is the one that adapter would send):
//   · the amount sent to be charged equals order.totalCents — plain cart, a code, a loyalty reward, both
//   · two orders for the same item paid at the same moment take BOTH quantities off the stock (the decrement read
//     the count and wrote count − qty; two at once could leave one of them uncounted)
process.env.PAYMENT_ENC_KEY = 'checkout-charge-test-key'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, products, productVariants, discountCodes, paymentConfig, loyaltyRewards, loyaltyMembers, company, contact } from './db/schema.ts' /* unified: the shop's name and loyalty rules are the company row's, and a loyalty member is a contact's */

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
const { encryptJSON } = await import('./src/lib/crypto.ts')
await db.insert(storeSettings).values({
  currency: 'usd', flatShippingCents: 599, taxRateBps: 825, /* unified: companyName and loyalty are not store_settings' — the company row's, below */
} as any)
await db.update(company).set({ name: 'Charge Store', settings: { loyalty: { enabled: true, pointsPerDollar: 1 } } } as any) /* unified: the shop's name is company.name and the loyalty programme's rules company.settings.loyalty (the shared programme) */
await db.insert(users).values({ email: 'owner@charge.test', passwordHash: 'x', firstName: 'Owner', lastName: 'Tester', role: 'owner' } as any) /* unified: a user's name is first and last */
await db.insert(paymentConfig).values({ provider: 'paypal', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'sk', publishableKey: 'pk' }) } as any)
const [prod] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [variant] = await db.insert(productVariants).values({ productId: prod.id, sku: 'MUG-1', name: 'Mug', priceCents: 2500, inventoryQty: 10 } as any).returning()
await db.insert(discountCodes).values({ code: 'SAVE10', type: 'percent', value: 10, active: true, minSubtotalCents: 0, usedCount: 0 } as any)
const [tenOff] = await db.insert(loyaltyRewards).values({ name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000, minSubtotalCents: 2000 } as any).returning()
const [ada] = await db.insert(contact).values({ type: 'customer', name: 'Ada', email: 'ada@example.com' } as any).returning() /* unified: a shopper is a contact (type customer); checkout finds her by email */
await db.insert(loyaltyMembers).values({ contactId: ada.id, pointsBalance: 500 } as any) /* unified: loyalty members are by contact, not email */

// ── PayPal, answered here ──────────────────────────────────────────────────────────────────────────
const charged = new Map<string, number>()   // PayPal order id → cents it was told to charge
let pp = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.includes('paypal.com')) return realFetch(input, init)
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 'tok' })
  if (url.endsWith('/v2/checkout/orders') && init?.method === 'POST') {
    const body = JSON.parse(init.body)
    const id = `PP-${++pp}`
    charged.set(id, Math.round(parseFloat(body.purchase_units[0].amount.value) * 100))
    return json({ id, links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/approve/${id}` }] })
  }
  const m = url.match(/\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    const cents = charged.get(id) ?? 0
    return json({ id, status: 'COMPLETED', payer: { email_address: 'ada@example.com' }, purchase_units: [{ payments: { captures: [{ id: `CAP-${id}`, amount: { currency_code: 'USD', value: (cents / 100).toFixed(2) } }] } }] })
  }
  return new Response('{}', { status: 404 })
}) as any

const app = new Hono()
app.route('/api/public', (await import('./src/routes/public.ts')).default)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const latestOrder = async () => (await db.select().from(orders)).sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
const checkout = async (extra: Record<string, unknown>, qty = 2) => {
  const before = pp
  const r = await call('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: qty }], customerEmail: 'ada@example.com', origin: 'https://shop.test', ...extra })
  const id = pp > before ? `PP-${pp}` : null
  const order = id ? (await db.select().from(orders).where(eq(orders.providerSessionId, id)))[0] : null
  return { r, id, order, sent: id ? charged.get(id)! : null }
}

// ── the amount charged is the order's total ────────────────────────────────────────────────────────
for (const [label, extra] of [
  ['a plain cart', {}],
  ['a discount code', { discountCode: 'save10' }],
  ['a loyalty reward', { loyaltyRewardId: tenOff.id }],
  ['a code AND a loyalty reward', { discountCode: 'SAVE10', loyaltyRewardId: tenOff.id }],
] as const) {
  const { r, order, sent } = await checkout(extra)
  check(`${label}: checkout opens (200)`, r.status === 200 && !!order, r.text.slice(0, 160))
  if (!order) continue
  check(`${label}: PayPal is told to charge exactly the order total (${sent} = ${order.totalCents})`, sent === order.totalCents, { sent, total: order.totalCents, discount: order.discountCents, loyalty: order.loyaltyDiscountCents })
  if ((extra as any).loyaltyRewardId) check(`${label}: the reward is on the order ($10)`, order.loyaltyDiscountCents === 1000, order)
}

// the loyalty case paid end to end: the shopper is charged the reduced total AND the points are spent once
{
  const { order, sent, id } = await checkout({ loyaltyRewardId: tenOff.id }, 1)
  const before = (await db.select().from(loyaltyMembers).where(eq(loyaltyMembers.contactId, ada.id)))[0].pointsBalance /* unified: the member is the contact's */
  const s = await call('GET', `/api/public/order-summary?ref=${order!.id}`)
  await new Promise((r) => setTimeout(r, 200)) // loyalty settles off the request
  const after = (await db.select().from(loyaltyMembers).where(eq(loyaltyMembers.contactId, ada.id)))[0].pointsBalance /* unified: the member is the contact's */
  check('a paid loyalty order: charged the order total, not the pre-reward price', s.json?.status === 'paid' && sent === order!.totalCents && sent === s.json.totalCents, { sent, total: order!.totalCents, status: s.json?.status, id }) /* unified: one record is the record itself (RULEBOOK §3) — the summary, not { order } */
  check('…and its 60 points are spent (earning the rest on what was paid)', after < before, { before, after })
}

// ── two paid at the same moment: the stock takes both ──────────────────────────────────────────────
{
  await db.update(productVariants).set({ inventoryQty: 10 }).where(eq(productVariants.id, variant.id))
  const a = await checkout({}, 3), b = await checkout({}, 4)
  const results = await Promise.all([
    call('GET', `/api/public/order-summary?ref=${a.order!.id}`),
    call('GET', `/api/public/order-summary?ref=${b.order!.id}`),
  ])
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id))
  check('both orders are paid', results.every((x) => x.json?.status === 'paid'), results.map((x) => x.json?.status)) /* unified: one record is the record itself (RULEBOOK §3) — the summary, not { order } */
  check(`two orders (3 + 4) paid together leave 10 − 7 = 3 in stock (${v.inventoryQty})`, v.inventoryQty === 3, v)
  // and a replay of either confirmation does not take the stock twice
  await call('GET', `/api/public/order-summary?ref=${a.order!.id}`)
  const [v2] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id))
  check('a second visit to the confirmation page takes nothing more', v2.inventoryQty === 3, v2)
}

// ── the supplier's "shipped" follows the order's lifecycle ────────────────────────────────────────
// The supplier webhook wrote status = shipped whatever the order was: a cancelled or refunded order read "shipped"
// over its refund, and a delivered one stepped back. Tracking is a fact and is always recorded; the STATUS moves
// only where orders.ts NEXT_STATUS allows. Connected only now, with auto-forward off, so the paid orders above can
// never be forwarded to a real supplier from a test.
{
  const { supplierConfig } = await import('./db/schema.ts')
  await db.insert(supplierConfig).values({ provider: 'printful', mode: 'test', connected: true, autoForward: false, credentialsEnc: encryptJSON({ apiKey: 'k', webhookToken: 'hook-tok' }) } as any)
  let sup = 0
  const mk = async (status: string) => (await db.insert(orders).values({
    orderNumber: `ORD-SUP-${status}-${++sup}`, provider: "paypal", providerSessionId: `sup_${status}_${sup}`, status, customerEmail: 'ada@example.com',
    subtotalCents: 2500, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 2500, currency: 'usd',
  } as any).returning())[0]
  const shipNotice = (o: any, token = 'hook-tok') => call('POST', `/api/public/webhooks/supplier?t=${token}`, { type: 'package_shipped', data: { order: { id: 9000, external_id: o.id }, shipment: { carrier: 'USPS', tracking_number: `TRK-${o.status}` } } })
  const expect: Record<string, string> = { paid: 'shipped', fulfilled: 'shipped', cancelled: 'cancelled', refunded: 'refunded', delivered: 'delivered' }
  for (const [from, to] of Object.entries(expect)) {
    const o = await mk(from)
    const r = await shipNotice(o)
    const [after] = await db.select().from(orders).where(eq(orders.id, o.id))
    check(`supplier ships a ${from} order → it reads ${to}, with the tracking recorded`, r.status === 200 && after.status === to && after.trackingNumber === `TRK-${from}` && after.supplierStatus === 'shipped', { status: after.status, tracking: after.trackingNumber })
    if (from === to) check(`…a ${from} order is not stamped fulfilled by it`, !after.fulfilledAt, after.fulfilledAt)
  }
  const o = await mk('paid')
  const bad = await shipNotice(o, 'wrong-token')
  const [still] = await db.select().from(orders).where(eq(orders.id, o.id))
  check('a supplier notice with the wrong token changes nothing (400)', bad.status === 400 && still.status === 'paid' && !still.trackingNumber, { status: bad.status, order: still.status })
}

// ── the picture never stops the payment (live, Stripe test mode, 10/12) ──────────────────────────────────────────
// The seeded sample products carry a data: URI picture; Stripe refused the session ("Not a valid URL") and the first
// checkout on a new store failed. Only a public https address goes to the payment page.
{
  const { checkoutImageUrl } = await import('../../server/crm/store/checkout/publicRoutes.ts') /* unified: the storefront API moved to server/crm/store/checkout/publicRoutes.ts (the sandbox sits in apps/unified/.suite) */
  const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLz4='
  check('image: a data: picture (the seeded sample products) is left off the payment page', checkoutImageUrl(svg) === undefined)
  check('image: so is a relative path, a plain-http address and nonsense', checkoutImageUrl('/media/abc.png') === undefined && checkoutImageUrl('http://cdn.example.com/a.png') === undefined && checkoutImageUrl('not a url') === undefined && checkoutImageUrl(null) === undefined)
  check('image: an uploaded or pasted https picture still goes', checkoutImageUrl('https://shop-api.example.com/media/products/a.png') === 'https://shop-api.example.com/media/products/a.png')
  const src = (require('node:fs') as typeof import('node:fs')).readFileSync('../../server/crm/store/checkout/publicRoutes.ts', 'utf8') /* unified: the checkout route is server/crm/store/checkout/publicRoutes.ts */.replace(/\r\n/g, '\n')
  check('image: the checkout route takes its picture through checkoutImageUrl, and nowhere else', /const shown = checkoutImageUrl\(img\?\.url\)\n\s*if \(shown\) li\.imageUrl = shown/.test(src) && !/li\.imageUrl = img\.url/.test(src))
  // …and a checkout of a product whose only picture is a data: URI still reaches the provider and creates the order.
  const { productImages } = await import('./db/schema.ts')
  await db.insert(productImages).values({ productId: prod.id, url: svg, isPrimary: true, position: 0 } as any)
  const r = await checkout({}, 1)
  check(`image: a product pictured with a data: URI still checks out (${r.r.status})`, r.r.status === 200 && !!r.order, r.r.json)
}

globalThis.fetch = realFetch
console.log(`\ncheckout charge: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
