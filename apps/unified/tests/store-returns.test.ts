// Gap 8 against Shopify's returns (2026-10-30): a shopper (signed in) or staff starts a return; the owner approves or
// declines it; the goods are received (stock comes back then); then it is refunded — to the card, to store credit, or
// part of each — or exchanged for something sent at no charge. Behind store_returns (registered not ready).
//   · THE RULE: a return window, a restocking fee and a return-shipping fee (neither kept when the return is the shop's
//     fault, or waived, or on an exchange), an optional prepaid return label;
//   · SEATS: a member of staff may look; deciding, receiving and refunding are the manager's and the owner's;
//   · THE MONEY goes through the order's one refund machinery: once, never past the order's total, the provider's refusal
//     sends nothing and issues nothing, and what a refund keeps is the rule's figure, not the shopper's;
//   · A shopper reaches only their own orders and returns.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'
import { encryptJSON } from '../server/core/crypto.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const A = '/api/public/account'
const R = '/api/admin/store-returns'
const db = () => k.t.db as any
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_accounts', 'store_returns']
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const DAY = 86_400_000
const ADDRESS = { line1: '1 Main St', city: 'Eau Claire', state: 'WI', postalCode: '54701', country: 'US' }
let mug: any, plate: any, mug2: any, cheap: any
let ann: any, bob: any
let seq = 0
let easypostMode: 'ok' | 'fail' = 'ok'
const bought: string[] = []

async function order(who: any, o: { number: string; lines: Array<[any, number]>; shipping?: number; shippedDaysAgo?: number; placedDaysAgo?: number }) {
  const subtotal = o.lines.reduce((n, [p, q]) => n + q * p.variant.priceCents, 0)
  const shipping = o.shipping ?? 0
  const placed = new Date(Date.now() - (o.placedDaysAgo ?? 6) * DAY)
  const [row] = await db().insert(k.S.storeOrder).values({
    companyId: k.companyId, contactId: who.id, orderNumber: o.number, provider: 'stripe', providerSessionId: `cs_ret_${++seq}`, providerPaymentId: `pi_${o.number}`, status: 'shipped',
    customerEmail: who.email, customerName: who.name, shippingAddress: ADDRESS, subtotalCents: subtotal, shippingCents: shipping, totalCents: subtotal + shipping, createdAt: placed,
    fulfilledAt: new Date(Date.now() - (o.shippedDaysAgo ?? 5) * DAY),
  }).returning()
  const items: any[] = []
  for (const [p, qty] of o.lines) {
    const [it] = await db().insert(k.S.storeOrderItem).values({ orderId: row.id, productId: p.product.id, variantId: p.variant.id, productName: p.product.name, variantName: 'Default', sku: p.variant.sku, unitPriceCents: p.variant.priceCents, quantity: qty, lineTotalCents: qty * p.variant.priceCents }).returning()
    items.push(it)
  }
  return { row, items }
}
const stock = async (p: any) => (await db().select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, p.variant.id)))[0].inventoryQty as number | null
const orderNow = async (id: string) => (await db().select().from(k.S.storeOrder).where(eq(k.S.storeOrder.id, id)))[0]
const itemNow = async (id: string) => (await db().select().from(k.S.storeOrderItem).where(eq(k.S.storeOrderItem.id, id)))[0]
const refundCalls = () => k.stripe.calls.filter((c) => c.path === '/v1/refunds' && c.method === 'POST')
const mailsOf = (template: string, to?: string) => k.mails.filter((m) => m.template === template && (!to || m.to.toLowerCase() === to.toLowerCase()))
const cookieOf = (res: { headers: Headers }) => (res.headers.get('set-cookie') || '').split(';')[0]
const json = { 'content-type': 'application/json' }

