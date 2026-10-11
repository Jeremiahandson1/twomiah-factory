// Store QA T1 — the server half of the first store admin report, through the real routes.
//
//   M1  "A cancelled order moved to paid then shipped (200 each), and a refunded order moved back to paid. Setting
//        the cancelled order back to cancelled left fulfilledAt populated."
//   L1  "Default punch card reward name is service-business wording on a product store."
//   L2  'POST discount "T1 SP ACE" returned 201; unlikely to be enterable at checkout.'
//   L3  "Revenue $25.00 / Orders 1 while the only orders are cancelled and refunded … no refund figure beside it."
//
// M1 is asserted as a TABLE, both ways: every move the order screen offers is accepted, every other move is refused
// with 409 and changes nothing — status, fulfilment stamp or stock. The screen's own table is read from its source
// and must equal the server's, so the two cannot drift.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, orderItems, products, productVariants, discountCodes } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()

await setupSchema()
// A shop whose owner pressed Save on the Loyalty screen once: the old default written in as if it were chosen.
await db.insert(storeSettings).values({ companyName: 'Fern & Field', currency: 'usd', loyalty: { enabled: true, punchCard: { visitsRequired: 5, rewardName: 'Free service' } } } as any)
const owner = (await db.insert(users).values({ email: 'owner@fern.test', passwordHash: 'x', name: 'Owner', role: 'owner' } as any).returning())[0]
const staff = (await db.insert(users).values({ email: 'staff@fern.test', passwordHash: 'x', name: 'Staff', role: 'staff' } as any).returning())[0]
const [product] = await db.insert(products).values({ slug: 'jar', name: 'Jar', status: 'active' } as any).returning()
const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: 'JAR-1', name: 'Default', priceCents: 1250, inventoryQty: 20 } as any).returning()

