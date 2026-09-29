// crm-dispensary — T46 N18, N19, N22, N26.
//
// N18  The delivery board showed raw ids (#mhpqsx6q), "Unknown" customer and "0 items" — the rows
//      came back snake_case and the screen read camelCase — and the Queued, Cancelled and In Transit
//      filters returned nothing, because delivery_status is only written once a driver is assigned
//      and every other delivery had NULL there.
// N19  A grow room with Capacity, Target temp or Target humidity left blank could not be saved:
//      "capacity: Expected number, received null". A blank box sends null, and `.optional()` refuses
//      an explicit null.
// N22  Multiplier events could not be deleted from the address they are created at, and a 1000x
//      event saved without a murmur.
// N26  Receiving a purchase order could only confirm quantities. A supplier shipping at a different
//      price left the shop with a cost it had stopped paying, and a unitCost sent to the endpoint
//      was ignored. The product also carried two cost columns that could disagree.
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
  name: 'Twomiah Leaf', slug: 'leaf-m3', email: 'm3@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '15.0',
  enabledFeatures: ['products', 'orders', 'delivery', 'cultivation', 'loyalty', 'purchase_orders', 'contacts'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t46m3@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 40,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true, costPrice: '18', cost: null,
} as any).returning()
const [ada] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
  phone: '555-0101', address: '100 High St, Columbus, OH 43215',
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/delivery', (await import('./src/routes/delivery.ts')).default)
app.route('/api/cultivation', (await import('./src/routes/cultivation.ts')).default)
app.route('/api/gamified-loyalty', (await import('./src/routes/gamified-loyalty.ts')).default)
app.route('/api/purchase-orders', (await import('./src/routes/purchase-orders.ts')).default)

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
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ═══════════════════════════════════════════ N18 · the delivery board ═══════════════════════════
{
  const made = await asOwner('POST', '/api/orders', {
    type: 'delivery', contactId: ada.id, idVerified: true, paymentMethod: 'cash',
    deliveryAddress: '100 High St, Columbus, OH 43215',
    items: [{ productId: kush.id, quantity: 2 }],
  })
  check('N18: a delivery order is raised', made.status === 201, { status: made.status, body: made.json })

  const list = await asOwner('GET', '/api/delivery/orders')
  const row = (list.json?.data || []).find((d: any) => d.id === made.json.id)
  check('N18: it appears on the board', !!row, list.json)
  check('N18: …with its order number, not a raw id', Number(row?.orderNumber) > 0 && /^ORD-/.test(String(row?.number)), { orderNumber: row?.orderNumber, number: row?.number, id: row?.id })
  check('N18: …the customer\'s name, not "Unknown"', row?.customerName === 'Ada Customer', { customerName: row?.customerName })
  check('N18: …their phone number', row?.customerPhone === '555-0101', { customerPhone: row?.customerPhone })
  check('N18: …where it is going', /High St/.test(String(row?.deliveryAddress || row?.customerAddress)), { address: row?.deliveryAddress })
  check('N18: …and how many items are in it, not "0 items"', Number(row?.itemCount) === 2, { itemCount: row?.itemCount })

  // A delivery nobody has picked up yet is queued — it used to match no filter at all.
  const queued = await asOwner('GET', '/api/delivery/orders?status=queued')
  check('N18: the Queued filter finds it', (queued.json?.data || []).some((d: any) => d.id === made.json.id),
    { count: (queued.json?.data || []).length })
  check('N18: …and says so on the row', row?.deliveryStatus === 'pending', { deliveryStatus: row?.deliveryStatus })

  // Cancel it: the Cancelled tab has to find it.
  await db.execute(sql`UPDATE orders SET status = 'cancelled' WHERE id = ${made.json.id}`)
  const cancelled = await asOwner('GET', '/api/delivery/orders?status=cancelled')
  check('N18: the Cancelled filter finds a cancelled delivery', (cancelled.json?.data || []).some((d: any) => d.id === made.json.id),
    { count: (cancelled.json?.data || []).length })
  const stillQueued = await asOwner('GET', '/api/delivery/orders?status=queued')
  check('N18: …and it is no longer queued', !(stillQueued.json?.data || []).some((d: any) => d.id === made.json.id))
}