async function signIn(email: string) {
  const who = email.toLowerCase() === 'bob@example.com' ? bob : ann
  await db().delete(k.S.shopperLogin).where(eq(k.S.shopperLogin.contactId, who.id))
  const before = mailsOf('storeSignIn', email).length
  await k.pub('POST', `${A}/sign-in`, { email })
  await k.settle()
  const mail = mailsOf('storeSignIn', email)[before]
  const res = await k.pub('POST', `${A}/verify`, { email, code: mail.data.code })
  expect(res.status).toBe(200)
  return cookieOf(res)
}
const shopper = (cookie: string) => (method: string, path: string, body?: unknown) => k.pub(method, A + path, body, { cookie })
/** The owner starting a return the way the shopper's request would arrive, ready to be decided. */
async function requested(cookie: string, ord: { row: any; items: any[] }, lines: Array<[number, number]>, extra: Record<string, unknown> = {}) {
  const r = await shopper(cookie)('POST', '/returns', { orderId: ord.row.id, items: lines.map(([i, quantity]) => ({ orderItemId: ord.items[i].id, quantity })), reason: 'changed_mind', ...extra })
  expect(r.status).toBe(201)
  return r.json
}
async function received(id: string, restock = true) {
  expect((await k.O('POST', `${R}/${id}/approve`, {})).status).toBe(200)
  expect((await k.O('POST', `${R}/${id}/receive`, { restock })).status).toBe(200)
}

beforeAll(async () => {
  k = await bootStore()
  const realFetch = globalThis.fetch
  // EasyPost, answered here: a return label is a shipment bought; a mode makes the carrier refuse.
  const wrapped = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://api.easypost.com/')) {
      const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
      if (easypostMode === 'fail') return ok({ error: { message: 'Address could not be verified' } }, 422)
      if (url.endsWith('/v2/shipments') && String(init?.method).toUpperCase() === 'POST') return ok({ id: 'shp_ret', rates: [{ id: 'rate_ret', shipment_id: 'shp_ret', carrier: 'USPS', service: 'Ground', rate: '6.20', currency: 'USD', delivery_days: 3 }] })
      if (url.endsWith('/v2/shipments/shp_ret/buy')) { bought.push(url); return ok({ id: 'shp_ret', tracking_code: 'RET-TRK-1', postage_label: { label_url: 'https://labels.test/return-1.png' }, selected_rate: { carrier: 'USPS', service: 'Ground', rate: '6.20' } }) }
      return ok({ error: { message: 'not answered here' } }, 404)
    }
    return wrapped(input, init)
  }) as any
  void realFetch
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, qty: 5 })
  plate = await k.product({ slug: 'plate', name: 'Plate', sku: 'PLATE-1', priceCents: 3000, qty: 5 })
  mug2 = await k.product({ slug: 'mug-blue', name: 'Blue mug', sku: 'MUG-2', priceCents: 2000, qty: 3 })
  cheap = await k.product({ slug: 'cup', name: 'Cup', sku: 'CUP-1', priceCents: 1500, qty: 3 })
  ;[ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann Able', email: 'ann@example.com', type: 'customer' }).returning()
  ;[bob] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Bob Baker', email: 'bob@example.com', type: 'customer' }).returning()
  await features(ON)
}, 120_000)
afterAll(() => k.restore())

describe('offered, never switched on', () => {
  test('registered not ready and offered to the store only; off, the back office says so and the shopper has no returns', async () => {
    const f = FEATURE_MAP.store_returns
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
    expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain('store_returns')
    await features(['dashboard', 'orders', 'products', 'contacts', 'store_accounts'])
    const off = await k.O('GET', R)
    expect(off.status).toBe(403)
    expect(off.json.code).toBe('FEATURE_NOT_ENABLED')
    const cookie = await signIn('ann@example.com')
    expect((await shopper(cookie)('GET', '/returns')).status).toBe(404)
    expect((await shopper(cookie)('POST', '/returns', { orderId: 'x', items: [{ orderItemId: 'y', quantity: 1 }] })).status).toBe(404)
    expect((await shopper(cookie)('GET', '/me')).json.returns).toBe(false)
    await features(ON)
    expect((await k.O('GET', R)).status).toBe(200)
    expect((await shopper(cookie)('GET', '/me')).json.returns).toBe(true)
  })
})

