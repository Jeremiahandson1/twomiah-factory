// crm-store — two people in the admin at once.
//
// Every admin write read the row, decided, then wrote — and nothing stopped a second person doing the same in
// between. What that cost, before this file:
//   · an order refunded from two screens put its units back twice (10 in stock, 2 refunded twice → 14)
//   · a cancel racing "mark shipped" restocked an order that then read shipped
//   · two people pressing "Buy label" on one order were both charged by the carrier
//   · a stock count typed into a page loaded earlier put back every unit sold since; two people counting the shelf
//     at once, the later save silently won
//   · two "make primary" clicks could leave a product with two primary photos
//   · two managers saving different loyalty settings at once: the second put the first one's setting back
//
// Asserted through the real admin routes, two seats at once (Promise.all), behind the real permissions module;
// only authenticate is bridged (x-test-user). EasyPost's HTTP calls are answered here, slowly, so two purchases
// overlap the way two people's do.
process.env.PAYMENT_ENC_KEY ||= 'admin-concurrency-test-key'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, orderItems, products, productVariants, productImages, shippingConfig } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
const { encryptJSON } = await import('./src/lib/crypto.ts')
await db.insert(storeSettings).values({ companyName: 'Two Screens Store', currency: 'usd', loyalty: { enabled: true, pointsPerDollar: 1 } } as any)
const mkUser = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@twoscreens.test`, passwordHash: 'x', name, role } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const managerA = await mkUser('manager', 'manager-a')
const managerB = await mkUser('manager', 'manager-b')
const staffA = await mkUser('staff', 'staff-a')
const staffB = await mkUser('staff', 'staff-b')

const [product] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 } as any).returning()
const [untracked] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-DIGITAL', name: 'Digital', priceCents: 500, inventoryQty: null } as any).returning()
const stockOf = async (id = variant.id) => (await db.select().from(productVariants).where(eq(productVariants.id, id)))[0]
const setStock = (n: number | null) => db.update(productVariants).set({ inventoryQty: n }).where(eq(productVariants.id, variant.id))

const ADDRESS = { name: 'Ada', line1: '1 Main St', city: 'Madison', state: 'WI', postalCode: '53703', country: 'US' }
let n = 0
const mkOrder = async (status: string, extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-C${n}`, provider: 'stripe', providerSessionId: `sess_c${n}`, status,
    customerEmail: `shopper${n}@example.com`, subtotalCents: 3000, shippingCents: 0, taxCents: 0,
    totalCents: 3000, currency: 'usd', shippingAddress: ADDRESS, ...extra,
  } as any).returning()
  await db.insert(orderItems).values({
    orderId: o.id, variantId: variant.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1',
    unitPriceCents: 1500, quantity: 2, lineTotalCents: 3000,
  } as any)
  return o
}
const orderNow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

// ── EasyPost, answered here ────────────────────────────────────────────────────────────────────────
let bought = 0, buyFails = false
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://api.easypost.com/')) return realFetch(input, init)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  await new Promise((r) => setTimeout(r, 40))   // a carrier takes a moment — long enough for a second press to arrive
  if (url.endsWith('/shipments')) return json({ id: `shp_${Math.random().toString(36).slice(2)}`, rates: [{ id: 'rate_1', carrier: 'USPS', service: 'Ground', rate: '7.25' }] })
  if (url.endsWith('/buy')) {
    if (buyFails) return json({ error: { message: 'Carrier is down' } }, 502)
    bought++
    return json({ id: 'shp_x', tracking_code: `TRK${bought}`, postage_label: { label_url: `https://labels.test/${bought}.pdf` }, selected_rate: { carrier: 'USPS', service: 'Ground', rate: '7.25' } })
  }
  return json({}, 404)
}) as any
await db.insert(shippingConfig).values({
  provider: 'easypost', mode: 'test', connected: true,
  credentialsEnc: encryptJSON({ apiKey: 'EZTK_test_key', mode: 'test' }), fromAddress: ADDRESS,
} as any)

