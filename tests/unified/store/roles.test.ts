// ADAPTED COPY of tests/store/roles.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// lines marked "unified:", where the unified build changed the schema, a reply's shape, the route the engine serves in
// the store's place (team: /api/company/users; the company's name: /api/company), or a behaviour the cutover ledger lists.
// The original keeps running against the template.
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
import { company, storeSettings, users, orders, products, productVariants, productReviews, discountCodes, shippingConfig } from './db/schema.ts' /* unified: the business is the company row (decision 1) */

process.env.PAYMENT_ENC_KEY ||= 'roles-test-key'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
await db.update(company).set({ name: 'Three Seat Store' } as any) /* unified: the shop's name is the company row's (decision 1) */
await db.insert(storeSettings).values({ currency: 'usd' } as any) /* unified: the commerce settings keep the currency */

const mk = async (role: string, name: string) => (await db.insert(users).values({
  email: `${name.toLowerCase()}@threeseat.test`, passwordHash: 'x', firstName: name, lastName: 'Seat', role,
} as any).returning())[0] /* unified: a user's first and last name, not name */
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
app.route('/api/company', (await import('./src/routes/company.ts')).default) /* unified: the store's /api/admin/users is the engine's team routes (/api/company/users), and the company's name is PUT /api/company */
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
check('orders: staff CANNOT refund it', staffRefund.status === 403 && staffRefund.json?.code === 'permission_denied' && /manager or the owner/.test(staffRefund.json?.error), staffRefund) /* unified: the refusal is { error, code } (rules.ts refundRefusal: code 'permission_denied', the sentence names who may — the template's `required` field is dropped, RULEBOOK §3) */
check('orders: ...and the refused refund put no stock back', (await stock()) === before, { before, after: await stock() })
const [stillShipped] = await db.select().from(orders).where(eq(orders.id, paid.id))
check('orders: ...and left the order shipped', stillShipped.status === 'shipped', stillShipped.status)
const mgrRefund = await M('PATCH', `/api/admin/orders/${paid.id}/status`, { status: 'refunded' })
check('orders: the manager refunds it', mgrRefund.status === 200, mgrRefund)
check('orders: ...and the two mugs go back on the shelf', (await stock()) === before + 2, { before, after: await stock() })

const unpaid = await order('pending')
// Store QA T1: shipping an unpaid order is not a move ANYONE may make now (409), not just one staff may not (403).
check('orders: staff cannot ship an order nobody paid for',
  (await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'shipped' })).status === 409)
check('orders: ...nor by "Save & mark shipped"',
  (await S('PATCH', `/api/admin/orders/${unpaid.id}/fulfillment`, { trackingNumber: 'T1', markShipped: true })).status === 409)