describe('the return rule', () => {
  test('the owner sets it (a window, a restocking fee, return postage); a seat without settings:update is refused; nonsense is refused', async () => {
    expect((await k.ST('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: true })).status).toBe(403)
    expect((await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: -3, returnShippingFeeCents: 500, labels: false, shopperReturns: true })).status).toBe(400)
    const saved = await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: true })
    expect(saved.status).toBe(200)
    expect(saved.json).toEqual({ windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: true })
    expect((await k.ST('GET', `${R}/settings`)).json.windowDays).toBe(30)
  })

  test('outside the window a shopper is refused and told the date; staff may allow a late one', async () => {
    const old = await order(ann, { number: 'OLD-1', lines: [[mug, 1]], placedDaysAgo: 70, shippedDaysAgo: 60 })
    const cookie = await signIn('ann@example.com')
    const r = await shopper(cookie)('POST', '/returns', { orderId: old.row.id, items: [{ orderItemId: old.items[0].id, quantity: 1 }], reason: 'changed_mind' })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('window_closed')
    expect(r.json.error).toMatch(/closed on .*\(30 days\)/)
    const orders = (await shopper(cookie)('GET', '/orders')).json.data
    expect(orders.find((o: any) => o.orderNumber === 'OLD-1').returnable).toMatchObject({ open: false, why: 'The return window for this order has closed.' })
    // Staff: a member of staff cannot start one (it decides money); the manager can, and says it is late.
    expect((await k.ST('POST', R, { orderId: old.row.id, items: [{ orderItemId: old.items[0].id, quantity: 1 }], allowLate: true })).status).toBe(403)
    expect((await k.M('POST', R, { orderId: old.row.id, items: [{ orderItemId: old.items[0].id, quantity: 1 }] })).status).toBe(409)
    const late = await k.M('POST', R, { orderId: old.row.id, items: [{ orderItemId: old.items[0].id, quantity: 1 }], reason: 'changed_mind', allowLate: true })
    expect(late.status).toBe(201)
    expect(late.json).toMatchObject({ status: 'approved', startedBy: 'staff', late: true })
  })

  test('the window runs from the day it shipped, not the day it was placed', async () => {
    const o = await order(ann, { number: 'SLOW-1', lines: [[mug, 1]], placedDaysAgo: 40, shippedDaysAgo: 10 })
    const cookie = await signIn('ann@example.com')
    expect((await shopper(cookie)('POST', '/returns', { orderId: o.row.id, items: [{ orderItemId: o.items[0].id, quantity: 1 }] })).status).toBe(201)
  })
})

