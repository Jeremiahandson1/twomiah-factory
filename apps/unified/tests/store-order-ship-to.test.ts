// Where an order made for a customer ships (live test 11/11: a phone order paid in person had no address, so no label could be
// bought for it — only the online checkout set one). Shopify's draft order takes a shipping address, the customer's own by
// default; an order not yet on its way can have its address changed (server/crm/store/orders/shipTo.ts).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, desc, eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let saved = '', bare = ''
const ADDR = { name: 'Lee Parcel', line1: '12 Pine St', line2: 'Apt 3', city: 'Akron', state: 'oh', postalCode: '44301', country: 'us', phone: '3305550100' }

beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 0, pickupEnabled: true })
  await k.product({ slug: 'mug', name: 'Ceramic Mug', sku: 'MUG-11', priceCents: 1200, qty: 50 })
  ;[{ id: saved }] = await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, type: 'customer', name: 'Sam Saved', email: 'sam@home.example', phone: '7155550101', address: '9 Oak Ave', city: 'Eau Claire', state: 'WI', zip: '54701' }).returning()
  ;[{ id: bare }] = await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, type: 'customer', name: 'Bea Bare', email: 'bea@home.example' }).returning()
}, 120_000)
afterAll(() => k.restore())

const draft = (extra: Record<string, unknown>) => k.M('POST', '/api/admin/draft-orders', { items: [{ sku: 'MUG-11', quantity: 1 }], paidInPerson: 'card', send: false, ...extra })
const lastLog = async (orderId: string) => {
  const [row] = await (k.t.db as any).select().from(k.S.auditLog).where(and(eq(k.S.auditLog.entityId, orderId), eq(k.S.auditLog.entity, 'order'))).orderBy(desc(k.S.auditLog.createdAt)).limit(1)
  return (row?.metadata as any)?.description as string
}

describe('an order made for a customer takes where it ships', () => {
  test('the address given is kept (state and country in capitals); the label can be bought for it', async () => {
    const r = await draft({ contactId: bare, shippingAddress: ADDR })
    expect(r.status).toBe(201)
    const o = await k.order(r.json.order.id)
    expect(o.status).toBe('paid')
    expect(o.shippingAddress).toEqual({ name: 'Lee Parcel', line1: '12 Pine St', line2: 'Apt 3', city: 'Akron', state: 'OH', postalCode: '44301', country: 'US', phone: '3305550100' })
  })

  test('none given: the customer\'s saved address, under their name; a customer with none has none', async () => {
    const a = await k.order((await draft({ contactId: saved })).json.order.id)
    expect(a.shippingAddress).toEqual({ name: 'Sam Saved', line1: '9 Oak Ave', city: 'Eau Claire', state: 'WI', postalCode: '54701', country: 'US', phone: '7155550101' })
    const b = await k.order((await draft({ contactId: bare })).json.order.id)
    expect(b.shippingAddress).toBeNull()
    // Pickup goes nowhere.
    const p = await k.order((await draft({ contactId: saved, delivery: 'pickup' })).json.order.id)
    expect(p.shippingAddress).toBeNull()
  })

  test('an address with a part missing is refused, and says which', async () => {
    const r = await draft({ contactId: bare, shippingAddress: { ...ADDR, city: '' } })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.json)).toContain('Enter the city')
  })

  test('paid by the link: the payment page that asks for no address keeps the one staff gave, and the customer\'s name', async () => {
    await k.connectStripe()
    const r = await k.M('POST', '/api/admin/draft-orders', { contactId: bare, items: [{ sku: 'MUG-11', quantity: 1 }], shippingAddress: ADDR, send: false })
    expect(r.status).toBe(201)
    expect((await k.pub('GET', new URL(r.json.payUrl).pathname)).status).toBe(302)
    const pending = await k.order(r.json.order.id)
    const s = paidSession(pending.providerSessionId, { amountTotal: pending.totalCents, email: 'bea@home.example', shipping: false })
    ;(s as any).customer_details.name = null
    ;(s as any).customer_details.phone = null
    expect((await k.webhook('checkout.session.completed', s)).status).toBe(200)
    const paid = await k.order(r.json.order.id)
    expect(paid.status).toBe('paid')
    expect(paid.shippingAddress).toMatchObject({ line1: '12 Pine St', city: 'Akron', state: 'OH' })
    expect(paid.customerName).toBe('Bea Bare')
  })
})

describe('an order\'s address is changed until it is on its way', () => {
  test('added, then changed, by whoever may update orders; logged; refused once shipped, with a label, or for pickup', async () => {
    const id = (await draft({ contactId: bare })).json.order.id
    const put = (who: 'M' | 'ST' | 'O', body: unknown, oid = id) => k[who]('PUT', `/api/admin/orders/${oid}/shipping-address`, body)
    const added = await put('M', ADDR)
    expect(added.status).toBe(200)
    expect(added.json.order.shippingAddress).toMatchObject({ line1: '12 Pine St', state: 'OH' })
    expect(await lastLog(id)).toBe('Ship-to address added: 12 Pine St, Akron, OH 44301')
    const moved = await put('M', { ...ADDR, line1: '40 Elm Rd', line2: null })
    expect(moved.status).toBe(200)
    expect((await k.order(id)).shippingAddress).toEqual({ name: 'Lee Parcel', line1: '40 Elm Rd', city: 'Akron', state: 'OH', postalCode: '44301', country: 'US', phone: '3305550100' })
    expect(await lastLog(id)).toBe('Ship-to address changed: 40 Elm Rd, Akron, OH 44301')
    expect((await put('M', { ...ADDR, postalCode: '' })).status).toBe(400)

    await (k.t.db as any).update(k.S.storeOrder).set({ labelUrl: 'https://labels.test/x.png' }).where(eq(k.S.storeOrder.id, id))
    expect((await put('M', ADDR)).json.code).toBe('label_bought')
    await (k.t.db as any).update(k.S.storeOrder).set({ labelUrl: null, status: 'shipped' }).where(eq(k.S.storeOrder.id, id))
    expect((await put('M', ADDR)).json.code).toBe('ship_to_locked')

    const pickup = (await draft({ contactId: saved, delivery: 'pickup' })).json.order.id
    expect((await put('M', ADDR, pickup)).json.code).toBe('not_shipping')
    expect((await put('M', ADDR, 'nope')).status).toBe(404)
  })
})
