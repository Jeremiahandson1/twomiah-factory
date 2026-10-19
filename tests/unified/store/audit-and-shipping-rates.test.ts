// ADAPTED COPY of tests/store/audit-and-shipping-rates.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except
// the lines marked "unified:", each saying what the unified build changed and why. The original keeps running against
// the template.
// crm-store — the audit log, and shipping rates for the manager. (Owner, 10/12, after the T3 manager pass:
// "split shipping rates out and check the audit log.")
//
//   AUDIT. The store had none. A manager here refunds, cancels, writes discount codes and recounts stock; the owner
//   could not see who did which. Now every successful write leaves a row (the fleet's shared floor, wired tenantless),
//   and the money and access events write their own, richer one — what the order went from and to and what it was
//   worth, the code's value, the count before and after, sign-ins. Read by the owner alone (audit:read).
//   SHIPPING RATES. A manager connected the carrier account and was refused the rates it bills against: the settings
//   PATCH asked settings:update for every field. Now it asks per field — shipping fields shipping:configure, the
//   rest settings:update — and refuses a mixed save whole, naming the field, with nothing saved.
//   ALSO FOUND: the paging guard in index.ts had lost its backslash (/^d+$/), so every ?page= or ?limit= was refused —
//   live, the owner's Email inbox (?limit=100) could not load.
//
// Through the real routes, the real permissions module, the real floor and audit service; authenticate is the
// harness's x-test-user bridge. Sign-in is the real route with a real bcrypt hash.
process.env.JWT_SECRET ||= 'audit-test-secret'
process.env.JWT_REFRESH_SECRET ||= 'audit-test-refresh'
process.env.PAYMENT_ENC_KEY ||= 'audit-test-key'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, orderItems, products, productVariants, auditLog, company } from './db/schema.ts' /* unified: the shop's name and loyalty rules are the company row's */