describe('asking, and being told', () => {
  let oa: { row: any; items: any[] }
  let cookie = ''
  test('a shopper asks to return units of their own order; what is left is counted; the figures are the rule’s', async () => {
    oa = await order(ann, { number: 'A-1', lines: [[mug, 2], [plate, 1]], shipping: 500 })
    cookie = await signIn('ann@example.com')
    const listed = (await shopper(cookie)('GET', '/orders')).json.data.find((o: any) => o.orderNumber === 'A-1')
    expect(listed.returnable.open).toBe(true)
    expect(listed.returnable.lines.map((l: any) => l.left).sort()).toEqual([1, 2])
    const ret = await requested(cookie, oa, [[0, 2]], { note: 'Too big', preferCredit: false })
    expect(ret).toMatchObject({ status: 'requested', orderNumber: 'A-1', reason: 'changed_mind', restockingFeeCents: 400, returnShippingFeeCents: 500, refundCents: null })
    expect(ret.returnNumber).toMatch(/^RET-[0-9A-Z]{8}$/)
    // The owner is told.
    await k.settle()
    expect(mailsOf('storeReturnUpdate', 'owner@shop.test').length).toBeGreaterThan(0)
  })

  test('the same units cannot be asked for twice; more than were bought cannot be asked for; gift cards and other shoppers’ orders are refused', async () => {
    const again = await shopper(cookie)('POST', '/returns', { orderId: oa.row.id, items: [{ orderItemId: oa.items[0].id, quantity: 1 }], reason: 'changed_mind' })
    expect(again.status).toBe(409)
    expect(again.json.error).toContain('already been returned or is in a return')
    const toomany = await shopper(cookie)('POST', '/returns', { orderId: oa.row.id, items: [{ orderItemId: oa.items[1].id, quantity: 2 }] })
    expect(toomany.status).toBe(409)
    const bobsOrder = await order(bob, { number: 'B-1', lines: [[mug, 1]] })
    expect((await shopper(cookie)('POST', '/returns', { orderId: bobsOrder.row.id, items: [{ orderItemId: bobsOrder.items[0].id, quantity: 1 }] })).status).toBe(404)
    const card = await k.product({ slug: 'gc', name: 'Gift card', sku: 'GC-1', priceCents: 2500, kind: 'gift_card' })
    const gift = await order(ann, { number: 'G-1', lines: [[card, 1]] })
    const refusedGift = await shopper(cookie)('POST', '/returns', { orderId: gift.row.id, items: [{ orderItemId: gift.items[0].id, quantity: 1 }] })
    expect(refusedGift.status).toBe(409)
    expect(refusedGift.json.error).toContain('Gift cards cannot be returned')
    // A shopper sees their own returns only.
    const bobCookie = await signIn('bob@example.com')
    expect((await shopper(bobCookie)('GET', '/returns')).json.data).toEqual([])
    expect((await shopper(cookie)('GET', '/returns')).json.data.length).toBeGreaterThan(0)
    // …and cannot cancel another's.
    const mineId = (await shopper(cookie)('GET', '/returns')).json.data.find((r: any) => r.orderNumber === 'A-1').id
    expect((await shopper(bobCookie)('POST', `/returns/${mineId}/cancel`, {})).status).toBe(404)
  })

  test('a shopper who may not start returns is told to get in touch', async () => {
    await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: false })
    const r = await shopper(cookie)('POST', '/returns', { orderId: oa.row.id, items: [{ orderItemId: oa.items[1].id, quantity: 1 }] })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('returns_by_staff')
    await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: true })
  })

  test('declined (the reason is required and the shopper reads it) and cancelled', async () => {
    const plateAsk = await requested(cookie, oa, [[1, 1]])
    expect((await k.ST('POST', `${R}/${plateAsk.id}/decline`, { reason: 'No' })).status).toBe(403)
    expect((await k.M('POST', `${R}/${plateAsk.id}/decline`, { reason: '' })).status).toBe(400)
    const declined = await k.M('POST', `${R}/${plateAsk.id}/decline`, { reason: 'Used items cannot be returned.' })
    expect(declined.status).toBe(200)
    expect(declined.json.status).toBe('declined')
    const seen = (await shopper(cookie)('GET', '/returns')).json.data.find((r: any) => r.id === plateAsk.id)
    expect(seen).toMatchObject({ status: 'declined', declineReason: 'Used items cannot be returned.' })
    expect((await k.M('POST', `${R}/${plateAsk.id}/approve`, {})).status).toBe(409)
    // Its units are free again, and the shopper may withdraw a new ask.
    const again = await requested(cookie, oa, [[1, 1]])
    const cancelled = await shopper(cookie)('POST', `/returns/${again.id}/cancel`, {})
    expect(cancelled.status).toBe(200)
    expect(cancelled.json.status).toBe('cancelled')
    expect((await shopper(cookie)('POST', `/returns/${again.id}/cancel`, {})).status).toBe(409)
  })
})