let n = 0
const order = async (status: string, extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-T1-${n}`, provider: 'stripe', providerSessionId: `sess_t1_${n}`, status,
    customerEmail: `shopper${n}@example.com`, subtotalCents: 2500, shippingCents: 0, taxCents: 0, totalCents: 2500, currency: 'usd', ...extra,
  } as any).returning()
  await db.insert(orderItems).values({ orderId: o.id, variantId: variant.id, productName: 'Jar', variantName: 'Default', sku: 'JAR-1', unitPriceCents: 1250, quantity: 2, lineTotalCents: 2500 } as any)
  return o
}
const row = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]
const stock = async () => (await db.select().from(productVariants).where(eq(productVariants.id, variant.id)))[0].inventoryQty

// One stamped by the old route's back-move, written BEFORE the routes load so the startup repair meets it.
const leftover = await order('cancelled', { fulfilledAt: new Date('2026-10-11T04:10:00Z') })
const shippedEarlier = await order('shipped', { fulfilledAt: new Date('2026-10-01T12:00:00Z') })

const ordersRoutes = await import('./src/routes/orders.ts')
const app = new Hono()
app.route('/api/admin/orders', ordersRoutes.default)
app.route('/api/admin/discounts', (await import('./src/routes/discounts.ts')).default)
app.route('/api/admin/loyalty', (await import('./src/routes/loyalty.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), S = as(staff)
await O('GET', '/api/admin/orders/stats') // the startup repairs are issued as the modules load; let them land
await new Promise((r) => setTimeout(r, 300))

// ── M1: the startup repair ─────────────────────────────────────────────────────────────────────────
check('M1 repair: a cancelled order left stamped as fulfilled is cleared', (await row(leftover.id)).fulfilledAt === null, (await row(leftover.id)).fulfilledAt)
check('M1 repair: …and an order that really shipped keeps its stamp', !!(await row(shippedEarlier.id)).fulfilledAt)

// ── M1: the table, both ways ───────────────────────────────────────────────────────────────────────
const STATUSES = ['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']
const TABLE: Record<string, string[]> = ordersRoutes.NEXT_STATUS
for (const from of STATUSES) for (const to of STATUSES) {
  if (from === to) continue
  const o = await order(from)
  const before = await stock()
  const r = await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: to })
  const allowed = (TABLE[from] || []).includes(to)
  if (allowed) check(`M1: ${from} → ${to} is accepted`, r.status === 200 && r.json?.order?.status === to, { status: r.status, body: r.json })
  else {
    const after = await row(o.id)
    check(`M1: ${from} → ${to} is refused (409) and nothing moves`, r.status === 409 && r.json?.code === 'invalid_transition' && after.status === from && (await stock()) === before, { status: r.status, body: r.json, now: after.status })
  }
}
// the moves the report made, by name
for (const [from, to] of [['cancelled', 'paid'], ['cancelled', 'shipped'], ['refunded', 'paid'], ['pending', 'shipped']] as const) {
  const o = await order(from)
  const r = await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: to })
  check(`M1 (as reported): ${from} → ${to} refused, with words that say why`, r.status === 409 && /cannot|can be marked/.test(String(r.json?.error)), r.json)
}
// refunding stock back in still happens exactly once, and reopening cannot take it out again
{
  const o = await order('paid')
  const s0 = await stock()
  await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
  check('M1: refunding a paid order puts its 2 units back on the shelf', (await stock()) === s0 + 2, { s0, now: await stock() })
  const back = await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'paid' })
  check('M1: …and it cannot be reopened as paid with the units still on the shelf', back.status === 409 && (await stock()) === s0 + 2, back.json)
}
// the fulfilment stamp: first fulfilment kept, cleared on a cancel, kept on a refund after it shipped
{
  const o = await order('paid')
  await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'fulfilled' })
  const packed = (await row(o.id)).fulfilledAt
  await new Promise((r) => setTimeout(r, 20))
  await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'shipped' })
  check('M1: shipping after packing keeps the first fulfilment time', String((await row(o.id)).fulfilledAt) === String(packed), { packed, now: (await row(o.id)).fulfilledAt })
  await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
  check('M1: a refund after it shipped keeps the stamp — it did go out', !!(await row(o.id)).fulfilledAt)
  const c2 = await order('paid', { fulfilledAt: new Date() })
  await O('PATCH', `/api/admin/orders/${c2.id}/status`, { status: 'cancelled' })
  check('M1: a paid order cancelled before it went out carries no fulfilment stamp', (await row(c2.id)).fulfilledAt === null)
}
// a same-status save is not a move
{
  const o = await order('cancelled')
  const r = await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' })
  check('M1: saving the status an order already has is accepted and changes nothing', r.status === 200 && (await row(o.id)).status === 'cancelled', r)
}
// "Save & mark shipped" follows the same table
{
  const o = await order('cancelled')
  const r = await O('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { trackingNumber: 'X1', markShipped: true })
  check('M1: "Save & mark shipped" on a cancelled order is refused (409)', r.status === 409 && (await row(o.id)).status === 'cancelled', r.json)
  const p = await order('paid')
  const ok = await S('PATCH', `/api/admin/orders/${p.id}/fulfillment`, { trackingNumber: 'X2', markShipped: true })
  check('M1: …while staff still ship a paid one from the bench', ok.status === 200 && (await row(p.id)).status === 'shipped', ok.json)
}
// the order screen offers exactly the server's table
{
  const page = (await Bun.file(`${ROOT}templates/crm-store/frontend/src/pages/OrderDetailPage.tsx`).text()).replace(/\r\n/g, '\n')
  const block = page.match(/const NEXT_STATUS: Record<string, string\[\]> = \{([\s\S]*?)\n\}/)?.[1] || ''
  const screen: Record<string, string[]> = {}
  for (const m of block.matchAll(/(\w+): \[([^\]]*)\]/g)) screen[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])
  check('M1: the order screen\'s NEXT_STATUS is the server\'s, entry for entry', JSON.stringify(screen) === JSON.stringify(TABLE), { screen, server: TABLE })
}

// ── L2: a code is something a shopper can type ─────────────────────────────────────────────────────
{
  const spaced = await O('POST', '/api/admin/discounts', { code: 'T1 SP ACE', type: 'percent', value: 10 })
  check('L2: a code with a space inside is refused (400), in words', spaced.status === 400 && /no spaces/.test(String(spaced.json?.error)), spaced.json)
  const sym = await O('POST', '/api/admin/discounts', { code: 'SAVE$10', type: 'fixed', value: 1000 })
  check('L2: …and so is one with a symbol', sym.status === 400, sym.json)
  const ok = await O('POST', '/api/admin/discounts', { code: '  spring-10 ', type: 'percent', value: 10 })
  check('L2: a plain code is trimmed and uppercased as before', ok.status === 201 && ok.json?.code?.code === 'SPRING-10', ok.json)
  const other = await O('POST', '/api/admin/discounts', { code: 'FALL_5', type: 'fixed', value: 500 })
  const id = ok.json?.code?.id
  const rename = await O('PATCH', `/api/admin/discounts/${id}`, { code: 'BAD CODE' })
  check('L2: an EDIT is held to the same shape (it checked nothing)', rename.status === 400, rename.json)
  const clash = await O('PATCH', `/api/admin/discounts/${id}`, { code: 'fall_5' })
  check('L2: …renaming onto another code is refused (409) — no unique index would stop it', clash.status === 409, clash.json)
  const over = await O('PATCH', `/api/admin/discounts/${id}`, { value: 500 })
  check('L2: …and a 10% code cannot be edited to 500%', over.status === 400 && /100/.test(String(over.json?.error)), over.json)
  const flip = await O('PATCH', `/api/admin/discounts/${other.json?.code?.id}`, { type: 'percent' })
  check('L2: …nor a $5.00 code flipped to "500 percent" by changing only its type', flip.status === 400, flip.json)
  const fine = await O('PATCH', `/api/admin/discounts/${id}`, { active: false })
  check('L2: an ordinary edit still saves', fine.status === 200 && fine.json?.code?.active === false, fine.json)
  const rows = await db.select().from(discountCodes)
  check('L2: …and nothing above wrote a duplicate or a 500%', rows.filter((r) => r.code === 'FALL_5').length === 1 && rows.every((r) => r.type !== 'percent' || r.value <= 100), rows.map((r) => [r.code, r.type, r.value]))
}

// ── L3: what went back is on the dashboard ─────────────────────────────────────────────────────────
{
  const st = (await O('GET', '/api/admin/orders/stats')).json?.stats
  const all = await db.select().from(orders)
  const refunded = all.filter((o) => o.status === 'refunded')
  check('L3: the dashboard reports how many orders were refunded', st?.refundedCount === refunded.length && refunded.length > 0, { st, n: refunded.length })
  check('L3: …and how much', st?.refundedCents === refunded.reduce((a, o) => a + o.totalCents, 0), st)
  const ss = (await S('GET', '/api/admin/orders/stats')).json?.stats
  check('L3: staff (no revenue:read) get the count but not the money — null, like revenue', ss?.refundedCents === null && ss?.revenueCents === null && typeof ss?.refundedCount === 'number', ss)
}

// ── L1: the reward a shop gives is an item ─────────────────────────────────────────────────────────
{
  const cfg = (await O('GET', '/api/admin/loyalty/config')).json
  check('L1: the leaked "Free service" a store had saved now reads "Free item"', cfg?.loyaltyPunchCard?.rewardName === 'Free item', cfg?.loyaltyPunchCard)
  check('L1: …the rest of its punch card untouched', cfg?.loyaltyPunchCard?.visitsRequired === 5, cfg?.loyaltyPunchCard)
  await O('PUT', '/api/admin/loyalty/config', { loyaltyPunchCard: { visitsRequired: 6, rewardName: 'A free candle' } })
  const named = (await O('GET', '/api/admin/loyalty/config')).json
  check('L1: an owner\'s own reward name is kept', named?.loyaltyPunchCard?.rewardName === 'A free candle', named?.loyaltyPunchCard)
  const { loyaltyConfig } = await import('./src/shared/index.ts')
  check('L1: the service CRMs keep "Free service" as their default', loyaltyConfig({}).punchCard.rewardName === 'Free service')
}

console.log(`\nstore QA T1: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