check('orders: staff cannot mark it paid', (await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'paid' })).status === 403)
check('orders: staff can still write a note on it', (await S('PATCH', `/api/admin/orders/${unpaid.id}/fulfillment`, { internalNote: 'rang them' })).status === 200)
check('orders: the owner can mark it paid', (await O('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'paid' })).status === 200)
const cancelS = await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'cancelled' })
check('orders: staff cannot cancel', cancelS.status === 403, cancelS)
check('orders: the manager can', (await M('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'cancelled' })).status === 200)
// A cancelled order is closed for everyone now (Store QA T1) — 409, and the owner cannot revive it either.
check('orders: staff cannot revive a cancelled order onto the floor',
  (await S('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'shipped' })).status === 409)
check('orders: ...nor can the owner', (await O('PATCH', `/api/admin/orders/${unpaid.id}/status`, { status: 'paid' })).status === 409)

// What it cost us, and what we took, follow the fleet's margin:read and revenue:read.
const dropship = await order('paid', { supplierCostCents: 600 })
const oS = await S('GET', `/api/admin/orders/${dropship.id}`), oM = await M('GET', `/api/admin/orders/${dropship.id}`)
check('orders: staff do not see the supplier cost', oS.status === 200 && !('supplierCostCents' in (oS.json || {})), oS.json) /* unified: one order is the record itself, not { order } */
check('orders: the manager does', oM.json?.supplierCostCents === 600, oM.json) /* unified: the record itself */
const listS = await S('GET', '/api/admin/orders')
check('orders: nor in the list', (listS.json?.data || []).length > 0 && (listS.json?.data || []).every((o: any) => !('supplierCostCents' in o)), listS.json?.data?.[0]) /* unified: a list is { data, pagination } (the length guard keeps the check from passing on a reply it could not read) */
const stS = await S('GET', '/api/admin/orders/stats'), stM = await M('GET', '/api/admin/orders/stats')
check('orders: staff see the queue but not the takings', stS.status === 200 && stS.json?.revenueCents === null && typeof stS.json?.pendingFulfillment === 'number', stS.json) /* unified: the stats are the record itself, not { stats } */
check('orders: the manager sees the takings', typeof stM.json?.revenueCents === 'number' && stM.json.revenueCents > 0, stM.json) /* unified: the record itself */

// ── Products: staff build the catalogue; removing from sale is the manager's ─────────────────────
const created = await S('POST', '/api/admin/products', { name: 'Teapot' })
check('products: staff add a product', created.status === 201, created)
const teapot = created.json /* unified: one product is the record itself, not { product } */
check('products: staff edit it', (await S('PATCH', `/api/admin/products/${teapot?.id}`, { tagline: 'Pours well' })).status === 200)
const v = await S('POST', `/api/admin/products/${teapot?.id}/variants`, { sku: 'POT-1', name: 'Default', priceCents: 3000 })
check('products: staff add a variant', v.status === 201, v)
/* unified: one variant is the record itself (v.json?.id, three lines; was v.json?.variant?.id) */
check('products: staff change its stock', (await S('PATCH', `/api/admin/products/variants/${v.json?.id}`, { inventoryQty: 4 })).status === 200)
check('products: staff CANNOT delete the variant', (await S('DELETE', `/api/admin/products/variants/${v.json?.id}`)).status === 403)
check('products: staff CANNOT delete the product', (await S('DELETE', `/api/admin/products/${teapot?.id}`)).status === 403)
check('products: ...which is still there', (await db.select().from(products).where(eq(products.id, teapot?.id))).length === 1)
check('products: the manager deletes the variant', (await M('DELETE', `/api/admin/products/variants/${v.json?.id}`)).status === 200)
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
check('payments: reading the payment account is the owner\'s too — staff and the manager are refused', (await S('GET', '/api/admin/payments')).status === 403 && (await M('GET', '/api/admin/payments')).status === 403) /* unified: ledger (the store's seats): "payments stay the owner's — reading the payment account too (the template's GET asked nothing)" */
check('payments: the owner reads the status', (await O('GET', '/api/admin/payments')).status === 200) /* unified: the seat that may still read it */
check('settings: the manager cannot change store settings', (await M('PATCH', '/api/admin/settings', { companyName: 'Mine Now' })).status === 403)
check('settings: the owner can', (await O('PUT', '/api/company', { name: 'Three Seat Store' })).status === 200) /* unified: the store's name is the company's — PUT /api/company { name } (catalog/settings.ts refuses companyName with code 'company_field') */
check('settings: …and the manager cannot change it there either', (await M('PUT', '/api/company', { name: 'Mine Now' })).status === 403) /* unified: the company row is the owner's door too (the manager's refusal above is on the store's settings) */
check('suppliers: the manager is refused the supplier connection', (await M('GET', '/api/admin/suppliers')).status === 403)
check('suppliers: the owner reads it', (await O('GET', '/api/admin/suppliers')).status === 200)

{
  const roster = await M('GET', '/api/company/users') /* unified: the engine's team list */
  const rows: any[] = Array.isArray(roster.json) ? roster.json : []
  check('users: the manager cannot see the logins', roster.status === 200 && rows.length >= 3 && rows.every((r) => !('email' in r) && !('lastLogin' in r) && !('extraPermissions' in r) && !('invitePending' in r)), roster.json) /* unified: the engine's team routes (ledger: the shared modules are the engine's) give a manager (team:read) the ROSTER every picker needs — id, name, role, active — and never the logins: no email, last sign-in, grants or invite state (packages/tenant-backend company.ts, T41); the template refused the whole list (403) */
}
check('users: the manager cannot add one', (await M('POST', '/api/company/users', { email: 'x@threeseat.test', password: 'Password123', firstName: 'X', lastName: 'X' })).status === 403) /* unified: the engine's team routes; first and last name */
check('users: the manager cannot promote staff', (await M('PUT', `/api/company/users/${staff.id}`, { role: 'manager' })).status === 403) /* unified: the engine's team routes */
const newMgr = await O('POST', '/api/company/users', { email: 'second@threeseat.test', password: 'Password123', firstName: 'Second', lastName: 'Seat', role: 'manager' }) /* unified: the engine's team routes; first and last name */
check('users: the owner adds a manager', newMgr.status === 201 && newMgr.json?.role === 'manager', newMgr)
const noRole = await O('POST', '/api/company/users', { email: 'third@threeseat.test', password: 'Password123', firstName: 'Third', lastName: 'Seat' }) /* unified: the engine's team routes; first and last name */
check('users: a login with no role given is staff', noRole.status === 201 && noRole.json?.role === 'field', noRole) /* unified: the store's staff seat is stored as the shared `field` rung (verticals/store/settings.ts roleMapping staff → field; the cutover keeps moved rows' 'staff', read as field) */
const secondOwner = await O('POST', '/api/company/users', { email: 'fourth@threeseat.test', password: 'Password123', firstName: 'Fourth', lastName: 'Seat', role: 'owner' }) /* unified: the engine's team routes; first and last name */
check('users: a second owner is not a button', secondOwner.status === 400, secondOwner)
const promote = await O('PUT', `/api/company/users/${noRole.json?.id}`, { role: 'manager' }) /* unified: the engine's team routes */
check('users: the owner promotes staff to manager', promote.status === 200 && promote.json?.role === 'manager', promote)
check('users: ...and the new manager can refund straight away (the role is read per request)',
  (await as({ id: noRole.json?.id })('PATCH', `/api/admin/orders/${dropship.id}/status`, { status: 'refunded' })).status === 200)
check('users: the owner demotes them again', (await O('PUT', `/api/company/users/${noRole.json?.id}`, { role: 'field' })).json?.role === 'field') /* unified: the engine's team routes; staff is the `field` rung */
check("users: the owner's own role cannot be changed", (await O('PUT', `/api/company/users/${owner.id}`, { role: 'field' })).status === 400) /* unified: the engine's team routes; staff is `field` */
const [ownerAfter] = await db.select().from(users).where(eq(users.id, owner.id))
check('users: ...and is still owner', ownerAfter.role === 'owner', ownerAfter.role)
// Two separate rules, so they are tested apart: "nobody re-roles themselves" refuses the case above on its
// own. A co-owner (provisioned, never created from this screen) is what proves the owner seat is fixed.
const coOwner = await mk('owner', 'CoOwner')
const demote = await O('PUT', `/api/company/users/${coOwner.id}`, { role: 'field' }) /* unified: the engine's team routes; staff is `field` */
check("users: another owner's seat cannot be changed either", demote.status === 400, demote)
const [coAfter] = await db.select().from(users).where(eq(users.id, coOwner.id))
check('users: ...and they are still owner', coAfter.role === 'owner', coAfter.role)
const selfMgr = await as({ id: newMgr.json?.id })
check('users: a manager cannot re-role themselves (refused at the door: team:update)', (await selfMgr('PUT', `/api/company/users/${newMgr.json?.id}`, { role: 'field' })).status === 403) /* unified: the engine's team routes; staff is `field` */

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