describe('approving, receiving, refunding to the card', () => {
  test('approval keeps the rule’s figures; the shop’s fault and a waiver keep none; the shopper is emailed', async () => {
    const o = await order(ann, { number: 'A-2', lines: [[mug, 2], [plate, 1]], shipping: 500 })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 2]])
    expect((await k.ST('POST', `${R}/${ask.id}/approve`, {})).status).toBe(403)
    const ok = await k.M('POST', `${R}/${ask.id}/approve`, {})
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ status: 'approved', lineValueCents: 4000, restockingFeeCents: 400, returnShippingFeeCents: 500, refundCents: 3100 })
    expect((await k.M('POST', `${R}/${ask.id}/approve`, {})).status).toBe(409)
    await k.settle()
    expect(mailsOf('storeReturnUpdate', 'ann@example.com').map((m) => m.data.headline)).toContain('Your return is approved')
    // The shop's fault.
    const defective = await requested(cookie, o, [[1, 1]], { reason: 'defective' })
    expect(defective).toMatchObject({ restockingFeeCents: 0, returnShippingFeeCents: 0 })
    // A waiver.
    const waived = await requested(cookie, (await order(ann, { number: 'A-3', lines: [[mug, 1]] })), [[0, 1]])
    expect(waived.restockingFeeCents).toBe(200)
    const w = await k.M('POST', `${R}/${waived.id}/approve`, { waiveFees: true })
    expect(w.json).toMatchObject({ restockingFeeCents: 0, returnShippingFeeCents: 0, refundCents: 2000 })
  })

  test('received: the units come back on the shelf then, once; not at all when the owner says they cannot be resold', async () => {
    const o = await order(ann, { number: 'A-4', lines: [[mug, 2], [plate, 1]], shipping: 500 })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 2]])
    expect((await k.M('POST', `${R}/${ask.id}/receive`, {})).status).toBe(409) // not approved yet
    await k.M('POST', `${R}/${ask.id}/approve`, {})
    const before = await stock(mug)
    expect((await k.ST('POST', `${R}/${ask.id}/receive`, {})).status).toBe(403)
    const got = await k.M('POST', `${R}/${ask.id}/receive`, {})
    expect(got.status).toBe(200)
    expect(got.json).toMatchObject({ status: 'received', restocked: 2 })
    expect(await stock(mug)).toBe(before! + 2)
    expect((await k.M('POST', `${R}/${ask.id}/receive`, {})).status).toBe(409)
    expect(await stock(mug)).toBe(before! + 2)
    // Damaged on arrival: received, not restocked.
    const dmg = await requested(cookie, o, [[1, 1]])
    await k.M('POST', `${R}/${dmg.id}/approve`, {})
    const plateBefore = await stock(plate)
    expect((await k.M('POST', `${R}/${dmg.id}/receive`, { restock: false })).json.restocked).toBe(0)
    expect(await stock(plate)).toBe(plateBefore)
  })

  test('refund to the card: the rule’s amount goes to the provider, once; the order and its lines are marked; the shopper is told', async () => {
    const o = await order(ann, { number: 'A-5', lines: [[mug, 2], [plate, 1]], shipping: 500 })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 2]])
    expect((await k.M('POST', `${R}/${ask.id}/refund`, {})).status).toBe(409) // goods not received
    await received(ask.id)
    const sent = refundCalls().length
    expect((await k.ST('POST', `${R}/${ask.id}/refund`, {})).status).toBe(403)
    const r = await k.M('POST', `${R}/${ask.id}/refund`, {})
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ status: 'refunded', refundCents: 3100, creditCents: 0, pending: false })
    expect(r.json.refund).toMatchObject({ status: 'refunded', amountCents: 3100 })
    expect(refundCalls().length).toBe(sent + 1)
    const call = refundCalls().at(-1)!
    expect(call.params.get('amount')).toBe('3100')
    expect(call.params.get('payment_intent')).toBe('pi_A-5')
    expect((await orderNow(o.row.id)).refundedCents).toBe(3100)
    expect((await itemNow(o.items[0].id)).refundedQuantity).toBe(2)
    // Once.
    expect((await k.M('POST', `${R}/${ask.id}/refund`, {})).status).toBe(409)
    expect(refundCalls().length).toBe(sent + 1)
    await k.settle()
    expect(mailsOf('storeRefundIssued', 'ann@example.com').at(-1)!.data.amountCents).toBe(3100)
    // The shopper reads the outcome.
    expect((await shopper(cookie)('GET', '/returns')).json.data.find((x: any) => x.id === ask.id)).toMatchObject({ status: 'refunded', refundCents: 3100, creditCents: 0 })
  })

  test('a refund the provider refuses sends nothing, issues nothing, and can be tried again', async () => {
    const o = await order(ann, { number: 'A-6', lines: [[mug, 1]] })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 1]], { preferCredit: false })
    await received(ask.id)
    const sent = refundCalls().length
    k.stripe.state.refund = 'refuse'
    const refused = await k.M('POST', `${R}/${ask.id}/refund`, { creditCents: 500 })
    k.stripe.state.refund = 'ok'
    expect(refused.status).toBe(502)
    expect(refused.json.code).toBe('refund_failed')
    expect((await orderNow(o.row.id)).refundedCents).toBe(0)
    expect((await itemNow(o.items[0].id)).refundedQuantity).toBe(0)
    expect(mailsOf('storeCreditIssued', 'ann@example.com').length).toBe(0)
    const fresh = await k.M('GET', `${R}/${ask.id}`)
    void fresh
    expect((await k.O('GET', `${R}/${ask.id}`)).json.status).toBe('received')
    // Tried again: it goes.
    const again = await k.M('POST', `${R}/${ask.id}/refund`, { creditCents: 500 })
    expect(again.status).toBe(200)
    expect(again.json.status).toBe('refunded')
    expect(refundCalls().length).toBeGreaterThan(sent)
  })
})