const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()
await db.insert(storeSettings).values({ currency: 'usd', flatShippingCents: 500, taxRateBps: 500 } as any) /* unified: companyName and loyalty are the company row's, below */
await db.update(company).set({ name: 'Ledger Store', settings: { loyalty: { enabled: true, pointsPerDollar: 1 } } } as any) /* unified: the shop's name is company.name and the loyalty rules company.settings.loyalty */
const hash = await Bun.password.hash('Correct-Horse-1', 'bcrypt')
const mkUser = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@ledger.test`, passwordHash: hash, firstName: name, lastName: 'Tester', role } as any) /* unified: a user's name is first and last */.returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('staff', 'staff')

const { requestScope } = await import('./src/services/audit.ts')
const { writeAudit } = await import('./src/middleware/writeAudit.ts')
const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.use('*', writeAudit)
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/admin/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/admin/products', (await import('./src/routes/products.ts')).default)
app.route('/api/admin/settings', (await import('./src/routes/settings.ts')).default)
app.route('/api/admin/discounts', (await import('./src/routes/discounts.ts')).default)
app.route('/api/admin/loyalty', (await import('./src/routes/loyalty.ts')).default)
app.route('/api/admin/users', (await import('./src/routes/users.ts')).default)
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.route('/api/audit', (await import('./src/routes/audit.ts')).default)
const { permissionForField, describeSettings } = await import('../../server/crm/store/catalog/settings.ts') /* unified: the settings route moved to server/crm/store/catalog/settings.ts (the sandbox sits in apps/unified/.suite) */

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'ledger-test', ...(who ? { 'x-test-user': who.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), M = as(manager), S = as(staff), ANON = as(null)
const rows = async () => db.select().from(auditLog)
const since = async (n: number) => (await db.select().from(auditLog)).sort((a, b) => +a.createdAt - +b.createdAt).slice(n)
const settingsNow = async () => (await db.select().from(storeSettings))[0] as any
const companyName = async () => (await db.select({ name: company.name }).from(company))[0]?.name /* unified: the shop's name is company.name, not store_settings.companyName */

// ── shipping rates: the manager's; store and tax: the owner's ──────────────────────────────────────
check('rule: shipping fields ask shipping:configure, everything else settings:update',
  ['flatShippingCents', 'freeShippingThresholdCents', 'shippingZones'].every((k) => permissionForField(k) === 'shipping:configure')
  && ['companyName', 'supportEmail', 'currency', 'taxRateBps', 'taxRates', 'storefrontOrigin'].every((k) => permissionForField(k) === 'settings:update'))
{
  const zones = [{ name: 'Domestic', countries: ['US'], states: [], rateCents: 700, freeThresholdCents: 5000 }]
  const r = await M('PATCH', '/api/admin/settings', { flatShippingCents: 600, freeShippingThresholdCents: 7500, shippingZones: zones })
  const s = await settingsNow()
  check(`shipping: the manager saves the flat rate, the free-shipping line and a zone (${r.status})`, r.status === 200 && s.flatShippingCents === 600 && s.freeShippingThresholdCents === 7500 && s.shippingZones?.[0]?.name === 'Domestic', r.json)
  const tax = await M('PATCH', '/api/admin/settings', { taxRateBps: 900 })
  check(`shipping: …but not the tax rate (403 settings_field_refused, names taxRateBps — ${tax.status})`, tax.status === 403 && tax.json?.code === 'settings_field_refused' && JSON.stringify(Object.keys(tax.json?.fields || {})) === '["taxRateBps"]' && (await settingsNow()).taxRateBps === 500, tax.json) /* unified: an error's `fields` is the rulebook's map, field → message (RULEBOOK §3), not a list — its keys are the fields named */
  const mixed = await M('PATCH', '/api/admin/settings', { flatShippingCents: 650, companyName: 'Mine Now' })
  const after = await settingsNow()
  check('shipping: a save mixing a shipping field with an owner\'s one is refused whole — the shipping field is not saved either', mixed.status === 403 && after.flatShippingCents === 600 && (await companyName()) === 'Ledger Store', { mixed: mixed.json, after: { flat: after.flatShippingCents, name: await companyName() } }) /* unified: the shop's name is company.name */
  // Who may set a field is asked before whether the value is valid (T3 retest: a bad tax value got 400, a good one 403).
  const badTax = await M('PATCH', '/api/admin/settings', { taxRateBps: 'lots', currency: 'dollars' })
  check(`shipping: an owner's field is refused for who is asking, whatever value was sent (403, not 400 — ${badTax.status})`, badTax.status === 403 && badTax.json?.code === 'settings_field_refused' && JSON.stringify(Object.keys(badTax.json?.fields || {})) === '["taxRateBps","currency"]', badTax.json) /* unified: an error's `fields` is the rulebook's map, field → message (RULEBOOK §3), not a list — its keys are the fields named */
  const badShip = await M('PATCH', '/api/admin/settings', { flatShippingCents: -5 })
  check(`shipping: …while a bad value in a field the manager may set is still 400 (${badShip.status})`, badShip.status === 400 && (await settingsNow()).flatShippingCents === 600, badShip.json)
  const st = await S('PATCH', '/api/admin/settings', { flatShippingCents: 1 })
  check(`shipping: staff change no rates (${st.status})`, st.status === 403 && (await settingsNow()).flatShippingCents === 600, st.json)
  const own = await O('PATCH', '/api/admin/settings', { taxRateBps: 550, flatShippingCents: 500 })
  check('shipping: the owner still changes both in one save', own.status === 200 && (await settingsNow()).taxRateBps === 550 && (await settingsNow()).flatShippingCents === 500, own.json)
}

