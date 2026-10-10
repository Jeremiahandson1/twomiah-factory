// crm-store — three seats, owner, manager and staff, on every admin route. (Owner's decision, 2026-10-10)
//
// The store shipped with two roles and gated on rank: a few routes were requireOwner and the rest were
// open to anyone signed in. So staff could refund an order (and put its stock back), delete the
// catalogue and write discount codes, and there was no seat to hand the day-to-day to. It now runs the
// fleet's permission matrix (backend src/middleware/permissions.ts):
//
//   owner    payments, settings, logins, integrations — and everything below
//   manager  refunds and cancellations, discount codes, shipping set-up, deleting products, loyalty
//   staff    fulfil and ship paid orders, add and edit products, publish or reject reviews
//
// Every check below is the REAL route behind the REAL permissions module; only authenticate is bridged
// (x-test-user). A gate that refuses everybody fails here as loudly as one that refuses nobody, because
// each refusal is paired with the seat that must get through.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, products, productVariants, productReviews, discountCodes, shippingConfig } from './db/schema.ts'

process.env.PAYMENT_ENC_KEY ||= 'roles-test-key'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
await db.insert(storeSettings).values({ companyName: 'Three Seat Store', currency: 'usd' } as any)

const mk = async (role: string, name: string) => (await db.insert(users).values({
  email: `${name.toLowerCase()}@threeseat.test`, passwordHash: 'x', name, role,
} as any).returning())[0]
const owner = await mk('owner', 'Owner')
const manager = await mk('manager', 'Manager')
const staff = await mk('staff', 'Staff')

const [product] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 } as any).returning()

