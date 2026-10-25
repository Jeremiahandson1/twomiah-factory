// Local pickup (2026-10-24, the store upgrade): offered at checkout with the shop's pickup address and hours and no
// shipping charge; the order moves paid → ready for pickup (the customer is emailed where and when) → picked up, and is
// never shipped — nor a posted order made "ready for pickup". Pickup is set by whoever sets shipping (a manager too).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 700, taxRateBps: 500 })
  await k.connectStripe()
  await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000 })
}, 120_000)
afterAll(() => k.restore())

const sid = (url: string) => new URL(url).pathname.split('/').pop()!
const pay = async (session: string, amount: number) => { await k.webhook('checkout.session.completed', paidSession(session, { amountTotal: amount, shipping: false })); await k.settle() }

describe('setting pickup up', () => {
  test('needs an address; a manager may set it (as shipping), staff may not; a store without it refuses a pickup checkout', async () => {
    const refused = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], delivery: 'pickup' })
    expect(refused.status).toBe(400)
    expect(refused.json.code).toBe('no_pickup')
    const noAddress = await k.M('PATCH', '/api/admin/settings', { pickupEnabled: true })
    expect(noAddress.status).toBe(400)
    expect(noAddress.json.fields.pickupAddress).toBeTruthy()
    expect((await k.ST('PATCH', '/api/admin/settings', { pickupEnabled: true, pickupAddress: '1 Shop St' })).status).toBe(403)
    const ok = await k.M('PATCH', '/api/admin/settings', { pickupEnabled: true, pickupAddress: '12 Water St\nEau Claire, WI', pickupHours: 'Mon–Sat 10–6' })
    expect(ok.status).toBe(200)
    expect((await k.pub('GET', '/api/public/settings')).json.pickup).toEqual({ address: '12 Water St\nEau Claire, WI', hours: 'Mon–Sat 10–6' })
  })
})

describe('a pickup order', () => {
  let id = ''
  test('charges no shipping and asks Stripe for no shipping address', async () => {
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], customerEmail: 'ada@example.com', delivery: 'pickup', shipTo: { country: 'US', state: 'WI' } })
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('shipping_address_collection[allowed_countries][0]')).toBeNull()
    expect(call.params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBeNull()
    const o = await k.orderBySession(sid(r.json.url))
    expect(o.fulfillment).toBe('pickup')
    expect(o.shippingCents).toBe(0)
    expect(o.totalCents).toBe(4000 + 200)
    id = o.id
    await pay(o.providerSessionId, o.totalCents)
    expect((await k.order(id)).status).toBe('paid')
    const receipt = await k.pub('GET', `/checkout/success?ref=${id}`)
    expect(receipt.text).toContain('Pick up from')
    expect(receipt.text).toContain('12 Water St')
  })

  test('is never shipped: staff mark it ready (the customer is emailed where and when), then picked up', async () => {
    const shipped = await k.ST('PATCH', `/api/admin/orders/${id}/status`, { status: 'shipped' })
    expect(shipped.status).toBe(409)
    expect(shipped.json.code).toBe('wrong_fulfillment')
    expect((await k.ST('PATCH', `/api/admin/orders/${id}/fulfillment`, { markShipped: true })).json.code).toBe('wrong_fulfillment')
    const ready = await k.ST('PATCH', `/api/admin/orders/${id}/status`, { status: 'ready_for_pickup' })
    expect(ready.status).toBe(200)
    await k.settle()
    const mail = k.mails.find((m) => m.template === 'storeReadyForPickup')!
    expect(mail.to).toBe('ada@example.com')
    expect(mail.data.pickupAddress).toContain('12 Water St')
    expect(mail.data.pickupHours).toBe('Mon–Sat 10–6')
    const done = await k.ST('PATCH', `/api/admin/orders/${id}/status`, { status: 'picked_up' })
    expect(done.status).toBe(200)
    const o = await k.order(id)
    expect(o.status).toBe('picked_up')
    expect(o.readyForPickupAt).toBeTruthy()
    expect(o.pickedUpAt).toBeTruthy()
    // Picked up is where it ends, short of a refund.
    expect((await k.O('PATCH', `/api/admin/orders/${id}/status`, { status: 'ready_for_pickup' })).status).toBe(409)
  })

  test('a posted order is never made ready for pickup', async () => {
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'bo@example.com' })
    const o = await k.orderBySession(sid(r.json.url))
    expect(o.fulfillment).toBe('ship')
    expect(o.shippingCents).toBe(700)
    await pay(o.providerSessionId, o.totalCents)
    const wrong = await k.ST('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'ready_for_pickup' })
    expect(wrong.status).toBe(409)
    expect(wrong.json.code).toBe('wrong_fulfillment')
  })

  test('with Stripe Tax on, a pickup asks for the billing address so the tax has an address', async () => {
    await (k.t.db as any).update(k.S.storeSettings).set({ stripeTaxEnabled: true }).where(eq(k.S.storeSettings.companyId, k.companyId))
    await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'cy@example.com', delivery: 'pickup' })
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('automatic_tax[enabled]')).toBe('true')
    expect(call.params.get('billing_address_collection')).toBe('required')
  })
})