// ── every row says who, from where ─────────────────────────────────────────────────────────────────
{
  const all = await rows()
  const mgrShip = all.find((r) => r.entity === 'store_settings' && r.userId === manager.id)
  check('audit: the manager\'s shipping save is one row, naming them, the address the first proxy saw, and the browser', !!mgrShip && mgrShip.userEmail === 'manager@ledger.test' && mgrShip.ipAddress === '203.0.113.7' && mgrShip.userAgent === 'ledger-test' && all.filter((r) => r.userId === manager.id && r.entity === 'store_settings').length === 1, mgrShip)
  check(`audit: …in words a reader follows ("${(mgrShip?.metadata as any)?.description}")`, /Flat shipping \$5\.00 → \$6\.00/.test((mgrShip?.metadata as any)?.description) && /Free shipping over never → \$75\.00/.test((mgrShip?.metadata as any)?.description) && /Shipping zones edited \(0 zones → 1 zone\)/.test((mgrShip?.metadata as any)?.description))
  check('audit: refused saves leave no row (three 403s above, none recorded)', all.filter((r) => r.entity === 'store_settings').length === 2, all.filter((r) => r.entity === 'store_settings').map((r) => r.userEmail))
  const ownRow = all.find((r) => r.entity === 'store_settings' && r.userId === owner.id)
  check(`audit: the owner's tax change reads "Tax 5% → 5.5%" ("${(ownRow?.metadata as any)?.description}")`, /Tax 5% → 5\.5%/.test((ownRow?.metadata as any)?.description))
  check('audit: a save with no change says so', describeSettings(null) === 'Saved with no change')
}