const app = new Hono()
app.route('/api/admin/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/admin/products', (await import('./src/routes/products.ts')).default)
app.route('/api/admin/shipping', (await import('./src/routes/shipping.ts')).default)
app.route('/api/admin/loyalty', (await import('./src/routes/loyalty.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const MA = as(managerA), MB = as(managerB), SA = as(staffA), SB = as(staffB)
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort().join(',')

// ── an order, from two screens ─────────────────────────────────────────────────────────────────────
{
  await setStock(10)
  const o = await mkOrder('paid')
  const rs = await Promise.all([MA('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' }), MB('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })])
  check(`refunded from two screens at once: one refund, one told (200,409 — ${statuses(rs)})`, statuses(rs) === '200,409', rs.map((r) => r.json))
  check(`…and the 2 units go back once (10 → 12: ${(await stockOf()).inventoryQty})`, (await stockOf()).inventoryQty === 12)
  const loser = rs.find((r) => r.status === 409)
  check('…the one refused is told who got there first, by code', loser?.json?.code === 'order_changed' && loser?.json?.status === 'refunded' && /Someone else just marked this order refunded/.test(loser?.json?.error), loser?.json)
}
{
  await setStock(10)
  const o = await mkOrder('paid')
  const rs = await Promise.all([MA('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' }), SA('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'shipped' })])
  const now = await orderNow(o.id), qty = (await stockOf()).inventoryQty
  check(`cancel and "mark shipped" at once: exactly one applies (${statuses(rs)})`, statuses(rs) === '200,409', rs.map((r) => r.json))
  check(`…and stock agrees with the order that won (${now.status}, ${qty} in stock)`, (now.status === 'cancelled' && qty === 12) || (now.status === 'shipped' && qty === 10), { status: now.status, qty })
  check('…a cancelled order is never left stamped fulfilled', now.status !== 'cancelled' || !now.fulfilledAt, now)
}
{
  await setStock(10)
  const o = await mkOrder('paid')
  const rs = await Promise.all([
    MA('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' }),
    SA('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { trackingNumber: 'TRK-HAND', markShipped: true }),
  ])
  const now = await orderNow(o.id), qty = (await stockOf()).inventoryQty
  check(`refund and "save & mark shipped" at once: exactly one moves the order (${statuses(rs)})`, statuses(rs) === '200,409', rs.map((r) => r.json))
  check(`…stock agrees with the order that won (${now.status}, ${qty} in stock)`, (now.status === 'refunded' && qty === 12) || (now.status === 'shipped' && qty === 10), { status: now.status, qty })
}
{
  // Tracking and the note are separate boxes; saving one keeps the other's.
  const o = await mkOrder('paid')
  await Promise.all([SA('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { trackingNumber: 'TRK-77' }), SB('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { internalNote: 'gift wrap' })])
  const now = await orderNow(o.id)
  check('one adds the tracking number while another writes the note: both kept', now.trackingNumber === 'TRK-77' && now.internalNote === 'gift wrap' && now.status === 'paid', now)
}

// ── a label, from two screens ──────────────────────────────────────────────────────────────────────
{
  const o = await mkOrder('paid')
  bought = 0
  const rs = await Promise.all([SA('POST', `/api/admin/shipping/orders/${o.id}/label`, {}), SB('POST', `/api/admin/shipping/orders/${o.id}/label`, {})])
  const now = await orderNow(o.id)
  check(`"Buy label" pressed on two screens: the carrier is charged once (${bought})`, bought === 1, rs.map((r) => r.json))
  check(`…one gets the label, one is told it is under way (${statuses(rs)})`, statuses(rs) === '200,409' && rs.some((r) => r.json?.code === 'label_in_progress'), rs.map((r) => r.json))
  check('…the order carries that one label and reads shipped', now.labelUrl === 'https://labels.test/1.pdf' && now.trackingNumber === 'TRK1' && now.status === 'shipped' && !!now.fulfilledAt, now)
  const again = await SA('POST', `/api/admin/shipping/orders/${o.id}/label`, {})
  check('…and a third press later buys nothing (400, already bought)', again.status === 400 && bought === 1, again.json)
}
{
  // The carrier failed: nothing was bought, so the next press must be able to try again.
  const o = await mkOrder('paid')
  bought = 0; buyFails = true
  const r1 = await SA('POST', `/api/admin/shipping/orders/${o.id}/label`, {})
  buyFails = false
  const r2 = await SA('POST', `/api/admin/shipping/orders/${o.id}/label`, {})
  check(`a failed purchase does not hold the order: 502, then the retry buys it (${r1.status}, ${r2.status})`, r1.status === 502 && r2.status === 200 && bought === 1, [r1.json, r2.json])
}
{
  // A purchase that died half-way (the process restarted) leaves a claim; it lapses, the order is not stuck.
  const o = await mkOrder('paid', { labelPurchasedAt: new Date(Date.now() - 6 * 60_000) })
  const fresh = await mkOrder('paid', { labelPurchasedAt: new Date(Date.now() - 60_000) })
  bought = 0
  const stale = await SA('POST', `/api/admin/shipping/orders/${o.id}/label`, {})
  const busy = await SA('POST', `/api/admin/shipping/orders/${fresh.id}/label`, {})
  check(`a claim six minutes old lapses (200); one a minute old is still under way (409) — ${stale.status}, ${busy.status}`, stale.status === 200 && busy.status === 409 && bought === 1, [stale.json, busy.json])
}
{
  // Cancelled while the carrier answered: the label is paid for, so it is recorded — but the order stays cancelled.
  await setStock(10)
  const o = await mkOrder('paid')
  bought = 0
  const [label, cancel] = await Promise.all([
    SA('POST', `/api/admin/shipping/orders/${o.id}/label`, {}),
    new Promise((r) => setTimeout(r, 10)).then(() => MA('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' })),
  ])
  const now = await orderNow(o.id)
  check(`cancelled while the label was being bought: it stays cancelled (${now.status}), its stock back (${(await stockOf()).inventoryQty})`, cancel.status === 200 && now.status === 'cancelled' && (await stockOf()).inventoryQty === 12, { cancel: cancel.json, now })
  check('…the label is still on the order, and the screen is told it was not marked shipped', label.status === 200 && now.labelUrl === 'https://labels.test/1.pdf' && /not marked shipped/.test(label.json?.note || ''), label.json)
}

// ── the stock count ────────────────────────────────────────────────────────────────────────────────
{
  await setStock(10)
  // the page loaded at 10; three were sold; the count typed over 10 is a count from before the sale
  await setStock(7)
  const stale = await SA('PATCH', `/api/admin/products/variants/${variant.id}`, { priceCents: 1800, inventoryQty: 15, inventoryFrom: 10 })
  const v = await stockOf()
  check(`a count typed over a figure that has since moved is refused (409 — ${stale.status})`, stale.status === 409 && stale.json?.code === 'inventory_changed' && stale.json?.inventoryQty === 7, stale.json)
  check(`…and nothing in that save is applied: stock 7, price 15.00 (${v.inventoryQty}, ${v.priceCents})`, v.inventoryQty === 7 && v.priceCents === 1500, v)
  check('…the refusal says the count as it stands', /stock changed to 7/.test(stale.json?.error || ''), stale.json)
  const ok = await SA('PATCH', `/api/admin/products/variants/${variant.id}`, { inventoryQty: 15, inventoryFrom: 7 })
  check(`typed over the figure it really is, it saves (200, ${(await stockOf()).inventoryQty})`, ok.status === 200 && (await stockOf()).inventoryQty === 15, ok.json)
  const price = await SA('PATCH', `/api/admin/products/variants/${variant.id}`, { priceCents: 1800 })
  check('a price fix leaves the count alone', price.status === 200 && (await stockOf()).inventoryQty === 15 && (await stockOf()).priceCents === 1800, price.json)
}
{
  await setStock(7)
  const rs = await Promise.all([
    SA('PATCH', `/api/admin/products/variants/${variant.id}`, { inventoryQty: 9, inventoryFrom: 7 }),
    SB('PATCH', `/api/admin/products/variants/${variant.id}`, { inventoryQty: 8, inventoryFrom: 7 }),
  ])
  const qty = (await stockOf()).inventoryQty
  check(`two people count the shelf at once: one count saves, the other is told (${statuses(rs)}, stock ${qty})`, statuses(rs) === '200,409' && (qty === 9 || qty === 8), rs.map((r) => r.json))
}
{
  const fromNull = await SA('PATCH', `/api/admin/products/variants/${untracked.id}`, { inventoryQty: 5, inventoryFrom: null })
  check('an untracked variant starts tracking from "untracked" (200, 5)', fromNull.status === 200 && (await stockOf(untracked.id)).inventoryQty === 5, fromNull.json)
  const back = await SA('PATCH', `/api/admin/products/variants/${untracked.id}`, { inventoryQty: null, inventoryFrom: 3 })
  check('…and a change typed over a wrong figure is refused there too (409)', back.status === 409 && (await stockOf(untracked.id)).inventoryQty === 5, back.json)
  const plain = await SA('PATCH', `/api/admin/products/variants/${untracked.id}`, { inventoryQty: 6 })
  check('a save that names no starting figure sets the count outright, as before', plain.status === 200 && (await stockOf(untracked.id)).inventoryQty === 6, plain.json)
  const missing = await SA('PATCH', '/api/admin/products/variants/00000000-0000-0000-0000-000000000000', { inventoryQty: 1, inventoryFrom: 0 })
  check('a variant that does not exist is 404, not "the stock changed"', missing.status === 404, missing.json)
}

// ── the primary photo ──────────────────────────────────────────────────────────────────────────────
{
  const imgs = await db.insert(productImages).values([0, 1, 2].map((i) => ({ productId: product.id, url: `https://img.test/${i}.jpg`, position: i, isPrimary: i === 0 })) as any).returning()
  for (let round = 0; round < 5; round++) {
    await Promise.all([
      SA('PATCH', `/api/admin/products/images/${imgs[1].id}`, { isPrimary: true }),
      SB('PATCH', `/api/admin/products/images/${imgs[2].id}`, { isPrimary: true }),
    ])
    const prim = (await db.select().from(productImages).where(eq(productImages.productId, product.id))).filter((i) => i.isPrimary)
    if (prim.length !== 1) { check(`two "make primary" at once (round ${round + 1}): one primary photo`, false, prim.map((p) => p.url)); break }
    if (round === 4) check('two "make primary" at once, five rounds: always exactly one primary photo', true)
  }
  const added = await SA('POST', `/api/admin/products/${product.id}/images`, { url: 'https://img.test/new.jpg', isPrimary: true })
  const prim = (await db.select().from(productImages).where(eq(productImages.productId, product.id))).filter((i) => i.isPrimary)
  check('adding a photo as primary makes it the only primary', added.status === 201 && added.json?.image?.isPrimary === true && prim.length === 1 && prim[0].url === 'https://img.test/new.jpg', prim.map((p) => p.url))
  const alt = await SA('PATCH', `/api/admin/products/images/${imgs[0].id}`, { alt: 'Front' })
  const [img0] = await db.select().from(productImages).where(eq(productImages.id, imgs[0].id))
  check('editing a photo\'s alt text leaves which one is primary alone', alt.status === 200 && img0.alt === 'Front' && !img0.isPrimary && (await db.select().from(productImages).where(eq(productImages.productId, product.id))).filter((i) => i.isPrimary).length === 1, img0)
}

// ── the loyalty settings ───────────────────────────────────────────────────────────────────────────
{
  const rs = await Promise.all([
    MA('PUT', '/api/admin/loyalty/config', { loyaltyPointsPerDollar: 3 }),
    MB('PUT', '/api/admin/loyalty/config', { loyaltyWelcomePoints: 50 }),
    MA('PUT', '/api/admin/loyalty/config', { loyaltyPunchCard: { visitsRequired: 6, rewardName: 'Free mug' } }),
  ])
  const [row] = await db.select({ loyalty: storeSettings.loyalty }).from(storeSettings)
  const l: any = row.loyalty
  check(`three loyalty settings saved at once by two managers: all three kept (${JSON.stringify(l)})`,
    rs.every((r) => r.status === 200) && l.pointsPerDollar === 3 && l.welcomePoints === 50 && l.punchCard?.visitsRequired === 6 && l.enabled === true, l)
}

globalThis.fetch = realFetch
console.log(`\nadmin concurrency: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
