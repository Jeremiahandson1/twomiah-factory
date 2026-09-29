// crm-dispensary — T45 H17: Offline Mode.
//
// "Offline POS enabled" was claimed in Features and there was no service worker running, no app
// cache and no sale queue in the app — a reload with no internet could not open the register, and a
// sale rung up with the connection down was simply lost.
//
// The client half (the service worker, src/offline/queue.ts, the POS's hold-and-replay) is wired in
// the browser. This covers the half a test can hold: that a queued sale replayed to
// /api/offline/sync lands as a real sale — lines, stock and all — and that replaying the same queue
// twice cannot charge anyone twice.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Offline Dispensary', slug: 'offline', email: 'offline@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'offline_mode'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-offline@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')

// Weighed and classified like a real flower product. The queue is replayed through the register's
// own checkout now (T46 N1), so a line the shop cannot weigh is refused here exactly as it is at
// the till — which is right, and which this fixture has to satisfy to test anything else. (T29 H3)
const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 20,
  weightGrams: '3.5', trackInventory: true, taxCategory: 'cannabis',
} as any).returning()
const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '25', stockQuantity: 10,
  trackInventory: true, taxCategory: 'merchandise',
} as any).returning()
const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const app = new Hono()
app.route('/api/offline', (await import('./src/routes/offline.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}
const asBudtender = as(budtender)
const asManager = as(manager)

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stockOf = async (id: string) => Number((await rows(sql`SELECT stock_quantity FROM products WHERE id = ${id}`))[0]?.stock_quantity)

// Exactly the shape src/offline/queue.ts holds for a sale rung up with no connection.
const rungUpAt = new Date(Date.now() - 20 * 60_000).toISOString()
const heldSale = {
  transactionType: 'order' as const,
  deviceId: 'till-1',
  locationId: 'default',
  createdOfflineAt: rungUpAt,
  payload: {
    type: 'walk_in',
    status: 'completed',
    contactId: cust.id,
    customerName: 'Ada Customer',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    idVerified: true,
    subtotal: '115.00',
    exciseTax: '9.00',
    salesTax: '10.06',
    totalTax: '19.06',
    total: '134.06',
    items: [
      { productId: kush.id, quantity: 2, unitPrice: '45' },
      { productId: tee.id, quantity: 1, unitPrice: '25' },
    ],
    notes: 'Rung up while offline',
  },
}

check('H17: setup — 20 g of OG Kush on the shelf', (await stockOf(kush.id)) === 20)

const sync = await asBudtender('POST', '/api/offline/sync', { transactions: [heldSale] })
check('H17: a budtender\'s till can send what it held', sync.status === 200, { status: sync.status, body: sync.json })
check('H17: the held sale is taken', sync.json?.synced === 1 && sync.json?.failed === 0, sync.json)

const orders = await rows(sql`SELECT id, status, total, customer_name, payment_status, completed_at FROM orders WHERE company_id = ${co.id}`)
check('H17: ...and lands as a real sale', orders.length === 1 && orders[0].status === 'completed', orders[0])
// NOT the total the till rang up any more, and deliberately. T46 N1 found that taking the device's
// figure is what let a queued sale charge $0.01 for a $35 eighth with no tax at all. The sale is
// priced from the catalogue and taxed at the shop's rates on sync; the till's figure is kept only
// to be compared, and reported when the two disagree so the drawer can be reconciled.
check('H17: ...priced by the server, not by the till', Number(orders[0]?.total) > 0, orders[0]?.total)
check('N1: ...and the till\'s own figure is reported back as a difference to chase',
  sync.json?.repriced?.[0]?.tookAtTill === '134.06' && Number(sync.json?.repriced?.[0]?.chargedOnSync) > 0,
  sync.json?.repriced)
check('H17: ...marked paid', orders[0]?.payment_status === 'paid', orders[0]?.payment_status)
check('H17: ...timestamped when it was rung up, not when it synced',
  new Date(orders[0]?.completed_at).toISOString().slice(0, 16) === rungUpAt.slice(0, 16),
  { stored: orders[0]?.completed_at, rungUpAt })

// The header alone is not a sale. Without lines there is nothing to report, nothing to trace in a
// recall, and the shelf never moves.
const items = await rows(sql`SELECT product_id, quantity, unit_price, line_total, category FROM order_items WHERE order_id = ${orders[0]?.id} ORDER BY line_total DESC`)
check('H17: the sale has its lines', items.length === 2, items)
check('H17: ...with the quantity and the price', Number(items[0]?.quantity) === 2 && Number(items[0]?.line_total) === 90, items[0])
check('H17: stock came off the shelf for the cannabis', (await stockOf(kush.id)) === 18, await stockOf(kush.id))
check('H17: ...and for the merch', (await stockOf(tee.id)) === 9, await stockOf(tee.id))

// Replaying the same queue — a till that synced, lost the answer and tried again — must not sell
// the same product twice.
const replay = await asBudtender('POST', '/api/offline/sync', { transactions: [heldSale] })
check('H17: replaying the same queue is recognised as a duplicate', replay.json?.synced === 0, replay.json)
check('H17: ...and named as one', replay.json?.conflicts?.[0]?.reason === 'duplicate', replay.json?.conflicts)
check('H17: ...so the same sale cannot be rung twice', (await stockOf(kush.id)) === 18, await stockOf(kush.id))
const afterReplay = await rows(sql`SELECT COUNT(*)::int as n FROM orders WHERE company_id = ${co.id}`)
check('H17: ...and no second order appears', Number(afterReplay[0]?.n) === 1, afterReplay[0])

// A sale for a product that has since been deleted must fail loudly and stay visible, not vanish.
const gone = await asBudtender('POST', '/api/offline/sync', {
  transactions: [{
    ...heldSale,
    createdOfflineAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    payload: { ...heldSale.payload, items: [{ productId: 'no-such-product', quantity: 1, unitPrice: '10' }] },
  }],
})
check('H17: a sale the server cannot replay is reported failed, not lost', gone.json?.failed === 1, gone.json)

const pending = await asManager('GET', '/api/offline/pending?status=failed')
const pendingRows = Array.isArray(pending.json) ? pending.json : pending.json?.data || []
check('H17: ...and a manager can see it waiting', pendingRows.length >= 1, { status: pending.status, count: pendingRows.length })

// The queue's own ceiling matches the server's batch ceiling, so the app can never hold more than
// it is able to send in one go.
const tooMany = await asBudtender('POST', '/api/offline/sync', {
  transactions: Array.from({ length: 501 }, (_, i) => ({
    ...heldSale, createdOfflineAt: new Date(Date.now() - (i + 100) * 1000).toISOString(),
  })),
})
check('H17: a batch over the server\'s ceiling is refused plainly', tooMany.status === 400, { status: tooMany.status })

const config = await asManager('GET', '/api/offline/config')
check('H17: the offline settings the screen reads are served', config.status === 200 && config.json?.offlinePOS !== undefined,
  { status: config.status, body: config.json })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