// ── a refund: who, what it was worth, what came back ──────────────────────────────────────────────
const [product] = await db.insert(products).values({ slug: 'mug', name: 'Mug', status: 'active' } as any).returning()
const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 } as any).returning()
let n = 0
const mkOrder = async (status: string) => {
  n++
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-L${n}`, provider: 'stripe', providerSessionId: `sess_l${n}`, status,
    customerEmail: `shopper${n}@example.com`, subtotalCents: 3000, shippingCents: 0, taxCents: 0, totalCents: 3000, currency: 'usd',
  } as any).returning()
  await db.insert(orderItems).values({ orderId: o.id, variantId: variant.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1', unitPriceCents: 1500, quantity: 2, lineTotalCents: 3000 } as any)
  return o
}
{
  const o = await mkOrder('paid')
  const before = (await rows()).length
  const r = await M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
  const added = await since(before)
  const row = added[0]
  check(`refund: one row for the request (the floor stood aside — ${added.length})`, r.status === 200 && added.length === 1, added)
  check('refund: status_change on the order, by number, by the manager', row?.action === 'status_change' && row?.entity === 'order' && row?.entityId === o.id && row?.entityName === 'ORD-L1' && row?.userId === manager.id, row)
  check(`refund: says what it was worth and what came back ("${(row?.metadata as any)?.description}")`, (row?.metadata as any)?.description === 'Refunded — $30.00, recorded only — no money sent back here, 2 units back in stock' && (row?.changes as any)?.status?.old === 'paid' && (row?.changes as any)?.status?.new === 'refunded' && Object.keys(row?.changes as any).length === 1, row?.changes)
  // A second press on an order already refunded is a no-op — and leaves no row (live, 10/12: it read as a 2nd refund).
  const noop = await M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
  check('refund: pressing it again on a refunded order changes nothing and writes no audit row', noop.status === 200 && (await rows()).length === before + 1, { status: noop.status, added: (await rows()).length - before })
  const refused = await S('PATCH', `/api/admin/orders/${(await mkOrder('paid')).id}/status`, { status: 'cancelled' })
  check('refund: staff\'s refused cancel leaves no row', refused.status === 403 && (await rows()).length === before + 1, refused.json)
  const t = await S('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { internalNote: 'customer kept the box' })
  const tRow = (await since(before + 1))[0]
  check('fulfilment: a note saved by staff is a row with the change itself', t.status === 200 && tRow?.entity === 'order' && (tRow?.changes as any)?.internalNote?.new === 'customer kept the box' && tRow?.userId === staff.id, tRow)
}

// ── discount codes: giving money away, by whom, how much ───────────────────────────────────────────
{
  const before = (await rows()).length
  const c1 = await M('POST', '/api/admin/discounts', { code: 'SPRING15', type: 'percent', value: 15 })
  const c2 = await M('POST', '/api/admin/discounts', { code: 'FIVER', type: 'fixed', value: 500 })
  const up = await M('PATCH', `/api/admin/discounts/${c1.json?.id}`, { value: 100 }) /* unified: one record is the record itself (RULEBOOK §3), not wrapped ({ code } / { product } / { variant }) */
  const del = await M('DELETE', `/api/admin/discounts/${c2.json?.id}`) /* unified: one record is the record itself (RULEBOOK §3), not wrapped ({ code } / { product } / { variant }) */
  const added = await since(before)
  const say = added.map((r) => [r.action, r.entityName, (r.metadata as any)?.description ?? JSON.stringify(r.changes)])
  check('discounts: four writes, four rows, each naming the code', added.length === 4 && added.every((r) => r.entity === 'discount_code' && r.userId === manager.id), say)
  check('discounts: a new code says what it gives away', say[0]?.[2] === 'Code SPRING15 created — 15% off' && say[1]?.[2] === 'Code FIVER created — $5.00 off', say)
  check('discounts: raising a code to 100% off shows 15 → 100', (added[2]?.changes as any)?.value?.old === 15 && (added[2]?.changes as any)?.value?.new === 100, added[2]?.changes)
  check('discounts: a deleted code is named, with what it was', say[3]?.[0] === 'delete' && say[3]?.[2] === 'Code FIVER deleted — it was $5.00 off, used 0 times', say[3])
  check('discounts: staff\'s refused create leaves no row', (await S('POST', '/api/admin/discounts', { code: 'FREE', type: 'percent', value: 100 })).status === 403 && (await rows()).length === before + 4)
}

// ── stock and price: before and after ──────────────────────────────────────────────────────────────
{
  const before = (await rows()).length
  const now = (await db.select().from(productVariants).where(eq(productVariants.id, variant.id)))[0].inventoryQty
  await S('PATCH', `/api/admin/products/variants/${variant.id}`, { inventoryQty: 40, inventoryFrom: now })
  await S('PATCH', `/api/admin/products/variants/${variant.id}`, { priceCents: 1800 })
  const [count, price] = await since(before)
  check(`stock: a recount is logged ${now} → 40, against the variant's SKU, by staff`, count?.entity === 'product_variant' && count?.entityName === 'MUG-1' && (count?.changes as any)?.inventoryQty?.old === now && (count?.changes as any)?.inventoryQty?.new === 40 && count?.userId === staff.id, count)
  check('stock: a price change is logged 1500 → 1800 and touches nothing else', (price?.changes as any)?.priceCents?.old === 1500 && (price?.changes as any)?.priceCents?.new === 1800 && Object.keys(price?.changes as any).length === 1, price?.changes)
  const stale = await S('PATCH', `/api/admin/products/variants/${variant.id}`, { inventoryQty: 1, inventoryFrom: 999 })
  check('stock: a stale count, refused, leaves no row', stale.status === 409 && (await rows()).length === before + 2)
}