describe('refunding as store credit', () => {
  test('all credit: no card refund; a gift card in the shopper’s name with the balance; they are emailed the number and see it on their account', async () => {
    const o = await order(ann, { number: 'C-1', lines: [[plate, 1]] })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 1]], { reason: 'defective', preferCredit: true })
    await received(ask.id)
    const sent = refundCalls().length
    const r = await k.M('POST', `${R}/${ask.id}/refund`, {})
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ status: 'refunded', refundCents: 3000, creditCents: 3000 })
    expect(refundCalls().length).toBe(sent)
    const cards = (await db().select().from(k.S.barGiftCard).where(eq(k.S.barGiftCard.soldVia, 'store_credit'))) as any[]
    const card = cards.find((c) => c.orderId === o.row.id)
    expect(card).toMatchObject({ initialCents: 3000, balanceCents: 3000, purchaserEmail: 'ann@example.com', status: 'active' })
    await k.settle()
    const mail = mailsOf('storeCreditIssued', 'ann@example.com').at(-1)!
    expect(mail.data).toMatchObject({ code: card.code, amountCents: 3000 })
    expect(mailsOf('storeRefundIssued', 'ann@example.com').filter((m) => m.data.amountCents === 3000).length).toBe(0)
    const me = (await shopper(cookie)('GET', '/me')).json
    expect(me.credit).toEqual(expect.arrayContaining([{ code: card.code, balanceCents: 3000, initialCents: 3000 }]))
    // It is a gift card like any other: its balance is what checkout reads.
    const bal = await k.pub('GET', `/api/public/gift-cards/balance?code=${encodeURIComponent(card.code)}`)
    expect(bal.json.balanceCents).toBe(3000)
    // Bob does not see Ann's credit.
    expect((await shopper(await signIn('bob@example.com'))('GET', '/me')).json.credit).toEqual([])
    // The order carries the credit on its refund row, and it counts against what can still be refunded.
    expect((await orderNow(o.row.id)).refundedCents).toBe(3000)
  })

  test('part to the card and part as credit: the provider is asked for the card share only', async () => {
    const o = await order(ann, { number: 'C-2', lines: [[mug, 2]] })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 1]], { reason: 'defective' })
    await received(ask.id)
    const sent = refundCalls().length
    const r = await k.M('POST', `${R}/${ask.id}/refund`, { creditCents: 800 })
    expect(r.json).toMatchObject({ status: 'refunded', refundCents: 2000, creditCents: 800 })
    expect(refundCalls().length).toBe(sent + 1)
    expect(refundCalls().at(-1)!.params.get('amount')).toBe('1200')
    const card = ((await db().select().from(k.S.barGiftCard)) as any[]).find((c) => c.orderId === o.row.id && c.soldVia === 'store_credit')
    expect(card.balanceCents).toBe(800)
    expect((await orderNow(o.row.id)).refundedCents).toBe(2000)
    // Credit cannot be more than the refund.
    const o2 = await order(ann, { number: 'C-3', lines: [[mug, 1]] })
    const ask2 = await requested(await signIn('ann@example.com'), o2, [[0, 1]], { reason: 'defective' })
    await received(ask2.id)
    expect((await k.M('POST', `${R}/${ask2.id}/refund`, { creditCents: 2500 })).status).toBe(400)
  })

  test('fees that eat the whole value leave nothing to send and still close the return', async () => {
    await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 100, returnShippingFeeCents: 0, labels: false, shopperReturns: true })
    const o = await order(ann, { number: 'C-4', lines: [[cheap, 1]] })
    const ask = await requested(await signIn('ann@example.com'), o, [[0, 1]])
    expect(ask.restockingFeeCents).toBe(1500)
    await received(ask.id)
    const sent = refundCalls().length
    const r = await k.M('POST', `${R}/${ask.id}/refund`, {})
    expect(r.json).toMatchObject({ status: 'refunded', refundCents: 0 })
    expect(refundCalls().length).toBe(sent)
    expect((await itemNow(o.items[0].id)).refundedQuantity).toBe(1)
    await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: true })
  })
})

