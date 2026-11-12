// The store's STOCK HISTORY and Shopify's inventory reports (live test 11/12: the store could say what was on the shelf now but not
// what it was on any past day, so it had no sell-through, days-of-stock or ABC report, and no per-option adjustment history).
// Through the real server as the store:
//   · every door that changes a count keeps a row with the exact before → after, why, the order or purchase order behind it, and who:
//     a variant made with stock, a count typed on the product, a sale (never below zero: an oversell keeps what really came off),
//     a refund's restock, the API, counting switched off;
//   · the product's stock history lists them newest first, worded, with the order number, 50 at a time;
//   · the stock on a past day is read back from the history;
//   · sell-through (sold ÷ (sold + ending)), days of inventory left (ending ÷ sold a day) and ABC grades (80 / 15 / 5 of sales)
//     agree with the hand-worked figures, and the stock changes report lists the moves.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { decrementStock } from '../server/data/storeCheckout.ts'
import { restockVariant } from '../server/data/storeOrders.ts'
import { writeStock } from '../server/data/storeApi.ts'
import { stockAt } from '../server/data/storeStockMoves.ts'
import { abcGrades, daysOfStockLeft, sellThroughPercent } from '../server/data/storeReports.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const S = () => t.schema as any
const moves = async (variantId: string) => (await (t.db as any).select().from(S().storeStockMove).where(eq(S().storeStockMove.variantId, variantId))).sort((a: any, b: any) => +a.createdAt - +b.createdAt || 0)
let n = 0
const sell = async (variantId: string, name: string, quantity: number, unitPriceCents: number) => {
  n++
  const [o] = await (t.db as any).insert(S().storeOrder).values({
    companyId, orderNumber: `ORD-H${n}`, provider: 'square', providerSessionId: `sq_h_${n}`, status: 'paid', customerEmail: `h${n}@example.com`,
    subtotalCents: unitPriceCents * quantity, totalCents: unitPriceCents * quantity, currency: 'usd',
  }).returning()
  await (t.db as any).insert(S().storeOrderItem).values({ orderId: o.id, variantId, productName: name, variantName: 'Default', sku: name.toUpperCase(), unitPriceCents, quantity, lineTotalCents: unitPriceCents * quantity })
  await decrementStock(t.db, variantId, quantity, { reason: 'sold', orderId: o.id })
  return o
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['store_sales_reports', 'store_report_schedules'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
}, 120_000)

/** A product with one option made through the product screen, `qty` in stock. */
const product = async (name: string, qty: number | null, priceCents = 1000) => {
  const p = await json(await call('/api/admin/products', { method: 'POST', json: { name, slug: name.toLowerCase(), status: 'active' } }))
  expect(p.status).toBe(201)
  const v = await json(await call(`/api/admin/products/${p.body.id}/variants`, { method: 'POST', json: { sku: name.toUpperCase(), name: 'Default', priceCents, inventoryQty: qty } }))
  expect(v.status).toBe(201)
  return v.body.id as string
}

