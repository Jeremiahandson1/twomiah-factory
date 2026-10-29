// The store's orders group (server/crm/store/orders) through the real unified server, as the store vertical, with each
// seat signed in for real (owner, manager, staff = the shared `field` rung). The template suite tests/store/*.test.ts is
// the spec (part-refunds, refunds-through-stripe, paypal-refunds, label-picked-rate, audit-and-shipping-rates,
// admin-concurrency, roles, qa-t1, qa-t3-manager); the providers' HTTP — Square, EasyPost, Printful — is answered here by
// stubbing globalThis.fetch in the shapes those suites read back from each sandbox. Nothing leaves the machine.
//   · a part refund reserves, asks Square under its own key, settles once and restocks once; a retry never refunds twice;
//     a refusal gives the reservation back; two at once never pass the total
//   · a refund over what is left is refused before Square is asked
//   · resumePendingRefunds finishes an interrupted part or whole refund under the same idempotency key, once
//   · staff fulfil and buy labels but cannot refund, quote or cancel; staff are not sent the provider's ids or the money
//   · the status table, two people on one order, the no-op that leaves no audit row, tracking only where there is a parcel
//   · a label is bought at the rate picked, once, and only for an order that can ship
//   · a supplier forward happens only when every line is mapped; the supplier connection is the owner's
//   · another company's order is a 404 everywhere, and the webhooks' hooks (createOrderHooks) are the company's
process.env.PAYMENT_ENC_KEY ||= 'store-orders-test-key'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createOrderRefunds } from '../server/crm/store/orders/refunds.ts'
import { createOrderHooks } from '../server/crm/store/orders/index.ts'
import { encryptJSON, encrypt } from '../server/core/crypto.ts'
import { loadVertical } from '../server/core/vertical.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', otherCompanyId = ''
let refunds: ReturnType<typeof createOrderRefunds>
let hooks: ReturnType<typeof createOrderHooks>
const tokens: Record<string, string> = {}
const mails: { to: string; template: string; data: any }[] = []
const S = () => t.schema as any

// ── Square, EasyPost and Printful, answered here ───────────────────────────────────────────────────
type SqCall = { key: string; amount: number; paymentId: string }
const sq: SqCall[] = []
const byKey = new Map<string, { id: string; amount: number }>()
const refundedOn = new Map<string, number>()
let sqMode: 'ok' | 'refuse' | 'drop' = 'ok'
const rateIndex = new Map<string, { carrier: string; service: string; rate: string; shipment: string }>()
const SERVICES = [['USPS', 'GroundAdvantage', '6.57'], ['USPS', 'Priority', '8.01']]
let shipments = 0
const boughtOn: { shipment: string; rate: string; service: string }[] = []
const printfulOrders: any[] = []
const realFetch = globalThis.fetch
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  const method = (init?.method || 'GET').toUpperCase()
  if (url.startsWith('https://connect.squareupsandbox.com/')) {
    if (url.endsWith('/v2/refunds') && method === 'POST') {
      const b = JSON.parse(init.body)
      sq.push({ key: b.idempotency_key, amount: b.amount_money?.amount, paymentId: b.payment_id })
      await new Promise((r) => setTimeout(r, 20))
      if (sqMode === 'drop') throw new TypeError('fetch failed')
      if (sqMode === 'refuse') return json({ errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'REFUND_AMOUNT_INVALID', detail: 'The requested refund amount exceeds the amount available to refund.' }] }, 400)
      const seen = byKey.get(b.idempotency_key)
      if (seen) return json({ refund: { id: seen.id, status: 'COMPLETED', amount_money: { amount: seen.amount, currency: 'USD' } } })
      const r = { id: `sq_ref_${byKey.size + 1}`, amount: b.amount_money.amount }
      byKey.set(b.idempotency_key, r)
      refundedOn.set(b.payment_id, (refundedOn.get(b.payment_id) || 0) + r.amount)
      return json({ refund: { id: r.id, status: 'COMPLETED', amount_money: { amount: r.amount, currency: 'USD' }, payment_id: b.payment_id } })
    }
    const pay = url.match(/\/v2\/payments\/([^/?]+)$/)
    if (pay && method === 'GET') return json({ payment: { id: pay[1], status: 'COMPLETED', amount_money: { amount: 5519, currency: 'USD' }, refunded_money: { amount: refundedOn.get(pay[1]) || 0, currency: 'USD' } } })
    return json({ errors: [{ code: 'NOT_FOUND' }] }, 404)
  }
  if (url.startsWith('https://api.easypost.com/')) {
    if (url.endsWith('/v2/shipments') && method === 'POST') {
      const id = `shp_${++shipments}`
      await new Promise((r) => setTimeout(r, 20))
      const rates = SERVICES.map(([carrier, service, rate], i) => { const rid = `rate_${shipments}_${i}`; rateIndex.set(rid, { carrier, service, rate, shipment: id }); return { id: rid, shipment_id: id, carrier, service, rate, currency: 'USD', delivery_days: 3 } })
      return json({ id, rates })
    }
    const r = url.match(/\/v2\/rates\/([^/?]+)$/)
    if (r && method === 'GET') { const x = rateIndex.get(decodeURIComponent(r[1])); return x ? json({ id: r[1], ...x, shipment_id: x.shipment }) : json({ error: { message: 'not found' } }, 404) }
    const b = url.match(/\/v2\/shipments\/([^/]+)\/buy$/)
    if (b && method === 'POST') {
      const rid = JSON.parse(init.body).rate.id; const x = rateIndex.get(rid)
      if (!x || x.shipment !== b[1]) return json({ error: { message: 'Rate not found for this shipment' } }, 422)
      boughtOn.push({ shipment: b[1], rate: rid, service: x.service })
      return json({ id: b[1], tracking_code: `TRK-${rid}`, postage_label: { label_url: `https://labels.test/${rid}.png` }, selected_rate: { carrier: x.carrier, service: x.service, rate: x.rate } })
    }
    return json({ error: { message: 'not answered here' } }, 404)
  }
  if (url.startsWith('https://api.printful.com/')) {
    if (url.endsWith('/stores')) return json({ result: [{ id: 77 }] })
    if (url.endsWith('/store')) return json({ result: { id: 77 } })
    if (url.endsWith('/webhooks')) return json({ result: {} })
    const v = url.match(/\/store\/variants\/([^/?]+)$/) || url.match(/\/sync\/variant\/([^/?]+)$/)
    if (v) return json({ result: { sync_variant: { name: 'Printful Mug 11oz' }, name: 'Printful Mug 11oz' } })
    if (url.endsWith('/orders') && method === 'POST') { const b = JSON.parse(init.body); printfulOrders.push(b); return json({ result: { id: 9000 + printfulOrders.length, costs: { total: '9.50' } } }) }
    return json({ result: null, error: { message: 'not answered here' } }, 404)
  }
  return realFetch(input, init)
}) as any
afterAll(() => { globalThis.fetch = realFetch })

