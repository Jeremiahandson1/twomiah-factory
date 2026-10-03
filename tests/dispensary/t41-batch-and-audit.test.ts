// crm-dispensary — T41. The batch a sale came out of, and the Audit Log filters.
//
// B1  A refund restored products.stock_quantity and never batches.current_quantity. /complete
//     decrements BOTH, so every return quietly shrank the lot's recorded remaining quantity for
//     good: sell 5 from a batch of 20, take all 5 back, and the batch reads 15 with 20 on the shelf.
//     That number is what a recall is answered with, so it is a compliance error, and it compounds.
// B2  The OTHER settlement path — PUT /:id/status to 'completed', which the code itself calls "the
//     other way a cannabis sale gets settled" — moved the product and not the batch. Same drift,
//     second door. Found by asking the rule rather than the report: every way a sale is completed
//     has to move the batch.
// A1  Every option in the Audit Log's action filter was a composite the log never stores
//     ('order_created', 'product_updated', …). The table holds `action` and `entity` in two
//     columns, so all fifteen matched zero rows and the screen emptied on any selection.
// A2  The screen sent dateFrom/dateTo; the endpoint read startDate/endDate. The date filter was
//     therefore IGNORED, which returns everything and reads as an answer.
// A3  The To date is a bare YYYY-MM-DD, so `created_at <= '2026-10-03'` meant that day at 00:00 and
//     excluded the whole of the 3rd. From = To = today returned nothing.
// A4  The screen sent `search`; the query had no search parameter at all. Every keystroke returned
//     the unfiltered log.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t41', email: 'b@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'batches', 'compliance', 'audit_log'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t41@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')