let n = 0
const order = async (status: string, extra: Record<string, unknown> = {}) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-S${n}`, provider: 'stripe', providerSessionId: `sess_s${n}`, status,
    customerEmail: `shopper${n}@example.com`, subtotalCents: 1500, shippingCents: 0, taxCents: 0,
    totalCents: 1500, currency: 'usd', ...extra,
  } as any).returning()
  const { orderItems } = await import('./db/schema.ts')
  await db.insert(orderItems).values({
    orderId: o.id, variantId: variant.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1',
    unitPriceCents: 1500, quantity: 2, lineTotalCents: 3000,
  } as any)
  return o
}
const stock = async () => (await db.select().from(productVariants).where(eq(productVariants.id, variant.id)))[0].inventoryQty

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/admin/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/admin/products', (await import('./src/routes/products.ts')).default)
app.route('/api/admin/discounts', (await import('./src/routes/discounts.ts')).default)
app.route('/api/admin/shipping', (await import('./src/routes/shipping.ts')).default)
app.route('/api/admin/reviews', (await import('./src/routes/reviews.ts')).default)
app.route('/api/admin/loyalty', (await import('./src/routes/loyalty.ts')).default)
app.route('/api/admin/payments', (await import('./src/routes/payments.ts')).default)
app.route('/api/admin/settings', (await import('./src/routes/settings.ts')).default)
app.route('/api/admin/users', (await import('./src/routes/users.ts')).default)
app.route('/api/admin/suppliers', (await import('./src/suppliers/routes.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), M = as(manager), S = as(staff)

// ── What the screens are told ────────────────────────────────────────────────────────────────────
const meO = await O('GET', '/api/auth/me'), meM = await M('GET', '/api/auth/me'), meS = await S('GET', '/api/auth/me')
check('me: the owner holds everything', Array.isArray(meO.json?.permissions) && meO.json.permissions.includes('*'), meO.json)
const pm: string[] = meM.json?.permissions || [], ps: string[] = meS.json?.permissions || []
check('me: the manager is told about refunds, discount codes, shipping set-up and loyalty',
  pm.includes('orders:*') && pm.includes('discounts:*') && pm.includes('shipping:*') && pm.includes('loyalty:configure'), pm)
check('me: the manager is NOT told payments, settings or logins',
  !pm.some((p) => /^(payments|settings|users|team|integrations):(\*|update|create)$/.test(p)), pm)
check('me: staff are told fulfilment, labels and product editing',
  ['orders:update', 'shipping:label', 'products:create', 'products:update', 'reviews:update'].every((p) => ps.includes(p)), ps)
check('me: staff are NOT told refunds, product deletes or discount writes',
  !ps.some((p) => ['orders:refund', 'orders:*', 'products:delete', 'products:*', 'discounts:create', 'discounts:*', 'reviews:delete'].includes(p)), ps)

// ── Orders: the floor moves paid orders on; the money is a manager's ─────────────────────────────
const paid = await order('paid')
check('orders: staff mark a paid order fulfilled', (await S('PATCH', `/api/admin/orders/${paid.id}/status`, { status: 'fulfilled' })).status === 200)
check('orders: staff mark it shipped', (await S('PATCH', `/api/admin/orders/${paid.id}/status`, { status: 'shipped' })).status === 200)
const before = await stock()
const staffRefund = await S('PATCH', `/api/admin/orders/${paid.id}/status`, { status: 'refunded' })
check('orders: staff CANNOT refund it', staffRefund.status === 403 && staffRefund.json?.required === 'orders:refund', staffRefund)
check('orders: ...and the refused refund put no stock back', (await stock()) === before, { before, after: await stock() })
const [stillShipped] = await db.select().from(orders).where(eq(orders.id, paid.id))
check('orders: ...and left the order shipped', stillShipped.status === 'shipped', stillShipped.status)
const mgrRefund = await M('PATCH', `/api/admin/orders/${paid.id}/status`, { status: 'refunded' })
check('orders: the manager refunds it', mgrRefund.status === 200, mgrRefund)
check('orders: ...and the two mugs go back on the shelf', (await stock()) === before + 2, { before, after: await stock() })

const unpaid = await order('pending')
check('orders: staff cannot ship an order nobody paid for',
  (await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'shipped' })).status === 403)
check('orders: ...nor by "Save & mark shipped"',
  (await S('PATCH', `/api/admin/orders/${unpaid.id}/fulfillment`, { trackingNumber: 'T1', markShipped: true })).status === 403)
check('orders: staff cannot mark it paid', (await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'paid' })).status === 403)
check('orders: staff can still write a note on it', (await S('PATCH', `/api/admin/orders/${unpaid.id}/fulfillment`, { internalNote: 'rang them' })).status === 200)
check('orders: the owner can mark it paid', (await O('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'paid' })).status === 200)
const cancelS = await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'cancelled' })
check('orders: staff cannot cancel', cancelS.status === 403, cancelS)
check('orders: the manager can', (await M('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'cancelled' })).status === 200)
check('orders: staff cannot revive a cancelled order onto the floor',
  (await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'shipped' })).status === 403)

// What it cost us, and what we took, follow the fleet's margin:read and revenue:read.
const dropship = await order('paid', { supplierCostCents: 600 })
const oS = await S('GET', `/api/admin/orders/${dropship.id}`), oM = await M('GET', `/api/admin/orders/${dropship.id}`)
check('orders: staff do not see the supplier cost', oS.status === 200 && !('supplierCostCents' in (oS.json?.order || {})), oS.json?.order)
check('orders: the manager does', oM.json?.order?.supplierCostCents === 600, oM.json?.order)
const listS = await S('GET', '/api/admin/orders')
check('orders: nor in the list', (listS.json?.orders || []).every((o: any) => !('supplierCostCents' in o)), listS.json?.orders?.[0])
const stS = await S('GET', '/api/admin/orders/stats'), stM = await M('GET', '/api/admin/orders/stats')
check('orders: staff see the queue but not the takings', stS.status === 200 && stS.json?.stats?.revenueCents === null && typeof stS.json?.stats?.pendingFulfillment === 'number', stS.json)
check('orders: the manager sees the takings', typeof stM.json?.stats?.revenueCents === 'number' && stM.json.stats.revenueCents > 0, stM.json)

// ── Products: staff build the catalogue; removing from sale is the manager's ─────────────────────
const created = await S('POST', '/api/admin/products', { name: 'Teapot' })
check('products: staff add a product', created.status === 201, created)
const teapot = created.json?.product
check('products: staff edit it', (await S('PATCH', `/api/admin/products/${teapot?.id}`, { tagline: 'Pours well' })).status === 200)
const v = await S('POST', `/api/admin/products/${teapot?.id}/variants`, { sku: 'POT-1', name: 'Default', priceCents: 3000 })
check('products: staff add a variant', v.status === 201, v)
check('products: staff change its stock', (await S('PATCH', `/api/admin/products/variants/${v.json?.variant?.id}`, { inventoryQty: 4 })).status === 200)
check('products: staff CANNOT delete the variant', (await S('DELETE', `/api/admin/products/variants/${v.json?.variant?.id}`)).status === 403)
check('products: staff CANNOT delete the product', (await S('DELETE', `/api/admin/products/${teapot?.id}`)).status === 403)
check('products: ...which is still there', (await db.select().from(products).where(eq(products.id, teapot?.id))).length === 1)
check('products: the manager deletes the variant', (await M('DELETE', `/api/admin/products/variants/${v.json?.variant?.id}`)).status === 200)
check('products: the manager deletes the product', (await M('DELETE', `/api/admin/products/${teapot?.id}`)).status === 200)

// ── Discount codes are money off ─────────────────────────────────────────────────────────────────
const [code] = await db.insert(discountCodes).values({ code: 'SAVE10', type: 'percent', value: 10 } as any).returning()
check('discounts: staff read the codes', (await S('GET', '/api/admin/discounts')).status === 200)
check('discounts: staff cannot create one', (await S('POST', '/api/admin/discounts', { code: 'FREE', type: 'percent', value: 100 })).status === 403)
check('discounts: staff cannot change one', (await S('PATCH', `/api/admin/discounts/${code.id}`, { value: 90 })).status === 403)
check('discounts: staff cannot delete one', (await S('DELETE', `/api/admin/discounts/${code.id}`)).status === 403)
const [codeAfter] = await db.select().from(discountCodes).where(eq(discountCodes.id, code.id))
check('discounts: ...and SAVE10 is still 10%', codeAfter?.value === 10, codeAfter)
check('discounts: the manager creates one', (await M('POST', '/api/admin/discounts', { code: 'SPRING', type: 'percent', value: 15 })).status === 201)
check('discounts: the manager changes one', (await M('PATCH', `/api/admin/discounts/${code.id}`, { value: 12 })).status === 200)
check('discounts: the manager deletes one', (await M('DELETE', `/api/admin/discounts/${code.id}`)).status === 200)

// ── Shipping: labels at the bench, the carrier account with the manager ──────────────────────────
const carrier = { provider: 'easypost', apiKey: 'EZTK_test_roles', mode: 'test', fromAddress: { line1: '1 Main St', city: 'Eau Claire', postalCode: '54701', country: 'US' } }
check('shipping: staff read the set-up', (await S('GET', '/api/admin/shipping/config')).status === 200)
// No carrier is connected yet, so the route answers 400 "No carrier account connected" — past the gate,
// and without calling a carrier. A 403 here would mean staff could not buy labels at all.
const ratesS = await S('GET', `/api/admin/shipping/orders/${dropship.id}/rates`)
check('shipping: staff get past the label gate', ratesS.status === 400, ratesS)
check('shipping: staff cannot connect a carrier account', (await S('POST', '/api/admin/shipping/config', carrier)).status === 403)
const conn = await M('POST', '/api/admin/shipping/config', carrier)
check('shipping: the manager connects one', conn.status === 200, conn)
check('shipping: staff cannot disconnect it', (await S('DELETE', '/api/admin/shipping/config')).status === 403)
check('shipping: ...it is still connected', (await db.select().from(shippingConfig))[0]?.connected === true)
check('shipping: the manager can', (await M('DELETE', '/api/admin/shipping/config')).status === 200)
const labelS = await S('POST', `/api/admin/shipping/orders/${unpaid.id}/label`, { markShipped: true })
check('shipping: no carrier → the label route says so before anything else', labelS.status === 400, labelS)

// ── Reviews: staff moderate; deleting one for good is the manager's ──────────────────────────────
const [rev] = await db.insert(productReviews).values({ productId: product.id, authorName: 'Ada', rating: 5 } as any).returning()
check('reviews: staff publish a review', (await S('PATCH', `/api/admin/reviews/${rev.id}`, { status: 'approved' })).status === 200)
check('reviews: staff cannot delete it', (await S('DELETE', `/api/admin/reviews/${rev.id}`)).status === 403)
check('reviews: the manager can', (await M('DELETE', `/api/admin/reviews/${rev.id}`)).status === 200)

// ── Loyalty: the manager runs the programme (staff refusals are loyalty-races-and-roles.test.ts) ─
check('loyalty: the manager changes the earn rate', (await M('PUT', '/api/admin/loyalty/config', { loyaltyPointsPerDollar: 2 })).status === 200)
const reward = await M('POST', '/api/admin/loyalty/rewards', { name: '$5 off', pointsCost: 100, type: 'fixed', valueCents: 500 })
check('loyalty: the manager adds a reward', reward.status === 201, reward)

// ── The owner's: payments, settings, logins, integrations ────────────────────────────────────────
// Refusals only for connect: the owner's 200 would call the payment provider, and a test must not.
check('payments: the manager cannot connect a processor', (await M('POST', '/api/admin/payments/connect', { provider: 'stripe', mode: 'test', secretKey: 'sk_test_x' })).status === 403)
check('payments: nor disconnect it', (await M('POST', '/api/admin/payments/disconnect')).status === 403)
check('payments: staff neither', (await S('POST', '/api/admin/payments/disconnect')).status === 403)
check('payments: everyone can read the status', (await S('GET', '/api/admin/payments')).status === 200)
check('settings: the manager cannot change store settings', (await M('PATCH', '/api/admin/settings', { companyName: 'Mine Now' })).status === 403)
check('settings: the owner can', (await O('PATCH', '/api/admin/settings', { companyName: 'Three Seat Store' })).status === 200)
check('suppliers: the manager is refused the supplier connection', (await M('GET', '/api/admin/suppliers')).status === 403)
check('suppliers: the owner reads it', (await O('GET', '/api/admin/suppliers')).status === 200)

check('users: the manager cannot see the logins', (await M('GET', '/api/admin/users')).status === 403)
check('users: the manager cannot add one', (await M('POST', '/api/admin/users', { email: 'x@threeseat.test', password: 'Password123', name: 'X' })).status === 403)
check('users: the manager cannot promote staff', (await M('PUT', `/api/admin/users/${staff.id}`, { role: 'manager' })).status === 403)
const newMgr = await O('POST', '/api/admin/users', { email: 'second@threeseat.test', password: 'Password123', name: 'Second', role: 'manager' })
check('users: the owner adds a manager', newMgr.status === 201 && newMgr.json?.role === 'manager', newMgr)
const noRole = await O('POST', '/api/admin/users', { email: 'third@threeseat.test', password: 'Password123', name: 'Third' })
check('users: a login with no role given is staff', noRole.status === 201 && noRole.json?.role === 'staff', noRole)
const secondOwner = await O('POST', '/api/admin/users', { email: 'fourth@threeseat.test', password: 'Password123', name: 'Fourth', role: 'owner' })
check('users: a second owner is not a button', secondOwner.status === 400, secondOwner)
const promote = await O('PUT', `/api/admin/users/${noRole.json?.id}`, { role: 'manager' })
check('users: the owner promotes staff to manager', promote.status === 200 && promote.json?.role === 'manager', promote)
check('users: ...and the new manager can refund straight away (the role is read per request)',
  (await as({ id: noRole.json?.id })('PATCH', `/api/admin/orders/${dropship.id}/status`, { status: 'refunded' })).status === 200)
check('users: the owner demotes them again', (await O('PUT', `/api/admin/users/${noRole.json?.id}`, { role: 'staff' })).json?.role === 'staff')
check("users: the owner's own role cannot be changed", (await O('PUT', `/api/admin/users/${owner.id}`, { role: 'staff' })).status === 400)
const [ownerAfter] = await db.select().from(users).where(eq(users.id, owner.id))
check('users: ...and is still owner', ownerAfter.role === 'owner', ownerAfter.role)
// Two separate rules, so they are tested apart: "nobody re-roles themselves" refuses the case above on its
// own. A co-owner (provisioned, never created from this screen) is what proves the owner seat is fixed.
const coOwner = await mk('owner', 'CoOwner')
const demote = await O('PUT', `/api/admin/users/${coOwner.id}`, { role: 'staff' })
check("users: another owner's seat cannot be changed either", demote.status === 400, demote)
const [coAfter] = await db.select().from(users).where(eq(users.id, coOwner.id))
check('users: ...and they are still owner', coAfter.role === 'owner', coAfter.role)
const selfMgr = await as({ id: newMgr.json?.id })
check('users: a manager cannot re-role themselves (refused at the door: team:update)', (await selfMgr('PUT', `/api/admin/users/${newMgr.json?.id}`, { role: 'staff' })).status === 403)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