test('every door keeps its change: made, typed, sold (an oversell keeps what really came off), restocked, the API, counting off', async () => {
  const mug = await product('Mug', 10)
  const typed = await call(`/api/admin/products/variants/${mug}`, { method: 'PATCH', json: { inventoryQty: 12, inventoryFrom: 10 } })
  expect(typed.status).toBe(200)
  const o = await sell(mug, 'Mug', 3, 1000)
  await decrementStock(t.db, mug, 20, { reason: 'sold' })
  await restockVariant(t.db, mug, 2, o.id, { note: 'Order refunded' })
  const api = await writeStock(t.db, companyId, mug, { adjustBy: -1 }, undefined, { id: 'key_1', name: 'Warehouse sync' })
  expect(api).toMatchObject({ ok: true, before: 2, after: 1 })
  expect((await call(`/api/admin/products/variants/${mug}`, { method: 'PATCH', json: { inventoryQty: null } })).status).toBe(200)

  const m = await moves(mug)
  expect(m.map((x: any) => [x.reason, x.quantityBefore, x.quantityAfter, x.delta])).toEqual([
    ['created', null, 10, 10], ['adjusted', 10, 12, 2], ['sold', 12, 9, -3], ['sold', 9, 0, -9], ['restocked', 0, 2, 2], ['adjusted', 2, 1, -1], ['untracked', 1, null, -1],
  ])
  expect(m[0].byName).toBeTruthy()
  expect(m[1].byName).toBe(m[0].byName)
  expect(m[2].orderId).toBe(o.id)
  expect(m[4]).toMatchObject({ orderId: o.id, note: 'Order refunded' })
  expect(m[5]).toMatchObject({ refId: 'key_1', byName: 'API key "Warehouse sync"' })
  // A count typed to what it already is changes nothing and keeps nothing.
  const bowl = await product('Bowl', 4)
  expect((await call(`/api/admin/products/variants/${bowl}`, { method: 'PATCH', json: { inventoryQty: 4, inventoryFrom: 4 } })).status).toBe(200)
  expect((await moves(bowl)).length).toBe(1)
})

test("the product's stock history: newest first, worded, with the order number; 50 at a time", async () => {
  const cup = await product('Cup', 60)
  const o = await sell(cup, 'Cup', 1, 500)
  const h = await json(await call(`/api/admin/products/variants/${cup}/stock-history`))
  expect(h.status).toBe(200)
  expect(h.body.data[0]).toMatchObject({ reason: 'sold', what: 'Sold', change: -1, after: 59, orderId: o.id, orderNumber: o.orderNumber })
  expect(h.body.data[1]).toMatchObject({ reason: 'created', what: 'Started counting', change: 60, after: 60 })
  expect(h.body.more).toBe(false)
  for (let i = 0; i < 55; i++) await decrementStock(t.db, cup, 1, { reason: 'sold' })
  const p1 = await json(await call(`/api/admin/products/variants/${cup}/stock-history`))
  expect(p1.body.data.length).toBe(50)
  expect(p1.body.more).toBe(true)
  const p2 = await json(await call(`/api/admin/products/variants/${cup}/stock-history?before=${encodeURIComponent(p1.body.data[49].at)}`))
  expect(p2.body.data.length).toBeGreaterThan(0)
  expect(p2.body.data.at(-1).reason).toBe('created')
  // Another company's option is not found.
  expect((await call('/api/admin/products/variants/nope/stock-history')).status).toBe(404)
})

test('the stock on a past day comes back from the history', async () => {
  const [p] = await (t.db as any).insert(S().storeProduct).values({ companyId, slug: 'jar', name: 'Jar', status: 'active' }).returning()
  const [v] = await (t.db as any).insert(S().storeProductVariant).values({ productId: p.id, sku: 'JAR', name: 'Default', priceCents: 700, inventoryQty: 3 }).returning()
  const day = 86_400_000, now = Date.now()
  await (t.db as any).insert(S().storeStockMove).values([
    { companyId, variantId: v.id, reason: 'created', quantityBefore: null, quantityAfter: 5, delta: 5, createdAt: new Date(now - 10 * day) },
    { companyId, variantId: v.id, reason: 'sold', quantityBefore: 5, quantityAfter: 3, delta: -2, createdAt: new Date(now - 5 * day) },
  ])
  const at = async (ms: number) => (await stockAt(t.db, companyId, [v.id], new Date(ms))).get(v.id)
  expect(await at(now - 20 * day)).toBeNull()
  expect(await at(now - 7 * day)).toBe(5)
  expect(await at(now - 1 * day)).toBe(3)
})