// ═══════════════════════════════════════ N19 · a blank box on a form ════════════════════════════
{
  const blank = await asManager('POST', '/api/cultivation/rooms', {
    name: 'T46 Veg Room', type: 'veg', capacity: null,
    environment: { targetTemp: null, targetHumidity: null, lightCycle: '18/6', co2Level: null },
  })
  check('N19: a room with the number boxes left blank saves', blank.status === 201 || blank.status === 200,
    { status: blank.status, body: blank.json })

  const withNumbers = await asManager('POST', '/api/cultivation/rooms', {
    name: 'T46 Flower Room', type: 'flower', capacity: 48,
    environment: { targetTemp: 78, targetHumidity: 55, lightCycle: '12/12' },
  })
  check('N19: …and one with them filled in still saves', withNumbers.status === 201 || withNumbers.status === 200,
    { status: withNumbers.status, body: withNumbers.json })

  const id = (blank.json?.id || blank.json?.data?.id)
  const edited = await asManager('PUT', `/api/cultivation/rooms/${id}`, { capacity: null, environment: { targetTemp: null } })
  check('N19: …and clearing them again on an edit is allowed too', edited.status === 200, { status: edited.status, body: edited.json })
}

// ═══════════════════════════════════ N22 · multiplier events ════════════════════════════════════
{
  const ok = await asManager('POST', '/api/gamified-loyalty/multiplier-events', { name: 'T46 3x', multiplier: 3 })
  check('N22: a 3x event saves', ok.status === 201, { status: ok.status, body: ok.json })

  const silly = await asManager('POST', '/api/gamified-loyalty/multiplier-events', { name: 'T46 1000x', multiplier: 1000 })
  check('N22: a 1000x event is refused', silly.status === 400, { status: silly.status, body: silly.json })
  check('N22: …and told why, as a typo rather than a rule number', /typo|10x/i.test(JSON.stringify(silly.json)), silly.json)

  const tenX = await asManager('POST', '/api/gamified-loyalty/multiplier-events', { name: 'T46 10x', multiplier: 10 })
  check('N22: …while a real 10x promotion is still allowed', tenX.status === 201, { status: tenX.status, body: tenX.json })

  const listed = await asOwner('GET', '/api/gamified-loyalty/multipliers')
  check('N22: both live events are listed', (Array.isArray(listed.json) ? listed.json : []).length === 2, listed.json)

  const gone = await asManager('DELETE', `/api/gamified-loyalty/multiplier-events/${ok.json.id}`)
  check('N22: an event can be deleted from the address it was created at — this used to be a 404',
    gone.status === 200, { status: gone.status, body: gone.json })

  const after = await asOwner('GET', '/api/gamified-loyalty/multipliers')
  check('N22: …and it leaves the shop\'s screen', !(Array.isArray(after.json) ? after.json : []).some((e: any) => e.id === ok.json.id), after.json)

  const twice = await asManager('DELETE', `/api/gamified-loyalty/multiplier-events/${ok.json.id}`)
  check('N22: deleting it again says so plainly', twice.status === 404, { status: twice.status })
}

// ═══════════════════════════════ N26 · receiving at the price actually paid ═════════════════════
{
  const po = await asManager('POST', '/api/purchase-orders', {
    supplierName: 'T46 Supplier',
    items: [{ productId: kush.id, name: 'OG Kush', quantity: 10, unitCost: 18 }],
  })
  check('N26: a purchase order is raised at $18', po.status === 201, { status: po.status, body: po.json })
  await asManager('PUT', `/api/purchase-orders/${po.json.id}/submit`)

  // The supplier actually shipped at $12.
  const received = await asManager('PUT', `/api/purchase-orders/${po.json.id}/receive`, {
    items: [{ itemIndex: 0, receivedQty: 10, unitCost: 12 }],
  })
  check('N26: it can be received at a different price', received.status === 200, { status: received.status, body: received.json })

  const [prod] = await rows(sql`SELECT stock_quantity, cost_price, cost FROM products WHERE id = ${kush.id}`)
  check('N26: the stock arrives', Number(prod?.stock_quantity) === 50, prod)
  check('N26: …and the cost is what was PAID, not what was ordered', Number(prod?.cost_price) === 12, prod)
  check('N26: …in both cost columns, so no margin can read the other one', Number(prod?.cost) === 12, prod)
}

{
  // A receipt that says nothing about price still takes the order's own figure, as before. (T45 L3)
  const [other] = await db.insert(product).values({
    name: 'Silent Cost', companyId: co.id, category: 'flower', price: '60', stockQuantity: 0,
    weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true, costPrice: '30',
  } as any).returning()
  const po = await asManager('POST', '/api/purchase-orders', {
    supplierName: 'T46 Supplier', items: [{ productId: other.id, name: 'Silent Cost', quantity: 4, unitCost: 25 }],
  })
  await asManager('PUT', `/api/purchase-orders/${po.json.id}/submit`)
  await asManager('PUT', `/api/purchase-orders/${po.json.id}/receive`, { items: [{ itemIndex: 0, receivedQty: 4 }] })
  const [prod] = await rows(sql`SELECT cost_price, cost FROM products WHERE id = ${other.id}`)
  check('N26: a receipt with no price takes the price on the order', Number(prod?.cost_price) === 25, prod)
  check('N26: …and still writes both columns', Number(prod?.cost) === 25, prod)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
