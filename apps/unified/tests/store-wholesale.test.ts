// Wholesale pricing (2026-10-24, the store upgrade): customer groups with a percent off and per-product prices. The
// storefront has no shopper sign-in, so a group's prices apply to the orders the owner (or a manager) makes for a member
// — a draft order emailed with a link to pay — and never to a guest checkout that merely types a member's email.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { groupPrice } from '../server/crm/store/catalog/groupPricing.ts'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createCheckoutService } from '../server/crm/store/checkout/checkoutService.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let mug: any, shirt: any, member = '', walkIn = '', groupId = ''
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 0 })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000 })
  shirt = await k.product({ slug: 'shirt', name: 'Shirt', sku: 'SHIRT-1', priceCents: 3000 })
  ;[{ id: member }] = await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, type: 'customer', name: 'Cafe Bulk', email: 'buyer@cafe.example' }).returning()
  ;[{ id: walkIn }] = await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, type: 'customer', name: 'Walk In', email: 'walk@in.example' }).returning()
}, 120_000)
afterAll(() => k.restore())

describe('the price rule', () => {
  test("a group's own price wins, else its percent off, rounded to the cent; a gift card is never discounted", () => {
    const g = { percentOff: 20, prices: new Map([['v1', 1500]]) }
    expect(groupPrice(2000, 'v1', g)).toBe(1500)
    expect(groupPrice(2999, 'v2', g)).toBe(2399)
    expect(groupPrice(2000, 'v2', null)).toBe(2000)
    expect(groupPrice(2500, 'v2', g, true)).toBe(2500)
    expect(groupPrice(2000, 'v2', { percentOff: 150, prices: new Map() })).toBe(0)
  })
})

describe('customer groups', () => {
  test('staff read them and may not change them; a manager makes one, adds a customer and an own price', async () => {
    expect((await k.ST('POST', '/api/admin/customer-groups', { name: 'Wholesale', percentOff: 20 })).status).toBe(403)
    const made = await k.M('POST', '/api/admin/customer-groups', { name: 'Wholesale', percentOff: 20 })
    expect(made.status).toBe(201)
    groupId = made.json.id
    expect((await k.M('POST', '/api/admin/customer-groups', { name: 'Wholesale' })).status).toBe(409)
    expect((await k.ST('PUT', `/api/admin/customer-groups/${groupId}/members/${member}`)).status).toBe(403)
    expect((await k.M('PUT', `/api/admin/customer-groups/${groupId}/members/${member}`)).status).toBe(200)
    expect((await k.M('PUT', `/api/admin/customer-groups/${groupId}/prices/${mug.variant.id}`, { priceCents: 1500 })).status).toBe(200)
    const list = await k.ST('GET', '/api/admin/customer-groups')
    expect(list.status).toBe(200)
    expect(list.json.data[0].members.map((m: any) => m.contactId)).toEqual([member])
    expect(list.json.data[0].prices[0]).toMatchObject({ sku: 'MUG-1', priceCents: 1500, catalogueCents: 2000 })
    // The pickers find a customer by name or email, not from a list of every customer.
    const found = await k.M('GET', '/api/admin/orders/customers?q=CAFE')
    expect(found.json.data.map((c: any) => c.id)).toEqual([member])
    expect((await k.M('GET', '/api/admin/orders/customers?q=%25')).json.data.length).toBe(0)
  })
})

describe('an order made for a member', () => {
  let orderId = '', payUrl = ''
  test('is priced at the group: the own price, then the percent; emailed with a link to pay; staff may not make one', async () => {
    const body = { contactId: member, items: [{ sku: 'MUG-1', quantity: 2 }, { sku: 'SHIRT-1', quantity: 1 }] }
    expect((await k.ST('POST', '/api/admin/draft-orders', body)).status).toBe(403)
    const before = k.stripe.calls.length
    const r = await k.M('POST', '/api/admin/draft-orders', body)
    expect(r.status).toBe(201)
    expect(r.json.group.name).toBe('Wholesale')
    expect(k.stripe.calls.length).toBe(before) // no payment page until the customer opens the link
    orderId = r.json.order.id
    const items = await (k.t.db as any).select().from(k.S.storeOrderItem).where(eq(k.S.storeOrderItem.orderId, orderId))
    expect(Object.fromEntries(items.map((i: any) => [i.sku, i.unitPriceCents]))).toEqual({ 'MUG-1': 1500, 'SHIRT-1': 2400 })
    const o = await k.order(orderId)
    expect(o.subtotalCents).toBe(5400)
    expect(o.totalCents).toBe(5900)
    expect(o.source).toBe('draft')
    expect(o.customerGroupId).toBe(groupId)
    expect(o.contactId).toBe(member)
    const mail = k.mails.find((m) => m.template === 'storeInvoice')!
    expect(mail.to).toBe('buyer@cafe.example')
    payUrl = mail.data.payUrl
    expect(payUrl).toContain('/api/public/recover/')
  })

  test('the link opens a payment page at the group prices, each time it is opened', async () => {
    const path = new URL(payUrl).pathname
    const r = await k.pub('GET', path)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toContain('checkout.stripe.com')
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('line_items[0][price_data][unit_amount]')).toBe('1500')
    expect(call.params.get('line_items[1][price_data][unit_amount]')).toBe('2400')
    expect((await k.pub('GET', path)).status).toBe(302)
    const again = await k.M('POST', `/api/admin/draft-orders/${orderId}/send`)
    expect(again.status).toBe(200)
  })

  test('is never reminded as an abandoned cart nor written off by the stale-cart sweep', async () => {
    await (k.t.db as any).update(k.S.storeOrder).set({ createdAt: new Date(Date.now() - 8 * 86400_000) }).where(eq(k.S.storeOrder.id, orderId))
    const deps: any = { db: k.t.db, audit: k.t.services.audit, logger: { info() {}, warn() {}, error() {} }, permissions: k.t.services.permissions, services: k.t.services.crm }
    const svc = createCheckoutService(deps, createStoreCore(deps))
    await svc.sweepAbandonedCarts()
    await svc.sweepStalePending()
    expect(k.mails.some((m) => m.template === 'storeAbandonedCart')).toBe(false)
    expect((await k.order(orderId)).status).toBe('pending')
  })

  test('a customer in no group pays the shop prices; a guest typing a member\'s email at checkout does too', async () => {
    const r = await k.O('POST', '/api/admin/draft-orders', { contactId: walkIn, items: [{ sku: 'MUG-1', quantity: 1 }], send: false })
    expect(r.status).toBe(201)
    expect(r.json.group).toBeNull()
    expect(r.json.order.subtotalCents).toBe(2000)
    const guest = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'buyer@cafe.example' })
    expect(guest.status).toBe(200)
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('line_items[0][price_data][unit_amount]')).toBe('2000')
  })
})