const as = (who: string) => async (method: string, path: string, body?: unknown) => {
  const res = await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}` }, ...(body === undefined ? {} : { json: body }) })
  const text = await res.text(); let j: any = text; try { j = JSON.parse(text) } catch {}
  return { status: res.status, json: j }
}
const O = as('owner'), M = as('manager'), M2 = as('manager2'), ST = as('staff')

let mugV: any, shirtV: any
const stock = async (id = mugV.id) => (await t.db.select().from(S().storeProductVariant).where(eq(S().storeProductVariant.id, id)))[0].inventoryQty
const setStock = async (n = 10) => { for (const v of [mugV, shirtV]) await t.db.update(S().storeProductVariant).set({ inventoryQty: n }).where(eq(S().storeProductVariant.id, v.id)) }
const ADDRESS = { name: 'Pat Shopper', line1: '1 Main St', city: 'Eau Claire', state: 'WI', postalCode: '54701', country: 'US' }
let n = 0
// 2 Mugs at $15 + 1 Shirt at $22 = $52.00, 10% off (−$5.20), shipping $5.00, tax $3.39 → $55.19. One Mug's share: $14.48.
const mkOrder = async (extra: Record<string, unknown> = {}, forCompany = companyId) => {
  n++
  const [o] = await (t.db as any).insert(S().storeOrder).values({
    companyId: forCompany, orderNumber: `ORD-U${n}`, provider: 'square', providerSessionId: `sq_ord_${n}`, providerPaymentId: `sq_pay_${n}`, status: 'paid',
    customerEmail: `shopper${n}@example.com`, customerName: 'Pat Shopper', customerPhone: '+17155550100', shippingAddress: ADDRESS,
    subtotalCents: 5200, discountCents: 520, shippingCents: 500, taxCents: 339, totalCents: 5519, currency: 'usd', ...extra,
  }).returning()
  const [mug] = await (t.db as any).insert(S().storeOrderItem).values({ orderId: o.id, variantId: mugV.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1', unitPriceCents: 1500, quantity: 2, lineTotalCents: 3000 }).returning()
  const [shirt] = await (t.db as any).insert(S().storeOrderItem).values({ orderId: o.id, variantId: shirtV.id, productName: 'Shirt', variantName: 'Large', sku: 'SHIRT-L', unitPriceCents: 2200, quantity: 1, lineTotalCents: 2200 }).returning()
  return { o, mug, shirt }
}
const orderNow = async (id: string) => (await t.db.select().from(S().storeOrder).where(eq(S().storeOrder.id, id)))[0]
const rowsOf = async (id: string) => t.db.select().from(S().storeOrderRefund).where(eq(S().storeOrderRefund.orderId, id))
const itemNow = async (id: string) => (await t.db.select().from(S().storeOrderItem).where(eq(S().storeOrderItem.id, id)))[0]
const auditFor = async (id: string) => (await t.db.select().from(S().auditLog)).filter((a: any) => a.entityId === id)
const settle = () => new Promise((r) => setTimeout(r, 60))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  tokens.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  for (const [key, role, first] of [['manager', 'manager', 'Mara'], ['manager2', 'manager', 'Milo'], ['staff', 'staff', 'Sam']]) {
    await (t.db as any).insert(S().user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: first, lastName: 'Seat', role, companyId })
    tokens[key] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: 'Seat-pass-1' } })).json()).accessToken
  }
  const [other] = await (t.db as any).insert(S().company).values({ name: 'Other Shop', slug: 'other-shop' }).returning()
  otherCompanyId = other.id
  const [product] = await (t.db as any).insert(S().storeProduct).values({ companyId, slug: 'mug', name: 'Mug', status: 'active' }).returning()
  ;[mugV] = await (t.db as any).insert(S().storeProductVariant).values({ productId: product.id, sku: 'MUG-1', name: 'Default', priceCents: 1500, inventoryQty: 10 }).returning()
  ;[shirtV] = await (t.db as any).insert(S().storeProductVariant).values({ productId: product.id, sku: 'SHIRT-L', name: 'Large', priceCents: 2200, inventoryQty: 10 }).returning()
  await (t.db as any).insert(S().paymentConfig).values({ companyId, provider: 'square', mode: 'test', connected: true, credentialsEnc: encryptJSON({ secretKey: 'sq-sandbox-token', publishableKey: 'LOC1' }), webhookSecretEnc: encrypt('sq-sig') })
  await (t.db as any).insert(S().shippingConfig).values({ companyId, provider: 'easypost', mode: 'test', connected: true, credentialsEnc: encryptJSON({ apiKey: 'EZTK_test', mode: 'test' }), fromAddress: { ...ADDRESS, name: 'Test Builders' } })
  // The store's messages, seen here: the app's own email service, its send answered in place.
  ;(t.services.email as any).send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
  // The same orders code the server runs, for what has no route: the 5-minute resume and the webhooks' hooks.
  const vertical = await loadVertical('store')
  const deps: any = { db: t.db, audit: t.services.audit, logger: { info() {}, warn() {}, error() {} }, permissions: t.services.permissions, services: t.services.crm, settings: vertical.crm }
  const core = createStoreCore(deps)
  refunds = createOrderRefunds(deps, core)
  hooks = createOrderHooks(deps, core)
}, 120_000)

describe('part refunds', () => {
  test('quote: each unit its share of what was paid; everything left is exactly what is left; nothing written', async () => {
    const { o, mug, shirt } = await mkOrder()
    const q1 = await M('POST', `/api/admin/orders/${o.id}/refunds/quote`, { items: [{ orderItemId: mug.id, quantity: 1 }] })
    expect(q1.status).toBe(200)
    expect(q1.json).toMatchObject({ suggestedCents: 1448, maxCents: 5519, shippingLeftCents: 500 })
    const q3 = await M('POST', `/api/admin/orders/${o.id}/refunds/quote`, { items: [{ orderItemId: mug.id, quantity: 2 }, { orderItemId: shirt.id, quantity: 1 }], shippingCents: 500 })
    expect(q3.json.suggestedCents).toBe(5519)
    const q4 = await M('POST', `/api/admin/orders/${o.id}/refunds/quote`, { items: [{ orderItemId: mug.id, quantity: 3 }] })
    expect(q4.status).toBe(400)
    expect(q4.json.error).toMatch(/Only 2 of Mug can still be refunded/)
    expect((await rowsOf(o.id)).length).toBe(0)
  })

  test('reserves, asks Square under refund-<id>, settles once: one Mug back, the order still paid, who made it, the shopper told', async () => {
    await setStock(); const { o, mug } = await mkOrder(); const c0 = sq.length, m0 = mails.length
    const r = await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true, reason: 'Arrived chipped' })
    expect(r.status).toBe(200)
    const [row] = await rowsOf(o.id)
    expect(sq.length).toBe(c0 + 1)
    expect(sq[c0]).toMatchObject({ amount: 1448, paymentId: o.providerPaymentId, key: `refund-${row.id}` })
    expect(row).toMatchObject({ status: 'refunded', providerRefundId: byKey.get(`refund-${row.id}`)!.id, amountCents: 1448, createdBy: expect.any(String), createdByName: 'Mara Seat' })
    expect(await orderNow(o.id)).toMatchObject({ status: 'paid', refundedCents: 1448 })
    expect(await stock()).toBe(11)
    expect(await stock(shirtV.id)).toBe(10)
    expect((await itemNow(mug.id)).refundedQuantity).toBe(1)
    expect(r.json).toMatchObject({ restocked: 1, refund: { kind: 'refunded' }, order: { refundedCents: 1448 } })
    expect(r.json.order.refunds.length).toBe(1)
    await settle()
    const mail = mails.slice(m0).find((m) => m.to === o.customerEmail)
    expect(mail).toMatchObject({ template: 'storeRefundIssued', data: { amountCents: 1448, cancelled: false } })
    const audit = await auditFor(o.id)
    expect(audit.length).toBe(1)
    expect((audit[0].metadata as any).description).toMatch(/^Part refund — \$14\.48 \(1 × Mug\), sent back to the card, 1 unit back in stock$/)
    // Staff read the refund, but not Square's ids.
    const staffRead = await ST('GET', `/api/admin/orders/${o.id}`)
    expect(staffRead.status).toBe(200)
    expect(staffRead.json.refunds[0].amountCents).toBe(1448)
    expect('providerRefundId' in staffRead.json.refunds[0]).toBe(false)
    expect('providerPaymentId' in staffRead.json).toBe(false)
    expect((await M('GET', `/api/admin/orders/${o.id}`)).json.providerPaymentId).toBe(o.providerPaymentId)
  })

  test('over what is left is refused before Square is asked; nothing chosen is refused', async () => {
    const { o } = await mkOrder(); const c0 = sq.length
    expect((await O('POST', `/api/admin/orders/${o.id}/refunds`, { items: [], amountCents: 500 })).status).toBe(200)
    const over = await O('POST', `/api/admin/orders/${o.id}/refunds`, { items: [], amountCents: 5100 })
    expect(over.status).toBe(400)
    expect(over.json).toMatchObject({ code: 'invalid_refund' })
    expect(over.json.error).toMatch(/At most \$50\.19/)
    expect((await O('POST', `/api/admin/orders/${o.id}/refunds`, { items: [] })).status).toBe(400)
    expect(sq.length).toBe(c0 + 1)
    expect((await orderNow(o.id)).refundedCents).toBe(500)
    const bad = await O('POST', `/api/admin/orders/${o.id}/refunds`, { items: 'all' })
    expect(bad.status).toBe(400)
    expect(bad.json).toMatchObject({ error: 'Choose the items and how many of each to refund.', code: 'validation_failed' })
    expect(bad.json.fields.items).toBeTruthy()
  })

  test('refused by Square: the reservation goes back; once Square accepts, the same refund goes through', async () => {
    await setStock(); const { o, mug } = await mkOrder()
    sqMode = 'refuse'
    const r = await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
    sqMode = 'ok'
    expect(r.status).toBe(502)
    expect(r.json.code).toBe('refund_failed')
    expect(r.json.error).toMatch(/nothing was sent back/)
    const [row] = await rowsOf(o.id)
    expect(row.status).toBe('failed')
    expect((await orderNow(o.id)).refundedCents).toBe(0)
    expect((await itemNow(mug.id)).refundedQuantity).toBe(0)
    expect(await stock()).toBe(10)
    const again = await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
    expect(again.status).toBe(200)
    expect(await stock()).toBe(12)
  })

  test('no answer: it waits, reserved; Try again asks under the SAME key, settles once; again sends nothing', async () => {
    await setStock(); const { o, mug, shirt } = await mkOrder(); const c0 = sq.length, m0 = mails.length
    sqMode = 'drop'
    const r = await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: shirt.id, quantity: 1 }], restock: true })
    sqMode = 'ok'
    expect(r.status).toBe(502)
    expect(r.json.code).toBe('refund_unconfirmed')
    const [row] = await rowsOf(o.id)
    expect(row.status).toBe('pending')
    expect((await orderNow(o.id)).refundedCents).toBe(2123)
    expect(await stock(shirtV.id)).toBe(10)
    // Another part, or "the rest", waits for it.
    expect((await M2('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }] })).json.code).toBe('refund_in_progress')
    expect((await M2('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })).json.code).toBe('refund_in_progress')
    const retry = await M('POST', `/api/admin/orders/${o.id}/refunds/${row.id}/retry`)
    expect(retry.status).toBe(200)
    expect(sq.length).toBe(c0 + 2)
    expect(sq[c0 + 1].key).toBe(sq[c0].key)
    expect((await rowsOf(o.id))[0].status).toBe('refunded')
    expect(await stock(shirtV.id)).toBe(11)
    const twice = await M('POST', `/api/admin/orders/${o.id}/refunds/${row.id}/retry`)
    expect(twice.status).toBe(200)
    expect(twice.json.refund).toBeNull()
    expect(sq.length).toBe(c0 + 2)
    expect(await stock(shirtV.id)).toBe(11)
    await settle()
    expect(mails.slice(m0).filter((m) => m.to === o.customerEmail).length).toBe(1)
  })

  test('two managers at once on the last Mug: one refund, one restock', async () => {
    await setStock(); const { o, mug } = await mkOrder()
    await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
    const c0 = sq.length
    const rs = await Promise.all([
      M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }),
      M2('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }),
    ])
    expect(rs.map((r) => r.status).sort().join(',')).toBe('200,409')
    expect(sq.length).toBe(c0 + 1)
    expect(await stock()).toBe(12)
    expect((await itemNow(mug.id)).refundedQuantity).toBe(2)
  })

  test('goodwill refunds racing past the total: one goes through, never both', async () => {
    const { o } = await mkOrder()
    const rs = await Promise.all([M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [], amountCents: 3000 }), M2('POST', `/api/admin/orders/${o.id}/refunds`, { items: [], amountCents: 3000 })])
    expect(rs.map((r) => r.status).sort().join(',')).toBe('200,409')
    expect((await orderNow(o.id)).refundedCents).toBe(3000)
  })

  test('the rest after a part: only what is left goes back, under order-refund-<id>-<refunded>, only the unrefunded units restocked', async () => {
    await setStock(); const { o, mug, shirt } = await mkOrder()
    await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: false })
    expect(await stock()).toBe(10)
    const c0 = sq.length
    const r = await M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
    expect(r.status).toBe(200)
    expect(sq[c0]).toMatchObject({ amount: 4071 })
    expect(await orderNow(o.id)).toMatchObject({ status: 'refunded', refundedCents: 5519 })
    expect(await stock()).toBe(11)
    expect(await stock(shirtV.id)).toBe(11)
    expect((await itemNow(shirt.id)).refundedQuantity).toBe(1)
    const rest = (await rowsOf(o.id)).find((x: any) => x.amountCents === 4071)
    expect(rest).toMatchObject({ status: 'refunded', shippingCents: 500, createdByName: 'Mara Seat' })
    const more = await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [], amountCents: 100 })
    expect(more.json.code).toBe('nothing_to_refund')
  })

  test('the last part closes the order: refunded, as a whole refund would leave it', async () => {
    const { o, mug, shirt } = await mkOrder()
    await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 2 }], restock: true })
    await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: shirt.id, quantity: 1 }], shippingCents: 500, restock: true })
    const now = await orderNow(o.id)
    expect(now).toMatchObject({ status: 'refunded', refundedCents: 5519 })
    expect(now.refundedAt).toBeTruthy()
    expect(((await auditFor(o.id)).at(-1)?.metadata as any).description).toMatch(/nothing left to refund, so the order is refunded/)
  })
})

describe('resuming an interrupted refund', () => {
  test('a part left waiting is asked again under the same key and settled once', async () => {
    await setStock(); const { o, mug } = await mkOrder()
    sqMode = 'drop'; await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }); sqMode = 'ok'
    const [row] = await rowsOf(o.id)
    await t.db.update(S().storeOrderRefund).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(S().storeOrderRefund.id, row.id))
    const c0 = sq.length
    expect(await refunds.resumePendingRefunds()).toBeGreaterThanOrEqual(1)
    expect(sq.length).toBe(c0 + 1)
    expect(sq[c0].key).toBe(`refund-${row.id}`)
    expect((await rowsOf(o.id))[0].status).toBe('refunded')
    expect(await stock()).toBe(11)
    await refunds.resumePendingRefunds()
    expect(sq.length).toBe(c0 + 1)
    expect(await stock()).toBe(11)
  })

  test('a whole refund left stamped is finished with the order\'s own key, logged, once; a fresh one is left alone', async () => {
    await setStock()
    const { o } = await mkOrder({ status: 'refunded', refundPendingAt: new Date(Date.now() - 10 * 60_000) })
    const fresh = await mkOrder({ status: 'refunded', refundPendingAt: new Date(Date.now() - 20_000) })
    const c0 = sq.length
    await refunds.resumePendingRefunds()
    const now = await orderNow(o.id)
    expect(sq.slice(c0).filter((x) => x.paymentId === o.providerPaymentId).map((x) => x.key)).toEqual([`order-refund-${o.id}`])
    expect(now.refundPendingAt).toBeNull()
    expect(now.refundId).toMatch(/^sq_ref_/)
    expect(await stock()).toBe(12)
    expect(((await auditFor(o.id))[0]?.metadata as any)?.description).toBe('Refund completed after an interruption — $55.19 sent back to the card, 3 units back in stock')
    const c1 = sq.length
    await refunds.resumePendingRefunds()
    expect(sq.length).toBe(c1)
    expect(await stock()).toBe(12)
    expect((await orderNow(fresh.o.id)).refundPendingAt).toBeTruthy()
    await t.db.update(S().storeOrder).set({ refundPendingAt: null }).where(eq(S().storeOrder.id, fresh.o.id))
  })

  test('two finishers on one order restock it once', async () => {
    await setStock()
    const { o } = await mkOrder({ status: 'refunded', refundPendingAt: new Date() })
    const got = await Promise.all([
      refunds.settleRefund(o.id, companyId, { kind: 'none_on_file', note: '' }),
      refunds.settleRefund(o.id, companyId, { kind: 'none_on_file', note: '' }),
    ])
    expect(got.sort().join(',')).toBe('0,3')
    expect(await stock()).toBe(12)
  })
})

describe('status changes and who may', () => {
  test('staff fulfil and ship a paid order but cannot refund, cancel, quote or part-refund it', async () => {
    await setStock(); const { o, mug } = await mkOrder({ providerPaymentId: null })
    expect((await ST('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'fulfilled' })).status).toBe(200)
    const refund = await ST('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
    expect(refund.status).toBe(403)
    expect(refund.json.code).toBe('permission_denied')
    expect((await ST('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' })).status).toBe(409) // fulfilled → cancelled is no move at all
    expect((await ST('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }] })).status).toBe(403)
    expect((await ST('POST', `/api/admin/orders/${o.id}/refunds/quote`, { items: [{ orderItemId: mug.id, quantity: 1 }] })).status).toBe(403)
    expect((await ST('POST', `/api/admin/orders/${o.id}/refund/retry`)).status).toBe(403)
    const shipped = await ST('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { trackingNumber: 'TRK-1', markShipped: true })
    expect(shipped.status).toBe(200)
    expect(shipped.json.status).toBe('shipped')
    expect(await stock()).toBe(10)
    const paid = await mkOrder()
    expect((await ST('PATCH', `/api/admin/orders/${paid.o.id}/status`, { status: 'cancelled' })).status).toBe(403)
    expect((await orderNow(paid.o.id)).status).toBe('paid')
    // A manager's cancel of a paid order sends the money back (none on file here) and restocks; the reply says so.
    const cancel = await M('PATCH', `/api/admin/orders/${paid.o.id}/status`, { status: 'cancelled' })
    expect(cancel.status).toBe(200)
    expect(cancel.json.refund.kind).toBe('refunded')
    expect(await stock()).toBe(12)
  })

  test('the status table holds: a closed order is not reopened, nothing moves on a refusal', async () => {
    const { o } = await mkOrder({ status: 'cancelled' })
    const r = await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'paid' })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('invalid_transition')
    expect(r.json.error).toMatch(/closed and cannot be marked paid/)
    expect((await orderNow(o.id)).status).toBe('cancelled')
    const bad = await O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'lost' })
    expect(bad.status).toBe(400)
    expect(bad.json.code).toBe('validation_failed')
  })

  test('two managers refund at once: one refund at Square, one restock, the other told who got there first', async () => {
    await setStock(); const { o } = await mkOrder(); const c0 = sq.length
    const rs = await Promise.all([M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' }), M2('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })])
    expect(rs.map((r) => r.status).sort().join(',')).toBe('200,409')
    const loser = rs.find((r) => r.status === 409)!
    expect(loser.json.code).toBe('order_changed')
    expect(loser.json.error).toMatch(/Someone else just marked this order refunded/)
    expect(sq.length).toBe(c0 + 1)
    expect(await stock()).toBe(12)
  })

  test('refunding an order already refunded changes nothing and writes no audit row', async () => {
    const { o } = await mkOrder({ providerPaymentId: null })
    const r = await M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
    expect(r.status).toBe(200)
    const rows = await auditFor(o.id)
    expect(rows.length).toBe(1)
    expect((rows[0].metadata as any).description).toBe('Refunded — $55.19, recorded only — no money sent back here, 3 units back in stock')
    expect((rows[0].changes as any).status).toEqual({ old: 'paid', new: 'refunded' })
    const noop = await M('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
    expect(noop.status).toBe(200)
    expect((await auditFor(o.id)).length).toBe(1)
  })

  test('the list and the dashboard: staff get the queue, not the money or the supplier cost', async () => {
    await mkOrder({ supplierCostCents: 600 })
    const list = await ST('GET', '/api/admin/orders')
    expect(list.status).toBe(200)
    expect(list.json.pagination.total).toBe(list.json.data.length)
    expect(list.json.data.every((o: any) => !('supplierCostCents' in o) && !('providerSessionId' in o))).toBe(true)
    expect(list.json.data.every((o: any) => o.companyId === companyId)).toBe(true)
    expect((await M('GET', '/api/admin/orders')).json.data.some((o: any) => o.supplierCostCents === 600)).toBe(true)
    const st = await ST('GET', '/api/admin/orders/stats')
    expect(st.json).toMatchObject({ refundedCount: expect.any(Number) })
    expect(['revenueCents', 'refundedCents', 'netCents'].some((k) => k in st.json)).toBe(false) // left out, not null or 0
    expect(typeof st.json.pendingFulfillment).toBe('number')
    const sm = await M('GET', '/api/admin/orders/stats')
    expect(sm.json.netCents).toBe(sm.json.revenueCents - sm.json.refundedCents)
    expect(sm.json.refundedCents).toBeGreaterThan(0)
  })

  test('tracking only where there is a parcel; the note always saves, with its change in the audit row', async () => {
    const { o } = await mkOrder({ status: 'cancelled' })
    const r = await M('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { trackingCarrier: 'UPS', trackingNumber: '1Z999' })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('no_parcel')
    expect((await orderNow(o.id)).trackingNumber).toBeNull()
    const note = await ST('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { internalNote: 'customer kept the box' })
    expect(note.status).toBe(200)
    const row = (await auditFor(o.id)).at(-1)
    expect((row?.changes as any)?.internalNote?.new).toBe('customer kept the box')
  })

  test('the store\'s customers are its contacts, with what each has ordered', async () => {
    const [ct] = await (t.db as any).insert(S().contact).values({ companyId, type: 'customer', name: 'Ada Buyer', email: 'ada@example.com' }).returning()
    await mkOrder({ contactId: ct.id, customerEmail: 'ada@example.com' })
    await mkOrder({ contactId: ct.id, customerEmail: 'ada@example.com', status: 'cancelled' })
    const r = await M('GET', '/api/admin/orders/customers')
    expect(r.status).toBe(200)
    const ada = r.json.data.find((x: any) => x.id === ct.id)
    expect(ada).toMatchObject({ name: 'Ada Buyer', orderCount: 2, totalSpentCents: 5519 })
    expect(r.json.pagination.total).toBeGreaterThanOrEqual(1)
  })
})

describe('labels', () => {
  test('the rate picked is the label bought, by staff, and the order ships with its cost and tracking', async () => {
    const { o } = await mkOrder(); const m0 = mails.length
    const rates = await ST('GET', `/api/admin/shipping/orders/${o.id}/rates`)
    expect(rates.status).toBe(200)
    const priority = rates.json.data.find((r: any) => r.service === 'Priority')
    const buy = await ST('POST', `/api/admin/shipping/orders/${o.id}/label`, { rateId: priority.id, markShipped: true })
    expect(buy.status).toBe(200)
    expect(boughtOn.at(-1)?.service).toBe('Priority')
    const now = await orderNow(o.id)
    expect(now).toMatchObject({ status: 'shipped', labelCostCents: 801 })
    expect(now.trackingNumber).toMatch(/^TRK-/)
    const row = (await auditFor(o.id)).at(-1)
    expect((row?.metadata as any).description).toMatch(/^Shipping label bought — USPS Priority, \$8\.01, tracking TRK-rate_\d+_1; marked shipped, customer emailed$/)
    await settle()
    expect(mails.slice(m0).some((m) => m.to === o.customerEmail && m.template === 'storeOrderShipped')).toBe(true)
    const again = await ST('POST', `/api/admin/shipping/orders/${o.id}/label`, {})
    expect(again.status).toBe(400)
  })

  test('two presses at once: the carrier is charged once; a cancelled order is sold no label', async () => {
    const { o } = await mkOrder(); const b0 = boughtOn.length
    const rs = await Promise.all([ST('POST', `/api/admin/shipping/orders/${o.id}/label`, {}), M('POST', `/api/admin/shipping/orders/${o.id}/label`, {})])
    expect(rs.map((r) => r.status).sort().join(',')).toBe('200,409')
    expect(rs.some((r) => r.json.code === 'label_in_progress')).toBe(true)
    expect(boughtOn.length).toBe(b0 + 1)
    const c = await mkOrder({ status: 'cancelled' })
    const r = await ST('POST', `/api/admin/shipping/orders/${c.o.id}/label`, { markShipped: false })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('no_parcel')
    expect(boughtOn.length).toBe(b0 + 1)
  })

  // The carrier's API key is a credential: the owner's (integrations:update), not the manager's or staff's (store live
  // test, 2026-10-26; bda5a934a's rule).
  test('the carrier account is the owner\'s: staff and the manager are refused it', async () => {
    const carrier = { provider: 'easypost', apiKey: 'EZTK_test_key', mode: 'test', fromAddress: ADDRESS }
    expect((await ST('POST', '/api/admin/shipping/config', carrier)).status).toBe(403)
    expect((await M('POST', '/api/admin/shipping/config', carrier)).status).toBe(403)
    const conn = await O('POST', '/api/admin/shipping/config', carrier)
    expect(conn.status).toBe(200)
    expect(conn.json).toEqual({ success: true, connected: true })
    expect((await ST('GET', '/api/admin/shipping/config')).json.connected).toBe(true)
  })
})

describe('suppliers', () => {
  test('the owner connects Printful; a manager is refused the connection', async () => {
    expect((await M('GET', '/api/admin/suppliers')).status).toBe(403)
    const r = await O('POST', '/api/admin/suppliers/connect', { provider: 'printful', mode: 'test', apiKey: 'pf-key' })
    expect(r.status).toBe(200)
    expect(r.json.config).toMatchObject({ provider: 'printful', connected: true, autoForward: true })
    expect((await O('GET', '/api/admin/suppliers')).json.config.connected).toBe(true)
  })

  test('an order forwards only when every line is mapped', async () => {
    const { o } = await mkOrder({ providerPaymentId: null })
    const m = await O('PUT', `/api/admin/suppliers/variant-map/${mugV.id}`, { ref: '123' })
    expect(m.status).toBe(200)
    expect(m.json.success).toBe(true)
    const first = await O('POST', `/api/admin/suppliers/orders/${o.id}/forward`)
    expect(first.status).toBe(400)
    expect(first.json.error).toMatch(/Items without a supplier mapping: SHIRT-L/)
    expect((await orderNow(o.id)).supplierStatus).toBe('unmapped')
    expect(printfulOrders.length).toBe(0)
    await O('PUT', `/api/admin/suppliers/variant-map/${shirtV.id}`, { ref: '456' })
    const map = await O('GET', '/api/admin/suppliers/variant-map')
    expect(map.json.data.length).toBe(2)
    const ok = await O('POST', `/api/admin/suppliers/orders/${o.id}/forward`)
    expect(ok.status).toBe(200)
    expect(ok.json.success).toBe(true)
    expect(printfulOrders.length).toBe(1)
    expect(await orderNow(o.id)).toMatchObject({ supplierStatus: 'placed', supplierOrderId: '9001', supplierCostCents: 950 })
    const held = await O('POST', `/api/admin/suppliers/orders/${o.id}/hold`)
    expect(held.status).toBe(400)
  })
})

describe('another company\'s order', () => {
  test('is a 404 on every route, and nothing of it is touched', async () => {
    const { o, mug } = await mkOrder({}, otherCompanyId); const c0 = sq.length
    const id = o.id
    const probes = [
      await O('GET', `/api/admin/orders/${id}`),
      await O('PATCH', `/api/admin/orders/${id}/status`, { status: 'refunded' }),
      await O('PATCH', `/api/admin/orders/${id}/fulfillment`, { internalNote: 'x' }),
      await O('POST', `/api/admin/orders/${id}/refunds/quote`, { items: [{ orderItemId: mug.id, quantity: 1 }] }),
      await O('POST', `/api/admin/orders/${id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }] }),
      await O('POST', `/api/admin/orders/${id}/refund/retry`),
      await O('GET', `/api/admin/shipping/orders/${id}/rates`),
      await O('POST', `/api/admin/shipping/orders/${id}/label`, {}),
      await O('POST', `/api/admin/suppliers/orders/${id}/forward`),
      await O('POST', `/api/admin/suppliers/orders/${id}/hold`),
    ]
    expect(probes.map((p) => p.status)).toEqual(probes.map(() => 404))
    expect((await O('GET', '/api/admin/orders')).json.data.some((x: any) => x.id === id)).toBe(false)
    expect(await orderNow(id)).toMatchObject({ status: 'paid', refundedCents: 0, internalNote: null, labelUrl: null, supplierStatus: null })
    expect(sq.length).toBe(c0)
  })
})

