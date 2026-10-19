// ADAPTED COPY of tests/store/qa-t1.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// lines marked "unified:", where the unified build changed the schema, a reply's shape, where a rule lives, or (as the
// module's own header says) a behaviour. The original keeps running against the template.
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
import { company, storeSettings, users, orders, orderItems, products, productVariants, discountCodes } from './db/schema.ts' /* unified: the business is the company row (UNIFIED_STORE_PLAN decision 1) */
import { NEXT_STATUS } from '../../server/crm/store/orders/rules.ts' /* unified: the status table lives in the orders group's rules.ts (the sandbox's route files forward requests only) */
import { repairFulfilmentStamps } from '../../server/crm/store/orders/orders.ts' /* unified: the startup repair is a named function the app's scheduler runs once at boot */

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()

await setupSchema()
// A shop whose owner pressed Save on the Loyalty screen once: the old default written in as if it were chosen.
const [co] = await db.update(company).set({ name: 'Fern & Field' } as any).returning() /* unified: the shop's name is the company row's (decision 1); the template's settings row held it */
await db.insert(storeSettings).values({ currency: 'usd' } as any) /* unified: the commerce settings row keeps the currency (company_id filled with the one company) */
const owner = (await db.insert(users).values({ email: 'owner@fern.test', passwordHash: 'x', firstName: 'Owner', lastName: 'Fern', role: 'owner' } as any).returning())[0] /* unified: a user's first and last name, not name */
const staff = (await db.insert(users).values({ email: 'staff@fern.test', passwordHash: 'x', firstName: 'Staff', lastName: 'Fern', role: 'staff' } as any).returning())[0] /* unified: first and last name */
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
await repairFulfilmentStamps(db, co.id) /* unified: the repair the template issued as routes/orders.ts loaded runs once at boot (orders/index.ts addJob, never started in tests), so it is run here as the boot runs it */

// ── M1: the startup repair ─────────────────────────────────────────────────────────────────────────
check('M1 repair: a cancelled order left stamped as fulfilled is cleared', (await row(leftover.id)).fulfilledAt === null, (await row(leftover.id)).fulfilledAt)
check('M1 repair: …and an order that really shipped keeps its stamp', !!(await row(shippedEarlier.id)).fulfilledAt)

// ── M1: the table, both ways ───────────────────────────────────────────────────────────────────────
const STATUSES = ['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']
const TABLE: Record<string, string[]> = NEXT_STATUS /* unified: read from rules.ts */
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
  await new Promise((r) => setTimeout(r, 60))
  await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'shipped' })
  // by the millisecond: String(Date) drops them, and a stamp rewritten 60ms later read as unchanged
  check('M1: shipping after packing keeps the first fulfilment time', !!packed && new Date((await row(o.id)).fulfilledAt as any).getTime() === new Date(packed as any).getTime(), { packed, now: (await row(o.id)).fulfilledAt })
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
  const page = (await Bun.file(`${ROOT}apps/unified/web/src/crm/pages/store/orders/OrderDetailPage.tsx`).text()).replace(/\r\n/g, '\n') /* unified: the order screen is the store add-on's (web/src/crm/pages/store/orders) */
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
  check('L2: a plain code is trimmed and uppercased as before', ok.status === 201 && ok.json?.code === 'SPRING-10', ok.json) /* unified: one code is the record itself (RULEBOOK §3), not { code } */
  const other = await O('POST', '/api/admin/discounts', { code: 'FALL_5', type: 'fixed', value: 500 })
  const id = ok.json?.id /* unified: the record itself */
  const rename = await O('PATCH', `/api/admin/discounts/${id}`, { code: 'BAD CODE' })
  check('L2: an EDIT is held to the same shape (it checked nothing)', rename.status === 400, rename.json)
  const clash = await O('PATCH', `/api/admin/discounts/${id}`, { code: 'fall_5' })
  check('L2: …renaming onto another code is refused (409) — no unique index would stop it', clash.status === 409, clash.json)
  const over = await O('PATCH', `/api/admin/discounts/${id}`, { value: 500 })
  check('L2: …and a 10% code cannot be edited to 500%', over.status === 400 && /100/.test(String(over.json?.error)), over.json)
  const flip = await O('PATCH', `/api/admin/discounts/${other.json?.id}`, { type: 'percent' }) /* unified: the record itself */
  check('L2: …nor a $5.00 code flipped to "500 percent" by changing only its type', flip.status === 400, flip.json)
  const fine = await O('PATCH', `/api/admin/discounts/${id}`, { active: false })
  check('L2: an ordinary edit still saves', fine.status === 200 && fine.json?.active === false, fine.json) /* unified: the record itself */
  const rows = await db.select().from(discountCodes)
  check('L2: …and nothing above wrote a duplicate or a 500%', rows.filter((r) => r.code === 'FALL_5').length === 1 && rows.every((r) => r.type !== 'percent' || r.value <= 100), rows.map((r) => [r.code, r.type, r.value]))
}