describe('exchange', () => {
  test('a like-for-like exchange sends a zero-charge order, takes its stock, refunds nothing, and is not a sale', async () => {
    const o = await order(ann, { number: 'X-1', lines: [[mug, 1]] })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 1]], { resolution: 'exchange', wanted: 'The blue one please' })
    expect(ask).toMatchObject({ resolution: 'exchange', wanted: 'The blue one please', restockingFeeCents: 0, returnShippingFeeCents: 0 })
    const stats0 = (await k.O('GET', '/api/admin/orders/stats')).json
    expect((await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'MUG-2', quantity: 1 }] })).status).toBe(409) // not received
    await received(ask.id)
    const sent = refundCalls().length
    const blue = await stock(mug2)
    expect((await k.ST('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'MUG-2', quantity: 1 }] })).status).toBe(403)
    const r = await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'MUG-2', quantity: 1 }] })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ status: 'exchanged', refundCents: 0 })
    expect(refundCalls().length).toBe(sent)
    const made = (await db().select().from(k.S.storeOrder).where(eq(k.S.storeOrder.orderNumber, r.json.exchangeOrderNumber)))[0]
    expect(made).toMatchObject({ source: 'exchange', status: 'paid', totalCents: 0, subtotalCents: 2000, contactId: ann.id, customerEmail: 'ann@example.com' })
    expect(made.shippingAddress).toMatchObject({ line1: '1 Main St' })
    expect(await stock(mug2)).toBe(blue! - 1)
    expect((await itemNow(o.items[0].id)).refundedQuantity).toBe(1)
    // It is to be packed, but it is not a sale: the dashboard's sales count and the books do not take it.
    const stats1 = (await k.O('GET', '/api/admin/orders/stats')).json
    expect(stats1.paidCount ?? stats1.stats?.paidCount).toBe(stats0.paidCount ?? stats0.stats?.paidCount)
    expect((await shopper(cookie)('GET', '/returns')).json.data.find((x: any) => x.id === ask.id)).toMatchObject({ status: 'exchanged', exchangeOrderNumber: made.orderNumber })
    // Done once.
    expect((await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'MUG-2', quantity: 1 }] })).status).toBe(409)
    // The replacement order is not itself returnable.
    const cookie2 = await signIn('ann@example.com')
    const listed = (await shopper(cookie2)('GET', '/orders')).json.data.find((x: any) => x.orderNumber === made.orderNumber)
    expect(listed.returnable.open).toBe(false)
  })

  test('the replacement may not cost more; a cheaper one refunds the difference; sold-out and unknown items are refused', async () => {
    const o = await order(ann, { number: 'X-2', lines: [[mug, 1]] })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 1]], { resolution: 'exchange' })
    await received(ask.id)
    const dear = await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'PLATE-1', quantity: 1 }] })
    expect(dear.status).toBe(409)
    expect(dear.json.code).toBe('costs_more')
    expect((await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'NOPE', quantity: 1 }] })).status).toBe(409)
    expect((await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'CUP-1', quantity: 99 }] })).status).toBe(409)
    const sent = refundCalls().length
    const cup = await stock(cheap)
    const r = await k.M('POST', `${R}/${ask.id}/exchange`, { items: [{ sku: 'CUP-1', quantity: 1 }] })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ status: 'exchanged', refundCents: 500 })
    expect(refundCalls().length).toBe(sent + 1)
    expect(refundCalls().at(-1)!.params.get('amount')).toBe('500')
    expect(await stock(cheap)).toBe(cup! - 1)
    expect((await orderNow(o.row.id)).refundedCents).toBe(500)
  })
})