describe('the webhooks\' hooks (createOrderHooks)', () => {
  test('mayMove is the status table', () => {
    expect(hooks.mayMove('paid', 'shipped')).toBe(true)
    expect(hooks.mayMove('cancelled', 'paid')).toBe(false)
    expect(hooks.mayMove('refunded', 'refunded')).toBe(true)
  })

  test('applyProviderRefund: our own echo ignored, a dashboard part recorded, the rest refunds and restocks once; another company\'s ignored', async () => {
    await setStock(); const { o, mug } = await mkOrder()
    await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true })
    expect(await hooks.applyProviderRefund(otherCompanyId, 'square', o.providerPaymentId, 5519, 5519)).toBe('ignored')
    expect(await hooks.applyProviderRefund(companyId, 'square', o.providerPaymentId, 1448, 5519)).toBe('ignored')
    expect(await hooks.applyProviderRefund(companyId, 'square', o.providerPaymentId, 2448, 5519)).toBe('partial')
    const rows = await rowsOf(o.id)
    expect(rows.some((x: any) => x.amountCents === 1000 && x.moneyBack === 'provider_dashboard')).toBe(true)
    expect(await stock()).toBe(11)
    expect(await hooks.applyProviderRefund(companyId, 'square', o.providerPaymentId, 5519, 5519)).toBe('refunded')
    expect(await orderNow(o.id)).toMatchObject({ status: 'refunded', refundedCents: 5519 })
    expect(await stock()).toBe(12)
    expect(await stock(shirtV.id)).toBe(11)
    expect(await hooks.applyProviderRefund(companyId, 'square', o.providerPaymentId, 5519, 5519)).toBe('ignored')
    expect(await stock()).toBe(12)
    const desc = (await auditFor(o.id)).map((a: any) => a.metadata?.description)
    expect(desc).toContain("Partly refunded in Square's dashboard: $10.00 ($24.48 of $55.19 back so far) — no units restocked")
  })

  test('applyRefundUpdate: a held part settles once on "completed", gives its reservation back on "failed"; another company\'s is unknown', async () => {
    await setStock(); const { o, mug } = await mkOrder()
    sqMode = 'drop'; await M('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: mug.id, quantity: 1 }], restock: true }); sqMode = 'ok'
    const [row] = await rowsOf(o.id)
    // As a provider that holds a refund leaves it: pending, with the provider's id on it.
    await t.db.update(S().storeOrderRefund).set({ providerRefundId: 'HELD-1', error: null }).where(eq(S().storeOrderRefund.id, row.id))
    expect(await hooks.applyRefundUpdate(otherCompanyId, 'square', 'HELD-1', 'completed')).toBe('unknown')
    expect(await hooks.applyRefundUpdate(companyId, 'square', 'HELD-1', 'completed')).toBe('settled')
    expect((await rowsOf(o.id))[0]).toMatchObject({ status: 'refunded', providerRefundId: 'HELD-1' })
    expect(await stock()).toBe(11)
    expect(await hooks.applyRefundUpdate(companyId, 'square', 'HELD-1', 'completed')).toBe('ours')
    expect(await stock()).toBe(11)

    const b = await mkOrder()
    sqMode = 'drop'; await M('POST', `/api/admin/orders/${b.o.id}/refunds`, { items: [{ orderItemId: b.mug.id, quantity: 2 }], restock: true }); sqMode = 'ok'
    const [held] = await rowsOf(b.o.id)
    await t.db.update(S().storeOrderRefund).set({ providerRefundId: 'HELD-2' }).where(and(eq(S().storeOrderRefund.id, held.id)))
    expect(await hooks.applyRefundUpdate(companyId, 'square', 'HELD-2', 'failed', 'ECHECK')).toBe('released')
    const [after] = await rowsOf(b.o.id)
    expect(after.status).toBe('failed')
    expect(after.error).toMatch(/did not complete the refund \(ECHECK\)/)
    expect(await orderNow(b.o.id)).toMatchObject({ status: 'paid', refundedCents: 0 })
    expect((await itemNow(b.mug.id)).refundedQuantity).toBe(0)
    expect(await stock()).toBe(11)
    expect(await hooks.applyRefundUpdate(companyId, 'square', 'NOT-OURS', 'completed')).toBe('unknown')
  })
})