const app = new Hono()
app.route('/api/batches', (await import('./src/routes/batches.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/audit', (await import('./src/routes/audit.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const api = as(owner)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stockOf = async (id: string) => Number((await rows(sql`SELECT stock_quantity FROM products WHERE id = ${id}`))[0]?.stock_quantity)
const batchQty = async (id: string) => Number((await rows(sql`SELECT current_quantity FROM batches WHERE id = ${id}`))[0]?.current_quantity)

/**
 * A product whose ENTIRE shelf is one batch, so the till has to draw from that batch and stamps the
 * line with its id. A product with untracked units on top would be served from those instead (T47
 * P4), and then none of this would be exercised.
 */
const trackedProduct = async (name: string, qty: number) => {
  const [p] = await db.insert(product).values({
    name, companyId: co.id, category: 'flower', price: '20', stockQuantity: qty,
    weightGrams: '1', taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', {
    batchNumber: `T41-${name.replace(/\s+/g, '')}`, productId: p.id, quantity: qty, unitOfMeasure: 'units',
  })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)
  return { product: p, batch: b }
}

const sell = async (productId: string, qty: number) =>
  await api('POST', '/api/orders', { items: [{ productId, quantity: qty }], orderType: 'pickup', idVerified: true })

// ═══════════════ B1 · a refund puts the units back in the LOT, not just on the shelf ════════════
{
  const { product: p, batch: b } = await trackedProduct('Blue Dream', 20)
  check('B1: a batch of 20 covers the whole shelf', await batchQty(b.id) === 20, await batchQty(b.id))

  const sale = await sell(p.id, 5)
  const order = sale.json?.data || sale.json
  const done = await api('POST', `/api/orders/${order.id}/complete`, { paymentMethod: 'cash', cashTendered: 500, idVerified: true })
  check('B1: the sale settles', done.status === 200, done.json)

  const line = (await rows(sql`SELECT batch_id FROM order_items WHERE order_id = ${order.id}`))[0]
  check('B1: the line records WHICH batch the units came out of', !!line?.batch_id, line)

  check('B1: the shelf went down by 5', await stockOf(p.id) === 15, await stockOf(p.id))
  check('B1: and so did the lot — /complete moves both', await batchQty(b.id) === 15, await batchQty(b.id))

  const refund = await api('POST', `/api/orders/${order.id}/refund`, {
    reason: 'Customer returned it unopened', restoreInventory: true,
  })
  check('B1: the refund is accepted', refund.status === 200, refund.json)
  check('B1: the shelf is back to 20', await stockOf(p.id) === 20, await stockOf(p.id))
  // THE BUG. This read 15 before the fix, for ever, on a shelf holding 20.
  check('B1: AND THE LOT IS BACK TO 20 — the number a recall is answered with', await batchQty(b.id) === 20, await batchQty(b.id))
}

// ═══════════════ B1b · a PARTIAL return puts back only what came back ═══════════════════════════
{
  const { product: p, batch: b } = await trackedProduct('Sour Diesel', 10)
  const sale = await sell(p.id, 6)
  const order = sale.json?.data || sale.json
  await api('POST', `/api/orders/${order.id}/complete`, { paymentMethod: 'cash', cashTendered: 500, idVerified: true })
  check('B1b: 6 of 10 sold leaves 4 in the lot', await batchQty(b.id) === 4, await batchQty(b.id))

  const lines = await rows(sql`SELECT id FROM order_items WHERE order_id = ${order.id}`)
  const part = await api('POST', `/api/orders/${order.id}/refund`, {
    reason: 'Two of the six came back', restoreInventory: true,
    partialItems: [{ orderItemId: lines[0].id, quantity: 2 }],
  })
  check('B1b: the partial refund is accepted', part.status === 200, part.json)
  check('B1b: the shelf is 4 + 2 = 6', await stockOf(p.id) === 6, await stockOf(p.id))
  check('B1b: the lot is 4 + 2 = 6, not 10', await batchQty(b.id) === 6, await batchQty(b.id))
}

// ═══════════════ B1c · a return can never inflate a lot past what it held ═══════════════════════
//
// The restore is capped at GREATEST(initial_quantity, current_quantity). Without the cap, a lot the
// sale had floored at 0 through earlier drift would come back holding units it never had.
{
  const { product: p, batch: b } = await trackedProduct('Gelato', 8)
  const sale = await sell(p.id, 3)
  const order = sale.json?.data || sale.json
  await api('POST', `/api/orders/${order.id}/complete`, { paymentMethod: 'cash', cashTendered: 500, idVerified: true })

  // Someone counts the lot and finds it already full — the drift this cap exists for.
  await db.execute(sql`UPDATE batches SET current_quantity = 8 WHERE id = ${b.id}`)
  const refund = await api('POST', `/api/orders/${order.id}/refund`, { reason: 'Returned', restoreInventory: true })
  // Asserted explicitly: without this the cap "passes" whenever the refund is REFUSED, which is how
  // the first run of this test reported green on a sale the age gate had rejected.
  check('B1c: the refund really did happen', refund.status === 200, refund.json)
  check('B1c: the lot stops at the 8 it started with, it does not go to 11', await batchQty(b.id) === 8, await batchQty(b.id))
}

// ═══════════════ B2 · the status route is the other way a sale settles ══════════════════════════
{
  const { product: p, batch: b } = await trackedProduct('Wedding Cake', 12)
  const sale = await sell(p.id, 4)
  const order = sale.json?.data || sale.json

  const moved = await api('PUT', `/api/orders/${order.id}/status`, { status: 'completed' })
  check('B2: an order can be settled from the status flow', moved.status === 200, moved.json)
  check('B2: the shelf went down by 4', await stockOf(p.id) === 8, await stockOf(p.id))
  // THE BUG. This path moved the product and left the lot at 12.
  check('B2: AND SO DID THE LOT — both doors move the batch', await batchQty(b.id) === 8, await batchQty(b.id))

  // …and the refund stays balanced against it, which is what completedAt gates.
  const refund = await api('POST', `/api/orders/${order.id}/refund`, { reason: 'Returned', restoreInventory: true })
  check('B2: a sale settled that way can still be refunded', refund.status === 200, refund.json)
  check('B2: the lot comes back to 12 — neither double-counted nor short', await batchQty(b.id) === 12, await batchQty(b.id))
}

// ═══════════════════════════════ the Audit Log filters ══════════════════════════════════════════
const audit = (await import('./src/services/audit.ts')).default
const actor = { user: { userId: owner.id, id: owner.id, companyId: co.id, email: owner.email } }

await audit.log({ action: 'create', entity: 'batch', entityId: 'bb-1', entityName: 'T41-LOT-ALPHA', req: actor })
await audit.log({ action: 'update', entity: 'batch', entityId: 'bb-1', entityName: 'T41-LOT-ALPHA', req: actor })
await audit.log({ action: 'status_change', entity: 'order', entityId: 'oo-1', entityName: 'ORD-9001', req: actor })
await audit.log({ action: 'delete', entity: 'product', entityId: 'pp-1', entityName: 'Retired Gummies', req: actor })

// A1 · the filter vocabulary comes from the data
{
  const got = await api('GET', '/api/audit/filters')
  check('A1: GET /api/audit/filters answers', got.status === 200, got.json)
  const actions = (got.json?.actions || []).map((a: any) => a.value)
  const entities = (got.json?.entities || []).map((e: any) => e.value)
  check('A1: the actions it offers are the ones really stored', actions.includes('create') && actions.includes('status_change'), actions)
  check('A1: the record types too', entities.includes('batch') && entities.includes('order'), entities)
  check('A1: and it never offers a composite the log cannot hold',
    !actions.some((a: string) => /^(order|product|customer|cash)_/.test(a)), actions)
}

// A1b · filtering by a real action narrows, and by the old invented one finds nothing
{
  const real = await api('GET', '/api/audit?action=create')
  const list = real.json?.data || []
  check('A1b: ?action=create returns rows', real.status === 200 && list.length > 0, { status: real.status, n: list.length })
  check('A1b: …and every one of them IS a create', list.every((r: any) => r.action === 'create'), list.map((r: any) => r.action))

  const invented = await api('GET', '/api/audit?action=product_updated')
  check('A1b: the old hard-coded value matches nothing — which is what emptied the screen',
    (invented.json?.data || []).length === 0, invented.json?.pagination)

  const byEntity = await api('GET', '/api/audit?entity=batch')
  const bl = byEntity.json?.data || []
  check('A1b: ?entity=batch narrows to the batch rows', bl.length >= 2 && bl.every((r: any) => r.entity === 'batch'), bl.length)
}

// A2 + A3 · the date range is read, and it includes its last day
{
  const today = new Date().toISOString().slice(0, 10)
  const sameDay = await api('GET', `/api/audit?startDate=${today}&endDate=${today}`)
  check('A3: From = To = today returns today’s rows, not nothing',
    (sameDay.json?.data || []).length > 0, { n: (sameDay.json?.data || []).length, today })

  // The spelling the screen used to send. Accepted as an alias now, so an older client still filters.
  const aliased = await api('GET', `/api/audit?dateFrom=${today}&dateTo=${today}`)
  check('A2: dateFrom/dateTo are honoured as aliases rather than ignored',
    (aliased.json?.data || []).length === (sameDay.json?.data || []).length,
    { aliased: (aliased.json?.data || []).length, canonical: (sameDay.json?.data || []).length })

  // A range that ended before anything happened must be empty — proving the bound is real and not
  // simply always-true, which an ignored filter would also look like.
  const past = await api('GET', '/api/audit?startDate=2020-01-01&endDate=2020-01-02')
  check('A2: a range with nothing in it really is empty', (past.json?.data || []).length === 0, past.json?.pagination)
}

// A4 · the search box searches
{
  const hit = await api('GET', '/api/audit?search=LOT-ALPHA')
  const list = hit.json?.data || []
  check('A4: search matches the record name', list.length >= 2 && list.every((r: any) => r.entityName === 'T41-LOT-ALPHA'),
    list.map((r: any) => r.entityName))

  const miss = await api('GET', '/api/audit?search=nothing-by-this-name')
  check('A4: …and a search with no match returns nothing, rather than everything',
    (miss.json?.data || []).length === 0, miss.json?.pagination)

  // A bare % used to mean "everything" because it reached ILIKE unescaped.
  const wild = await api('GET', '/api/audit?search=%25')
  check('A4: a literal % is searched for, not treated as a wildcard', (wild.json?.data || []).length === 0, wild.json?.pagination)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