// ── the floor: every other write still leaves a named row ──────────────────────────────────────────
{
  const before = (await rows()).length
  const p = await S('POST', '/api/admin/products', { name: 'Teapot', slug: 'teapot', status: 'draft' })
  const v = await S('POST', `/api/admin/products/${p.json?.id}/variants`, { sku: 'TEA-1', name: 'Default', priceCents: 2500 }) /* unified: one record is the record itself (RULEBOOK §3), not wrapped ({ code } / { product } / { variant }) */
  const dv = await M('DELETE', `/api/admin/products/variants/${v.json?.id}`) /* unified: one record is the record itself (RULEBOOK §3), not wrapped ({ code } / { product } / { variant }) */
  const dp = await M('DELETE', `/api/admin/products/${p.json?.id}`) /* unified: one record is the record itself (RULEBOOK §3), not wrapped ({ code } / { product } / { variant }) */
  const added = await since(before)
  const say = added.map((r) => `${r.action} ${r.entity} ${r.entityName}`)
  check(`floor: create product, create variant, delete both — four rows, each named (${say.join(' | ')})`, [p, v, dv, dp].every((r) => r.status < 300) && JSON.stringify(say) === JSON.stringify(['create product Teapot', 'create product_variant TEA-1', 'delete product_variant TEA-1', 'delete product Teapot']), say)
  check('floor: a create carries the new record\'s id', added[0]?.entityId === p.json?.id, added[0]) /* unified: one record is the record itself (RULEBOOK §3), not wrapped ({ code } / { product } / { variant }) */
  check(`floor: the variant's own row says what was added ("${(added[1]?.metadata as any)?.description}")`, (added[1]?.metadata as any)?.description === 'Variant TEA-1 added — $25.00, stock not tracked')
check('floor: …and records no request body', added.every((r) => !JSON.stringify(r.metadata).includes('priceCents') && !JSON.stringify(r.metadata).includes('slug')), added.map((r) => r.metadata))
}

// ── loyalty, team ──────────────────────────────────────────────────────────────────────────────────
{
  const before = (await rows()).length
  await M('PUT', '/api/admin/loyalty/config', { loyaltyPointsPerDollar: 3, loyaltyPunchCard: { visitsRequired: 6, rewardName: 'Free mug' } })
  const [l] = await since(before)
  check('loyalty: the rate and the punch card, flat and readable', l?.entity === 'loyalty_config' && (l?.changes as any)?.pointsPerDollar?.old === 1 && (l?.changes as any)?.pointsPerDollar?.new === 3 && (l?.changes as any)?.punchCardOrders?.new === 6 && (l?.changes as any)?.punchCardReward?.new === 'Free mug', l?.changes)
  const add = await O('POST', '/api/company/users', { email: 'newhire@ledger.test', password: 'Temp-Pass-99', firstName: 'New', lastName: 'Hire', role: 'field' }) /* unified: logins are the engine's team (POST /api/company/users, decision 6), a name first and last, and the store's staff seat is the shared field rung (verticals/store/settings.ts team.roles ['manager', 'field'], labelled Staff) */
  const promote = await O('PUT', `/api/company/users/${add.json?.id}`, { role: 'manager' }) /* unified: the engine's team, /api/company/users */
  const revoke = await O('PUT', `/api/company/users/${add.json?.id}`, { isActive: false }) /* unified: the engine's team, /api/company/users */
  const [a, p, r] = await since(before + 1)
  check('team: a login added names the address and the seat', add.status === 201 && a?.action === 'create' && (a?.metadata as any)?.description === 'Login added — newhire@ledger.test, as staff', a)
  check('team: a promotion is a role_change, staff → manager', promote.status === 200 && p?.action === 'role_change' && (p?.changes as any)?.role?.old === 'field' && (p?.changes as any)?.role?.new === 'manager', p) /* unified: the store's staff seat is stored as the shared field rung (verticals/store/settings.ts roleMapping staff → field, labelled Staff; docs/CUTOVER_LEDGER.md "staff kept (read as field)") */
  check('team: revoking access says so', revoke.status === 200 && (r?.metadata as any)?.description === 'Access revoked — newhire@ledger.test', r)
}

