// crm-dispensary — T45 H24: online ordering.
//
// Order-ahead, the public menu site, curbside intake and the customer portal were all switched on
// as features, and /menu, /shop, /order and /portal every one of them rendered the in-app 404. The
// only way a customer order could be created was the in-store kiosk. The public API was complete;
// nothing in the product called it, and the only way IN to it was a slug the tenant's own page has
// no way to know.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Order Ahead Dispensary', slug: 'orderahead', email: 'oa@test.local', state: 'OH',
  purchaseLimitOz: '1', taxRate: '8.75', exciseTaxRate: '10',
  enabledFeatures: ['products', 'orders', 'order_ahead', 'public_menu'],
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Blue Dream', companyId: co.id, category: 'flower', price: '35',
  stockQuantity: 100, trackInventory: true, active: true, visible: true,
  weightGrams: '3.5', strainType: 'hybrid', thcPercent: '22.5',
} as any).returning()
const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '25',
  stockQuantity: 10, trackInventory: true, active: true, visible: true,
} as any).returning()
const [hidden] = await db.insert(product).values({
  name: 'Staff Only', companyId: co.id, category: 'flower', price: '1',
  stockQuantity: 5, trackInventory: true, active: true, visible: false,
} as any).returning()

const app = new Hono()
app.route('/api/public/menu', (await import('./src/routes/menu.ts')).default)

const pub = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}

// ── The menu, with no slug — which is all the tenant's own page can send ─────────────────────────
const menu = await pub('GET', '/api/public/menu')
check('H24: the menu loads with no slug, the way the shop\'s own page calls it', menu.status === 200, { status: menu.status, body: menu.json })
check('H24: ...and names the shop', menu.json?.company?.name === 'Order Ahead Dispensary', menu.json?.company)

const allProducts = (menu.json?.menu || []).flatMap((s: any) => s.products || [])
check('H24: it lists what is on sale', allProducts.length === 2, allProducts.map((p: any) => p.name))
check('H24: ...and leaves out what is not visible', !allProducts.some((p: any) => p.name === 'Staff Only'), allProducts.map((p: any) => p.name))
check('H24: ...with the price and potency a customer chooses on',
  allProducts.some((p: any) => p.name === 'Blue Dream' && p.price === '35' && p.thcPercent === '22.5'),
  allProducts.find((p: any) => p.name === 'Blue Dream'))

const withSlug = await pub('GET', '/api/public/menu?slug=orderahead')
check('H24: an explicit slug still works', withSlug.status === 200, { status: withSlug.status })

// A tenant that has been QA'd can carry a second company row. "Exactly one" was the first version
// of this rule and the live test tenant broke it, so its own page was still refused; the shop is
// the row the database was seeded with.
await db.insert(company).values({
  name: 'Leftover Import', slug: 'leftover', email: 'leftover@test.local', state: 'OH',
  enabledFeatures: ['products'],
} as any)
const stillResolves = await pub('GET', '/api/public/menu')
check('H24: a second company row does not break the shop own menu',
  stillResolves.status === 200 && stillResolves.json?.company?.name === 'Order Ahead Dispensary',
  { status: stillResolves.status, company: stillResolves.json?.company?.name })

const unknownSlug = await pub('GET', '/api/public/menu?slug=nope')
check('H24: an unknown slug is a 404, not this shop\'s menu', unknownSlug.status === 404, { status: unknownSlug.status })

// ── Placing an order ────────────────────────────────────────────────────────────────────────────
const order = await pub('POST', '/api/public/menu/order', {
  items: [{ productId: flower.id, quantity: 2 }, { productId: tee.id, quantity: 1 }],
  customerName: 'Ada Customer', customerPhone: '555-0100', customerEmail: 'ada@test.local', dateOfBirth: '1985-04-02',
  orderType: 'pickup', notes: 'ready after 5',
})
check('H24: a customer can place an order with no slug and no login', order.status === 201, { status: order.status, body: order.json })
check('H24: ...and is told what it came to', Number(order.json?.subtotal) === 95, order.json)
check('H24: ...with tax worked out at the shop\'s own rates',
  Number(order.json?.exciseTax) === 7 && Number(order.json?.salesTax) === 8.31,
  { excise: order.json?.exciseTax, sales: order.json?.salesTax })
check('H24: ...and an order number to collect against', !!order.json?.orderNumber, order.json?.orderNumber)

const stored = await db.execute(sql`SELECT status, type, customer_name FROM orders WHERE company_id = ${co.id}`)
const storedRows = (stored as any).rows || stored
check('H24: the order reached the shop\'s own order list', storedRows.length === 1 && storedRows[0].status === 'pending', storedRows[0])
check('H24: ...as a pickup, with the customer\'s name on it', storedRows[0]?.type === 'pickup' && storedRows[0]?.customer_name === 'Ada Customer', storedRows[0])

// The same refusals the register makes.
const overLimit = await pub('POST', '/api/public/menu/order', {
  items: [{ productId: flower.id, quantity: 50 }],
  customerName: 'Greedy', customerPhone: '555-0199', dateOfBirth: '1985-04-02', orderType: 'pickup',
})
check('H24: an order over the purchase limit is refused, just as at the counter', overLimit.status === 400, { status: overLimit.status, body: overLimit.json })

const noAddress = await pub('POST', '/api/public/menu/order', {
  items: [{ productId: tee.id, quantity: 1 }],
  customerName: 'Ada Customer', customerPhone: '555-0100', dateOfBirth: '1985-04-02', orderType: 'delivery',
})
check('H24: delivery with no address is refused', noAddress.status === 400, { status: noAddress.status, body: noAddress.json })

const invisible = await pub('POST', '/api/public/menu/order', {
  items: [{ productId: hidden.id, quantity: 1 }],
  customerName: 'Ada Customer', customerPhone: '555-0100', dateOfBirth: '1985-04-02', orderType: 'pickup',
})
check('H24: a product that is not on the menu cannot be ordered off it', invisible.status === 400, { status: invisible.status, body: invisible.json })

// ── The switch has to mean something on a public page too ───────────────────────────────────────
await db.execute(sql`UPDATE company SET enabled_features = ${JSON.stringify(['products', 'orders', 'public_menu'])}::jsonb WHERE id = ${co.id}`)
const switchedOff = await pub('POST', '/api/public/menu/order', {
  items: [{ productId: tee.id, quantity: 1 }],
  customerName: 'Ada Customer', customerPhone: '555-0100', dateOfBirth: '1985-04-02', orderType: 'pickup',
})
check('H24: with Order Ahead switched off, the public page cannot take an order', switchedOff.status === 403, { status: switchedOff.status, body: switchedOff.json })
check('H24: ...and says why', switchedOff.json?.feature === 'order_ahead', switchedOff.json)

const stillBrowsable = await pub('GET', '/api/public/menu')
check('H24: ...but the menu can still be browsed', stillBrowsable.status === 200, { status: stillBrowsable.status })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