describe('the return label', () => {
  test('with labels on, approval buys one and emails it; a carrier that refuses does not stop the approval; the label is bought once', async () => {
    await db().insert(k.S.shippingConfig).values({ companyId: k.companyId, provider: 'easypost', mode: 'test', connected: true, credentialsEnc: encryptJSON({ apiKey: 'EZTK_test', mode: 'test' }), fromAddress: { ...ADDRESS, name: 'Test Builders' } })
    await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: true, shopperReturns: true })
    const o = await order(ann, { number: 'L-1', lines: [[mug, 3]] })
    const cookie = await signIn('ann@example.com')
    const ask = await requested(cookie, o, [[0, 1]])
    const ok = await k.M('POST', `${R}/${ask.id}/approve`, {})
    expect(ok.json).toMatchObject({ status: 'approved', labelUrl: 'https://labels.test/return-1.png', labelTracking: 'RET-TRK-1', labelCarrier: 'USPS', labelProblem: null })
    await k.settle()
    expect(mailsOf('storeReturnUpdate', 'ann@example.com').at(-1)!.data.labelUrl).toBe('https://labels.test/return-1.png')
    expect((await shopper(cookie)('GET', '/returns')).json.data.find((x: any) => x.id === ask.id).label).toMatchObject({ url: 'https://labels.test/return-1.png', tracking: 'RET-TRK-1' })
    const spent = bought.length
    expect((await k.M('POST', `${R}/${ask.id}/label`, {})).status).toBe(200)
    expect(bought.length).toBe(spent)
    // The carrier refuses: the return is approved all the same, and says why there is no label.
    easypostMode = 'fail'
    const ask2 = await requested(cookie, o, [[0, 1]])
    const second = await k.M('POST', `${R}/${ask2.id}/approve`, {})
    easypostMode = 'ok'
    expect(second.status).toBe(200)
    expect(second.json.status).toBe('approved')
    expect(second.json.labelUrl).toBeNull()
    expect(second.json.labelProblem).toContain('Address could not be verified')
    // …and it can be bought afterwards.
    expect((await k.M('POST', `${R}/${ask2.id}/label`, {})).json.labelUrl).toBe('https://labels.test/return-1.png')
    await k.O('PUT', `${R}/settings`, { windowDays: 30, restockingFeePercent: 10, returnShippingFeeCents: 500, labels: false, shopperReturns: true })
  })
})