// ── sign-ins ───────────────────────────────────────────────────────────────────────────────────────
{
  const before = (await rows()).length
  const ok = await ANON('POST', '/api/auth/login', { email: 'manager@ledger.test', password: 'Correct-Horse-1' })
  const bad = await ANON('POST', '/api/auth/login', { email: 'manager@ledger.test', password: 'wrong-one' })
  const ghost = await ANON('POST', '/api/auth/login', { email: 'nobody@ledger.test', password: 'Correct-Horse-1' })
  const revoked = await ANON('POST', '/api/auth/login', { email: 'newhire@ledger.test', password: 'Temp-Pass-99' })
  const added = await since(before)
  check('sign-in: a sign-in, a wrong password and a revoked login are three rows; an address nobody has is none', ok.status === 200 && bad.status === 401 && ghost.status === 401 && revoked.status === 401 && added.length === 3, added.map((r) => [r.action, r.entityName]))
  check('sign-in: …each names the account, and the failures say why', added[0]?.action === 'login' && added[0]?.userId === manager.id && added[1]?.action === 'login_failed' && (added[1]?.metadata as any)?.description === 'Wrong password' && added[2]?.action === 'login_failed' && /revoked/.test((added[2]?.metadata as any)?.description), added)
  const pw = await M('PUT', '/api/auth/password', { /* unified: the engine's sign-in changes a password with PUT /api/auth/password (decision 6; the template's was POST) */ currentPassword: 'Correct-Horse-1', newPassword: 'Brand-New-Pass-2' })
  const [pwRow] = await since(before + 3)
  check('sign-in: a password change is a row', pw.status === 200 && pwRow?.action === 'password_change' && pwRow?.userId === manager.id, pwRow)
  const everything = JSON.stringify(await rows())
  check('no secrets: no password, typed or hashed, and no token appears anywhere in the log', !everything.includes('Correct-Horse-1') && !everything.includes('Brand-New-Pass-2') && !everything.includes('Temp-Pass-99') && !everything.includes('wrong-one') && !/\$2[aby]\$/.test(everything) && !everything.includes(ok.json?.accessToken?.slice(0, 20) || 'no-token'))
}

// ── reading it: the owner's ────────────────────────────────────────────────────────────────────────
{
  const list = await O('GET', '/api/audit?page=1&limit=50')
  check(`read: the owner reads the log, newest first, paginated (${list.json?.pagination?.total} rows)`, list.status === 200 && Array.isArray(list.json?.data) && list.json.data.length > 20 && list.json.pagination?.total === (await rows()).length && +new Date(list.json.data[0].createdAt) >= +new Date(list.json.data[1].createdAt), list.json?.pagination)
  const refunds = await O('GET', '/api/audit?action=status_change&entity=order')
  check('read: filtered to order status changes', refunds.status === 200 && refunds.json.data.length >= 1 && refunds.json.data.every((r: any) => r.action === 'status_change' && r.entity === 'order'))
  const byMgr = await O('GET', `/api/audit?userId=${manager.id}`)
  check('read: filtered to one person', byMgr.status === 200 && byMgr.json.data.length > 3 && byMgr.json.data.every((r: any) => r.userId === manager.id))
  const f = await O('GET', '/api/audit/filters')
  check('read: the filters are the log\'s own actions and records, with counts', f.status === 200 && f.json?.actions?.some((a: any) => a.value === 'status_change' && a.count >= 1) && f.json?.entities?.some((e: any) => e.value === 'discount_code' && e.count === 4), f.json)
  const hist = await O('GET', `/api/audit?entity=product_variant&entityId=${variant.id}`) /* unified: a record's audit history is the list filtered to it, GET /api/audit?entity=&entityId= (docs/CUTOVER_LEDGER.md) */
  check('read: one record\'s history', hist.status === 200 && Array.isArray(hist.json?.data) && hist.json.data.length === 2, hist.json?.data?.length) /* unified: a list reply is { data, pagination } (RULEBOOK §3) */
  const m = await M('GET', '/api/audit'), s = await S('GET', '/api/audit'), mf = await M('GET', '/api/audit/filters')
  check(`read: the manager and staff are refused (${m.status}, ${s.status}, ${mf.status})`, m.status === 403 && s.status === 403 && mf.status === 403)
  const roster = await O('GET', '/api/company/users'), mRoster = await M('GET', '/api/company/users')
  check('read: the owner\'s person filter lists the team by name; a manager is refused it', roster.status === 200 && roster.json.some((u: any) => u.id === manager.id && u.firstName === 'manager') && mRoster.status === 200 && Array.isArray(mRoster.json) && mRoster.json.every((u: any) => Object.keys(u).sort().join(',') === 'firstName,id,isActive,lastName,role,roleLabel') && !JSON.stringify(roster.json).includes('passwordHash'), { roster: roster.json, manager: mRoster.json }) /* unified: the roster is the engine's (GET /api/company/users, decision 6), which a manager reads through team:read as the picker's fields only — id, name, role, active, never the email, last sign-in or grants — where the store's template refused them; the audit log itself stays the owner's (the 403s above) */
  const dates = await O('GET', `/api/audit?startDate=2000-01-01&endDate=${new Date().toISOString().slice(0, 10)}`)
  check('read: a bare end date covers the whole of that day', dates.status === 200 && dates.json.pagination.total === (await rows()).length, dates.json?.pagination)
}

