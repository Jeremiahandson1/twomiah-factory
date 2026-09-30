// crm-dispensary — T49 B1: a recalled product sold through order-ahead.
//
// The tester recalled batch T49-QU-1, was correctly refused at the register (`batch_not_sellable`),
// and then bought the same product anyway: it was still on the public menu, still on the kiosk menu,
// still recommended by the AI budtender ("Limited stock (4 available)"), a public order-ahead for it
// was accepted (201), and completing it at the till returned 200. Stock 5 → 4, no batch assigned,
// and the only batch with stock recalled.
//
// The rule was sixty lines written out INLINE in POST /api/orders and nowhere else. So it guarded
// one of the four doors a sale comes in through, and none of the three channels a product is offered
// through.
//
// THE RULE, which is what this file pins rather than the four paths:
//
//   Every way a sale is CREATED or COMPLETED asks whether the product can be sold, through the one
//   implementation in services/sellableStock.ts — and every way a product is OFFERED excludes a
//   recalled one.
//
//   created:   POST /api/orders · POST /api/public/menu/order · POST /api/kiosk/session/:t/checkout
//              (and add-item, before the basket is full)
//   completed: POST /api/orders/:id/complete
//   offered:   the public menu and product page, the kiosk menu, the AI budtender's product pool
//
// The complete step matters on its own: an order taken this morning and collected this afternoon can
// be an order for a lot recalled at lunchtime. That is the ordinary case for order-ahead.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'
import { resolveSellableStock, recalledProductIds } from './src/services/sellableStock.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t49b1', email: 'b1@test.local', state: 'OH',
  exciseTaxRate: '15', salesTaxRate: '0', purchaseLimitOz: '1',
  enabledFeatures: ['products', 'orders', 'batches', 'compliance', 'kiosk', 'order_ahead', 'ai_budtender'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t49b1@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning()

// The tester's shape: 5 on hand, one batch of 2, and the batch is the only tracked stock.
const [flower] = await db.insert(product).values({
  name: 'T49 Recall Flower', companyId: co.id, category: 'flower', price: '40', weightGrams: '3.5',
  stockQuantity: 5, active: true, visible: true, inStock: true, trackInventory: true, taxCategory: 'cannabis',
} as any).returning()
const [clean] = await db.insert(product).values({
  name: 'T49 Clean Flower', companyId: co.id, category: 'flower', price: '35', weightGrams: '3.5',
  stockQuantity: 20, active: true, visible: true, inStock: true, trackInventory: true, taxCategory: 'cannabis',
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/public/menu', (await import('./src/routes/menu.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const pub = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stockOf = async (id: string) => Number((await rows(sql`SELECT stock_quantity FROM products WHERE id = ${id}`))[0]?.stock_quantity)

// ── before the recall, everything works ─────────────────────────────────────────────────────────
let batchId = ''
{
  const [b] = await rows(sql`
    INSERT INTO batches(id, batch_number, product_id, initial_quantity, current_quantity, unit_of_measure, status, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'T49-QU-1', ${flower.id}, 2, 2, 'units', 'active', ${co.id}, NOW(), NOW())
    RETURNING id
  `)
  batchId = String(b.id)
  check('B1: the batch exists and is active', !!batchId)

  const ok = await api('POST', '/api/orders', {
    type: 'walk_in', contactId: cust.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: flower.id, quantity: 1 }],
  })
  check('B1: the register sells it while the batch is active', ok.status === 201, { status: ok.status, body: ok.json })
  if (ok.json?.id) await api('POST', `/api/orders/${ok.json.id}/complete`, { paymentMethod: 'cash' })
}

// ── now recall it ───────────────────────────────────────────────────────────────────────────────
await db.execute(sql`UPDATE batches SET status = 'recalled' WHERE id = ${batchId}`)
const stockAtRecall = await stockOf(flower.id)

// ── the rule, asked directly ────────────────────────────────────────────────────────────────────
{
  const products = new Map<string, any>([[flower.id, flower], [clean.id, clean]])
  const s = await resolveSellableStock(db, co.id, [flower.id, clean.id], products)
  check('B1: the shared rule blocks the recalled product', s.blockedProducts.get(flower.id) === 'recalled', [...s.blockedProducts])
  check('B1: …and leaves a product with no batches alone',
    !s.blockedProducts.has(clean.id) && !s.untrackedUnits.has(clean.id), { blocked: [...s.blockedProducts], untracked: [...s.untrackedUnits] })
  const recalled = await recalledProductIds(db, co.id, [flower.id, clean.id])
  check('B1: …and names it as un-offerable', recalled.has(flower.id) && !recalled.has(clean.id), [...recalled])
}

// ── door 1 · the register (this one already worked) ─────────────────────────────────────────────
{
  const r = await api('POST', '/api/orders', {
    type: 'walk_in', contactId: cust.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: flower.id, quantity: 1 }],
  })
  check('B1: door 1 — the register refuses', r.status === 400 && r.json?.code === 'batch_not_sellable', { status: r.status, body: r.json })
}

