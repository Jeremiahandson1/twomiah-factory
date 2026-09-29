// crm-dispensary — T46 N1 (blocker): the offline queue was an unguarded way into the books.
//
// POST /api/offline/sync wrote each queued sale exactly as the device described it. It took the
// device's price, the device's quantity and the device's word on the customer, charged no tax, and
// needed nothing but a budtender login. The retest proved all of it on the live tenant:
//
//   · Blue Dream at $0.01 against a $35 list price
//   · 25 × 3.5 g in one basket — 87.5 g, against Ohio's 2.5 oz limit
//   · a sale to an 18-year-old with no medical card
//   · every one of them with $0 excise and $0 sales tax, counted as ordinary revenue
//   · and the same again from a budtender login
//
// The queue is replayed through the register's own routes now — POST /api/orders and
// POST /api/orders/:id/complete — so there is no second copy of the rules to drift. What is proven
// here is that each of those four cases now gets the answer the register would have given.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Leaf Offline', slug: 'leaf-off', email: 'off@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '10.0', purchaseLimitOz: '2.5',
  enabledFeatures: ['products', 'orders', 'offline_mode', 'pos'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t46off@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')

const [blueDream] = await db.insert(product).values({
  name: 'Blue Dream', sku: 'BD-OFF', companyId: co.id, category: 'flower', price: '35',
  weightGrams: '3.5', stockQuantity: 200, trackInventory: true, taxCategory: 'cannabis',
} as any).returning()

const adult = (await db.insert(contact).values({
  type: 'customer', name: 'T46 Adult', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning())[0]
// Born 2008 — eighteen, and no medical card on file. The exact customer the retest sold to.
const minor = (await db.insert(contact).values({
  type: 'customer', name: 'T46 NoCard18', companyId: co.id, dateOfBirth: '2008-03-01',
} as any).returning())[0]

const app = new Hono()
app.route('/api/offline', (await import('./src/routes/offline.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)
const asBudtender = as(budtender)

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stock = async () => Number((await rows(sql`SELECT stock_quantity FROM products WHERE id = ${blueDream.id}`))[0]?.stock_quantity)
const orderCount = async () => Number((await rows(sql`SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ${co.id}`))[0]?.n)

let clock = 0
/** One entry, shaped exactly as src/offline/queue.ts holds it. */
const held = (payload: any) => ({
  transactionType: 'order' as const,
  deviceId: 'till-t46',
  locationId: 'default',
  createdOfflineAt: new Date(Date.now() - (++clock) * 60_000).toISOString(),
  payload: { type: 'walk_in', status: 'completed', paymentMethod: 'cash', paymentStatus: 'paid', idVerified: true, notes: 'Rung up while offline', ...payload },
})

const startingStock = await stock()
check('setup — 200 eighths of Blue Dream at $35', startingStock === 200 && Number(blueDream.price) === 35, { startingStock })

// ── the penny sale ──────────────────────────────────────────────────────────────────────────────
{
  const before = await stock()
  const r = await asOwner('POST', '/api/offline/sync', {
    transactions: [held({
      contactId: adult.id, customerName: 'T46 Adult',
      subtotal: '0.01', exciseTax: '0', salesTax: '0', totalTax: '0', total: '0.01',
      items: [{ productId: blueDream.id, quantity: 1, unitPrice: '0.01' }],
    })],
  })
  check('N1: the queued sale is taken', r.json?.synced === 1, r.json)

  const [ord] = await rows(sql`SELECT number, subtotal, excise_tax, sales_tax, total FROM orders WHERE company_id = ${co.id} ORDER BY updated_at DESC LIMIT 1`)
  check('N1: …but priced from the catalogue, not from the device — $35, not $0.01',
    Number(ord?.subtotal) === 35, { subtotal: ord?.subtotal, want: 35 })
  check('N1: …excise is charged', Number(ord?.excise_tax) > 0, ord?.excise_tax)
  check('N1: …sales tax is charged', Number(ord?.sales_tax) > 0, ord?.sales_tax)
  check('N1: …and the total is the taxed catalogue price, not a penny',
    Number(ord?.total) > 35, { total: ord?.total })
  check('N1: the $0.01 the till took is reported back, so the drawer can be reconciled',
    r.json?.repriced?.[0]?.tookAtTill === '0.01' && Number(r.json?.repriced?.[0]?.chargedOnSync) > 35,
    r.json?.repriced)
  check('N1: …and the stock that actually left the shelf moved', (await stock()) === before - 1, { before, after: await stock() })
}

// ── the over-limit basket ───────────────────────────────────────────────────────────────────────
{
  const before = await stock()
  const orders = await orderCount()
  const r = await asOwner('POST', '/api/offline/sync', {
    transactions: [held({
      contactId: adult.id, customerName: 'T46 Adult',
      subtotal: '875.00', total: '875.00',
      items: [{ productId: blueDream.id, quantity: 25, unitPrice: '35' }],
    })],
  })
  check('N1: 87.5 g in one basket is refused — Ohio allows 2.5 oz', r.json?.synced === 0 && r.json?.failed === 1, r.json)
  check('N1: …and the refusal names the limit, in the register\'s own words',
    /limit|2\.5|oz/i.test(String(r.json?.refused?.[0]?.reason)), r.json?.refused)
  check('N1: …no order is raised', (await orderCount()) === orders, { before: orders, after: await orderCount() })
  check('N1: …and nothing left the shelf', (await stock()) === before, { before, after: await stock() })
}

// ── the eighteen-year-old ───────────────────────────────────────────────────────────────────────
{
  const before = await stock()
  const orders = await orderCount()
  const r = await asOwner('POST', '/api/offline/sync', {
    transactions: [held({
      contactId: minor.id, customerName: 'T46 NoCard18',
      subtotal: '35.00', total: '35.00',
      items: [{ productId: blueDream.id, quantity: 1, unitPrice: '35' }],
    })],
  })
  check('N1: a sale to an 18-year-old with no card is refused', r.json?.synced === 0 && r.json?.failed === 1, r.json)
  check('N1: …for the reason the register would have given',
    /21|age|old/i.test(String(r.json?.refused?.[0]?.reason)), r.json?.refused)
  check('N1: …no order, no stock movement',
    (await orderCount()) === orders && (await stock()) === before, { orders, stock: before })
}

// ── and the same from a budtender, which is all the retest needed ───────────────────────────────
{
  const before = await stock()
  const r = await asBudtender('POST', '/api/offline/sync', {
    transactions: [held({
      contactId: adult.id, customerName: 'T46 Adult',
      subtotal: '0.01', total: '0.01',
      items: [{ productId: blueDream.id, quantity: 1, unitPrice: '0.01' }],
    })],
  })
  const [ord] = await rows(sql`SELECT subtotal, total FROM orders WHERE company_id = ${co.id} ORDER BY updated_at DESC LIMIT 1`)
  check('N1: a budtender\'s till gets the catalogue price too', Number(ord?.subtotal) === 35, ord)
  check('N1: …and the tax with it', Number(ord?.total) > 35, ord?.total)
  check('N1: …and it is a normal sale, so the shelf moves', (await stock()) === before - 1, { before, after: await stock() })
  void r
}

{
  const r = await asBudtender('POST', '/api/offline/sync', {
    transactions: [held({
      contactId: minor.id, customerName: 'T46 NoCard18',
      total: '35.00', items: [{ productId: blueDream.id, quantity: 1, unitPrice: '35' }],
    })],
  })
  check('N1: a budtender cannot sell to a minor through the queue either', r.json?.failed === 1, r.json)
}

// ── what a manager sees afterwards ──────────────────────────────────────────────────────────────
{
  const q = await asManager('GET', '/api/offline/pending?status=failed')
  const list = Array.isArray(q.json) ? q.json : q.json?.data || []
  check('N1: every refused sale is waiting in the Offline queue for a manager', list.length === 3, { count: list.length })
  check('N1: …each with the reason it was refused, not "Unknown error"',
    list.every((t: any) => t.syncError && !/unknown/i.test(t.syncError)), list.map((t: any) => t.syncError))
}

// ── the sale still belongs to the moment it was rung up ─────────────────────────────────────────
{
  const rungUpAt = new Date(Date.now() - 3 * 3600_000).toISOString()
  await asOwner('POST', '/api/offline/sync', {
    transactions: [{
      transactionType: 'order', deviceId: 'till-t46b', locationId: 'default', createdOfflineAt: rungUpAt,
      payload: {
        type: 'walk_in', status: 'completed', paymentMethod: 'cash', idVerified: true,
        contactId: adult.id, total: '35.00',
        items: [{ productId: blueDream.id, quantity: 1, unitPrice: '35' }],
      },
    }],
  })
  const [ord] = await rows(sql`SELECT created_at, completed_at FROM orders WHERE company_id = ${co.id} ORDER BY updated_at DESC LIMIT 1`)
  const sameMinute = (a: any) => new Date(a).toISOString().slice(0, 16) === rungUpAt.slice(0, 16)
  check('N1: a sale rung up three hours ago is dated then, not at sync time',
    sameMinute(ord?.created_at) && sameMinute(ord?.completed_at), { created: ord?.created_at, completed: ord?.completed_at, rungUpAt })
}

// ── a sale the device never should have been able to invent ─────────────────────────────────────
{
  const orders = await orderCount()
  const r = await asOwner('POST', '/api/offline/sync', {
    transactions: [held({ contactId: adult.id, total: '0.00', items: [] })],
  })
  check('N1: a queued "sale" with no lines is refused rather than written', r.json?.failed === 1, r.json)
  check('N1: …and raises nothing', (await orderCount()) === orders)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