// ── L3: what went back is on the dashboard ─────────────────────────────────────────────────────────
{
  const st = (await O('GET', '/api/admin/orders/stats')).json /* unified: the stats are the record itself, not { stats } */
  const all = await db.select().from(orders)
  // Every order with money sent back, whole or in part (E2E Run 2), counted from what went back — refundedCents.
  const refunded = all.filter((o) => !['pending', 'cancelled'].includes(o.status) && o.refundedCents > 0)
  check('L3: the dashboard reports how many orders had money sent back', st?.refundedCount === refunded.length && refunded.length > 0, { st, n: refunded.length })
  check('L3: …and how much', st?.refundedCents === refunded.reduce((a, o) => a + o.refundedCents, 0), st)
  check('L3: …and what the shop kept (revenue less refunds)', st?.netCents === st?.revenueCents - st?.refundedCents, st)
  const ss = (await S('GET', '/api/admin/orders/stats')).json /* unified: the record itself */
  check('L3: staff (no revenue:read) get the count but not the money — null, like revenue', ss?.refundedCents === null && ss?.revenueCents === null && typeof ss?.refundedCount === 'number', ss)
}

// ── L1: the reward a shop gives is an item ─────────────────────────────────────────────────────────
{
  const cfg = (await O('GET', '/api/admin/loyalty/config')).json
  check('L1: a shop that has not named its reward reads "Free item", not the service CRMs\' "Free service"', cfg?.loyaltyPunchCard?.rewardName === 'Free item', cfg?.loyaltyPunchCard) /* unified: the template's boot repair of a SAVED "Free service" is not carried (server/crm/store/core.ts header: every live store's boot already ran it before the data moves); the store's default reward name is asserted instead — see the report */
  await db.update(company).set({ settings: { loyalty: { enabled: true, punchCard: { visitsRequired: 5 } } } } as any).where(eq(company.id, co.id)) /* unified: the programme's settings are company.settings.loyalty (catalog/loyalty.ts); a punch card saved with no name of its own */
  const five = (await O('GET', '/api/admin/loyalty/config')).json
  check('L1: …the rest of its punch card untouched', five?.loyaltyPunchCard?.visitsRequired === 5 && five?.loyaltyPunchCard?.rewardName === 'Free item', five?.loyaltyPunchCard) /* unified: read after the saved punch card above */
  await O('PUT', '/api/admin/loyalty/config', { loyaltyPunchCard: { visitsRequired: 6, rewardName: 'A free candle' } })
  const named = (await O('GET', '/api/admin/loyalty/config')).json
  check('L1: an owner\'s own reward name is kept', named?.loyaltyPunchCard?.rewardName === 'A free candle', named?.loyaltyPunchCard)
  const { loyaltyConfig } = await import('./src/shared/index.ts')
  check('L1: the service CRMs keep "Free service" as their default', loyaltyConfig({}).punchCard.rewardName === 'Free service')
}

// ── T2 N1: the dashboard tiles never leave one on its own row ──────────────────────────────────────
// Two to six tiles show (revenue:read, a refund and the net beside it, an order at the supplier). For every count, at every breakpoint the
// grid names, the last row holds more than one tile — or the grid is one column wide. Read from the page's own table.
{
  const page = (await import('node:fs')).readFileSync(ROOT + 'apps/unified/web/src/crm/pages/store/orders/DashboardPage.tsx', 'utf8').replace(/\r\n/g, '\n') /* unified: the store add-on's dashboard */
  const table = page.match(/const TILE_COLUMNS: Record<number, string> = \{([\s\S]*?)\n\}/)?.[1] || ''
  const cols = new Map([...table.matchAll(/(\d): '([^']*)'/g)].map((m) => [Number(m[1]), m[2]]))
  check('N1: the grid takes its columns from the tile table', /className=\{`grid grid-cols-1 \$\{TILE_COLUMNS\[tiles\.length\] \|\| TILE_COLUMNS\[6\]\} gap-4`\}/.test(page) && cols.size === 6, [...cols]) /* unified: the fallback is the six-tile row (TILE_COLUMNS[6]; the template's [5]) — never reached, there are at most six tiles */
  for (const n of [2, 3, 4, 5, 6]) {
    const perBreakpoint = [...(cols.get(n) || '').matchAll(/(?:^|\s)(\w+):grid-cols-(\d)/g)].map((m) => [m[1], Number(m[2])] as const)
    const lone = perBreakpoint.filter(([, c]) => c > 1 && n % c === 1)
    check(`N1: ${n} tiles — no breakpoint leaves one tile alone on the last row (${cols.get(n)})`, perBreakpoint.length > 0 && lone.length === 0, lone)
  }
  const tiles = page.match(/const tiles = stats \? \[([\s\S]*?)\]\.filter\(Boolean\)/)?.[1] || '' /* unified: the list is built once the stats are in (`stats ? [ … ].filter(Boolean) : []`) */
  check('N1: the six tiles are the table\'s six — every one in the list the grid counts', (tiles.match(/<StatCard key="/g) || []).length === 6 && !/<StatCard/.test(page.slice(page.indexOf('{tiles}'), page.indexOf('function StatCard('))), tiles.slice(0, 200))
}

console.log(`\nstore QA T1: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