// ── door 2 · public order-ahead (the tester's route: 201, then completed) ───────────────────────
{
  const r = await pub('POST', '/api/public/menu/order', {
    companySlug: 'leaf-t49b1', orderType: 'pickup',
    customerName: 'Ada Customer', customerPhone: '555-0100', dateOfBirth: '1985-04-02',
    items: [{ productId: flower.id, quantity: 1 }],
  })
  check('B1: door 2 — order-ahead refuses, instead of accepting 201', r.status === 400, { status: r.status, body: r.json })
  check('B1: …with the same code the till uses', r.json?.code === 'batch_not_sellable', r.json)
  check('B1: …worded for a customer, not a budtender', /recalled/i.test(String(r.json?.error)) && /basket/i.test(String(r.json?.error)), r.json?.error)

  const clean2 = await pub('POST', '/api/public/menu/order', {
    companySlug: 'leaf-t49b1', orderType: 'pickup',
    customerName: 'Ada Customer', customerPhone: '555-0100', dateOfBirth: '1985-04-02',
    items: [{ productId: clean.id, quantity: 1 }],
  })
  check('B1: …while an unaffected product still orders fine', clean2.status === 201 || clean2.status === 200,
    { status: clean2.status, body: clean2.json })
}

// ── door 4 · COMPLETE, on an order taken before the recall ─────────────────────────────────────
//
// This is the step that let it out of the building. The order is created while the batch is active
// and completed after the recall, which is exactly what order-ahead does all day.
{
  await db.execute(sql`UPDATE batches SET status = 'active' WHERE id = ${batchId}`)
  const made = await api('POST', '/api/orders', {
    type: 'walk_in', contactId: cust.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: flower.id, quantity: 1 }],
  })
  check('B1: an order is taken while the batch is active', made.status === 201, { status: made.status, body: made.json })
  await db.execute(sql`UPDATE batches SET status = 'recalled' WHERE id = ${batchId}`)

  const before = await stockOf(flower.id)
  const done = await api('POST', `/api/orders/${made.json?.id}/complete`, { paymentMethod: 'cash' })
  check('B1: door 4 — completing it after the recall is REFUSED, not 200', done.status === 400, { status: done.status, body: done.json })
  check('B1: …and says the recall happened after the order was taken',
    /RECALLED since this order was taken/i.test(String(done.json?.error)), done.json?.error)
  check('B1: …and the stock did not move', (await stockOf(flower.id)) === before, { before, after: await stockOf(flower.id) })
  const [row] = await rows(sql`SELECT status FROM orders WHERE id = ${made.json?.id}`)
  check('B1: …and the order is still open for a manager to void', row?.status !== 'completed', row?.status)
}

// ── offered: the public menu and the product page ───────────────────────────────────────────────
{
  const menu = await pub('GET', '/api/public/menu?slug=leaf-t49b1')
  const listed = JSON.stringify(menu.json?.categories || menu.json || {})
  check('B1: the public menu answers', menu.status === 200, menu.status)
  check('B1: …and does not list the recalled product', !listed.includes(flower.id), 'recalled product id present')
  check('B1: …while still listing the clean one', listed.includes(clean.id), 'clean product missing')

  const page = await pub('GET', '/api/public/menu/t49-recall-flower?slug=leaf-t49b1')
  check('B1: …and its own product page is gone too, not just the listing', page.status === 404, { status: page.status, body: page.json })
}

// ── and the sale that DID happen before the recall is untouched ─────────────────────────────────
{
  check('B1: the legitimate sale from before the recall still stands', stockAtRecall === 4, stockAtRecall)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