// ── the wiring and the screens ─────────────────────────────────────────────────────────────────────
{
  const src = (p: string) => (require('node:fs') as typeof import('node:fs')).readFileSync(ROOT + 'apps/unified/' + p, 'utf8').replace(/\r\n/g, '\n') /* unified: the wiring and the screens are the unified app's (apps/unified/server, apps/unified/web/src) */
  const index = src('server/app.ts') /* unified: the app's middleware and mounts are server/app.ts (routes mounted through the registry, mountAll) */
  const at = (s: string) => index.indexOf(s)
  check('wiring: the audit scope opens, then the floor, before any route is mounted', at("app.use('*', (c, next) => requestScope.run({ c }, next))") > 0 && at("app.use('*', createWriteAuditFloor(") > at("app.use('*', (c, next) => requestScope.run({ c }, next))") && at("app.use('*', createWriteAuditFloor(") < at('mountAll(app, mounts')) /* unified: the floor is createWriteAuditFloor and every route goes on through mountAll */
  check('wiring: /api/audit is mounted', /\{ path: '\/api\/audit', access: 'user' as const, router: auditLogRoutes \}/.test(src('server/modules/company.ts'))) /* unified: /api/audit is the company module's mount (server/modules/company.ts) */
  const guards = src('server/http/guards.ts') /* unified: the paging guard is server/http/guards.ts pagingGuard, put on /api/* in server/app.ts */
  const isPosInt = guards.match(/const isPosInt = \(v: string\) => (\/[^/]+\/)\.test/)?.[1]
  check(`paging: the guard accepts real numbers — ${isPosInt} (it was /^d+$/, refusing ?limit=100 and ?page=1)`, isPosInt === String.raw`/^\d+$/` && new RegExp(isPosInt!.slice(1, -1)).test('100') && !new RegExp(isPosInt!.slice(1, -1)).test('1.5') && at("app.use('/api/*', pagingGuard)") > 0) /* unified: …and the guard is applied to /api/* in server/app.ts */
  const nav = src('web/src/shell.ts') /* unified: the menu is web/src/shell.ts */
  check('screen: the Audit Log link asks audit:read, as its route does', /\{ to: '\/crm\/audit', icon: ScrollText, label: 'Audit Log', permission: 'audit:read' \}/.test(nav)) /* unified: the link is /crm/audit (the back office lives under /crm) */
  check('screen: the route is mounted', /<Route path="audit" element=\{<AuditLog \/>\} \/>/.test(src('web/src/App.tsx'))) /* unified: web/src/App.tsx, under /crm */
  const settings = src('web/src/crm/pages/store/catalog/StoreSettingsPage.tsx') /* unified: the store's settings page is StoreSettingsPage.tsx (/crm/store-settings) */
  // unified: the page is in more sections than the template's three — the store's name and email (company:update, PUT /api/company), currency & tax, flat shipping, zones, regional tax, the shopper emails — so each check reads every section under a rule, not the first.
  const sectionsOf = (cond: string) => [...settings.matchAll(new RegExp(String.raw`<fieldset disabled=\{!${cond}\}[^>]*>([\s\S]*?)<\/fieldset>`, 'g'))].map((m) => m[1]) /* unified: every section under one rule */
  const shipBlock = sectionsOf('mayShipping').join('\n') /* unified: the shipping rates and the zones are two sections, both under mayShipping */
  const shipStart = settings.indexOf('<fieldset disabled={!mayShipping}')
  const shipEnd = settings.lastIndexOf('</fieldset>', settings.indexOf('<fieldset disabled={!maySaveSettings}', shipStart)) /* unified: the end of the last shipping section before the next owner's one */
  check('screen: Settings puts the shipping rates and zones under shipping:configure, and nothing else', shipStart > 0 && /useMayWrite\('shipping:configure'\)/.test(settings) && /form\.flatShipping/.test(shipBlock) && /form\.freeShippingThreshold/.test(shipBlock) && /addZone/.test(shipBlock) && !/taxRatePct|addTax|form\.name|form\.email|set\('currency'/.test(shipBlock)) /* unified: the flat rate's label SHOWS the currency (form.currency.toUpperCase()); what must not be here is a field that sets it — set('currency') — or the store's name and email (form.name / form.email, the template's companyName) */
  check('screen: …store, currency and tax stay under settings:update', sectionsOf('maySaveSettings').length === 3 && /form\.taxRatePct/.test(settings.slice(0, shipStart)) && /addTax/.test(settings.slice(shipEnd)) && /set\('currency'/.test(sectionsOf('maySaveSettings').join('\n')) && /useMayWrite\('company:update'\)/.test(settings) && sectionsOf('mayCompany').length === 1 && /form\.name/.test(sectionsOf('mayCompany')[0]) && /form\.email/.test(sectionsOf('mayCompany')[0])) /* unified: settings:update holds currency & tax, the regional tax rates and the shopper emails (three sections); the store's name and support email are the company's (company:update, PUT /api/company) */
  check('screen: one Save, shown to a seat that may change any of it', /\{\(maySaveSettings \|\| mayShipping \|\| mayCompany\) && \(/.test(settings)) /* unified: …any of it now includes the company's own two fields */
  // Each control carries its own disabled as well as its fieldset's: a fieldset disables its children in the browser
  // but leaves each one's `.disabled` false, which is what the T3 retest's script read ("still editable inputs").
  const sections = [...settings.matchAll(/<fieldset disabled=\{(![a-zA-Z]+)\}[^>]*>([\s\S]*?)<\/fieldset>/g)]
  const loose = sections.flatMap(([, cond, body]) => [
    ...[...body.matchAll(/<input(?![^>]*disabled=\{[^}]*\})[^>]*>/g)].map((m) => m[0].slice(0, 60)),
    ...[...body.matchAll(/<input disabled=\{([^}]*)\}/g)].filter((m) => m[1] !== cond).map((m) => `wrong flag: ${m[1]}`),
    ...[...body.matchAll(/(?:\{([a-zA-Z]+) && [^\n]*?)?<button(?![^>]*disabled=\{[^}]*\})[^>]*>/g)].filter((m) => `!${m[1]}` !== cond).map((m) => m[0].slice(0, 60)), /* unified: a section's button is not drawn at all for a seat its rule refuses ({mayShipping && … <button…}, on its line) — the same rule, so it counts; a button with neither is loose */
  ])
  check(`screen: every field and button in a locked section is disabled itself, by its section's own rule (${sections.length} sections)`, sections.length === 6 && loose.length === 0, loose) /* unified: six sections (see above) */
}

console.log(`\naudit and shipping rates: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