test("Shopify's formulas: sell-through, days left, ABC grades", () => {
  expect(sellThroughPercent(8, 2)).toBe(80)
  expect(sellThroughPercent(0, 0)).toBeNull()
  expect(sellThroughPercent(3, null)).toBe(100)
  expect(daysOfStockLeft(8, 2, 30)).toBe(7.5)
  expect(daysOfStockLeft(0, 5, 30)).toBeNull()
  const g = abcGrades([{ id: 'c', salesCents: 300 }, { id: 'a', salesCents: 7000 }, { id: 'b', salesCents: 2000 }, { id: 'd', salesCents: 700 }, { id: 'z', salesCents: 0 }])
  // 7000 = 70% (A); before b is 70% < 80 → A; before d is 90% → B; before c is 97% → C; z sold nothing → C.
  expect(g.map((x) => [x.id, x.grade])).toEqual([['a', 'A'], ['b', 'A'], ['d', 'B'], ['c', 'C'], ['z', 'C']])
})

test('the inventory reports on Store › Sales: sell-through, days left, ABC, stock changes', async () => {
  const fast = await product('Fast', 10, 1000)
  const slow = await product('Slow', 10, 1000)
  const still = await product('Still', 5, 1000)
  await sell(fast, 'Fast', 8, 1000)
  await sell(slow, 'Slow', 1, 1000)
  const table = async (tab: string) => (await json(await call(`/api/admin/sales-reports/table?tab=${tab}`))).body
  const row = (r: any, sku: string) => r.rows.find((x: any) => x.sku === sku)

  const st = await table('sell_through')
  expect(st.title).toBe('Sell-through rate')
  expect(row(st, 'FAST')).toMatchObject({ sold: 8, ending: 2, rate: 80 })
  // The history began inside the window: the share of starting stock sold is blank, never "300%" (live test 11/12, M1).
  expect(row(st, 'FAST').ofStarting).toBeNull()
  expect(st.note).toMatch(/Stock history began on [A-Z][a-z]{2} \d{1,2}, \d{4}/)
  expect(st.note).not.toMatch(/Shopify/)
  expect(row(st, 'SLOW')).toMatchObject({ sold: 1, ending: 9, rate: 10 })
  expect(row(st, 'STILL')).toMatchObject({ sold: 0, ending: 5, rate: 0 })
  expect(st.note).toMatch(/units sold ÷ \(units sold \+ ending stock\)/)

  const dl = await table('days_left')
  expect(row(dl, 'FAST')).toMatchObject({ ending: 2, sold: 8, daysLeft: 7.5 })
  expect(row(dl, 'SLOW').daysLeft).toBe(270)
  expect(row(dl, 'STILL').daysLeft).toBeNull()

  const abc = await table('abc')
  expect(row(abc, 'FAST').grade).toBe('A')
  expect(row(abc, 'STILL').grade).toBe('C')

  const sm = await table('stock_moves')
  expect(sm.title).toBe('Stock changes')
  const fastMoves = sm.rows.filter((r: any) => r.sku === 'FAST')
  expect(fastMoves.map((r: any) => [r.what, r.change, r.after])).toEqual([['Sold', '-8', 2], ['Started counting', '+10', 10]])
  // A sale names its order and who sold it — here the online store (live test 11/12, M2).
  expect(fastMoves[0].order).toMatch(/^ORD-H\d+$/)
  expect(fastMoves[0].by).toBe('Online store')
  expect((await table('days_left')).title).toBe('Days of inventory left')
  expect(sm.columns.find((c: any) => c.key === 'at').kind).toBe('datetime')

  // The spreadsheet too.
  const csv = await call('/api/admin/sales-reports/export?report=sell_through')
  expect(csv.status).toBe(200)
  expect(await csv.text()).toContain('FAST')
  // The stock changes spreadsheet's times are the shop's, not UTC (live test 11/12, L3).
  const moves = await (await call('/api/admin/sales-reports/export?report=stock_moves')).text()
  expect(moves.split(/\r?\n/)[1]).toMatch(/^"\d{4}-\d{2}-\d{2} \d{2}:\d{2}"/)
})

