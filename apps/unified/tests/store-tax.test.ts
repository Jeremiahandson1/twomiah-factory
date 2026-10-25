// Sales tax by location (2026-10-24, the store upgrade): Stripe Tax on the checkout session, the shipping address
// required, and the tax Stripe charged written on the order, the receipt and the confirmation email; the store's flat
// rate only where Stripe Tax is off. Switching it on is the owner's, and only once Stripe says its tax settings are
// active. Stripe's API is answered by tests/storeKit.ts as Stripe documents it.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 825 })
  await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000 })
}, 120_000)
afterAll(() => k.restore())

const checkout = (extra: Record<string, unknown> = {}) => k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], customerEmail: 'ada@example.com', ...extra })

describe('switching Stripe Tax on', () => {
  test('refused without Stripe, refused while Stripe says its tax settings are not active, then saved; never by a manager', async () => {
    const none = await k.O('PATCH', '/api/admin/settings', { stripeTaxEnabled: true })
    expect(none.status).toBe(409)
    expect(none.json.code).toBe('stripe_tax_not_ready')
    await k.connectStripe()
    k.stripe.state.taxStatus = 'pending'
    const pending = await k.O('PATCH', '/api/admin/settings', { stripeTaxEnabled: true })
    expect(pending.status).toBe(409)
    expect(pending.json.error).toContain('Settings › Tax')
    const status = await k.O('GET', '/api/admin/settings/stripe-tax')
    expect(status.json).toEqual({ provider: 'stripe', status: 'pending' })
    k.stripe.state.taxStatus = 'active'
    const manager = await k.M('PATCH', '/api/admin/settings', { stripeTaxEnabled: true })
    expect(manager.status).toBe(403)
    const ok = await k.O('PATCH', '/api/admin/settings', { stripeTaxEnabled: true })
    expect(ok.status).toBe(200)
    expect(ok.json.stripeTaxEnabled).toBe(true)
    // The storefront says tax is worked out at checkout.
    expect((await k.pub('GET', '/api/public/settings')).json.automaticTax).toBe(true)
  })
})

describe('a checkout with Stripe Tax', () => {
  let orderId = ''
  test('asks Stripe for automatic_tax with every price tax-exclusive, the shipping address required, and no flat tax line', async () => {
    const r = await checkout()
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('automatic_tax[enabled]')).toBe('true')
    expect(call.params.get('shipping_address_collection[allowed_countries][0]')).toBe('US')
    expect(call.params.get('line_items[0][price_data][tax_behavior]')).toBe('exclusive')
    expect(call.params.get('shipping_options[0][shipping_rate_data][tax_behavior]')).toBe('exclusive')
    // Only the mug: no "Sales tax" line of the store's own.
    expect(call.params.get('line_items[1][price_data][product_data][name]')).toBeNull()
    const sid = new URL(r.json.url).pathname.split('/').pop()!
    const o = await k.orderBySession(sid)
    expect(o.taxAutomatic).toBe(true)
    expect(o.taxCents).toBe(0)
    expect(o.totalCents).toBe(4500)
    orderId = o.id
  })

  test('the paid session writes the tax Stripe charged on the order, the receipt and the confirmation', async () => {
    const o = await k.order(orderId)
    const session = paidSession(o.providerSessionId, { amountTotal: 4500 + 248, tax: 248 })
    const hook = await k.webhook('checkout.session.completed', session)
    expect(hook.status).toBe(200)
    await k.settle()
    const paid = await k.order(orderId)
    expect(paid.status).toBe('paid')
    expect(paid.taxCents).toBe(248)
    expect(paid.totalCents).toBe(4748)
    const receipt = await k.pub('GET', `/api/public/order-summary?session_id=${o.providerSessionId}`)
    expect(receipt.json.taxCents).toBe(248)
    expect(receipt.json.taxAutomatic).toBe(true)
    expect(receipt.json.totalCents).toBe(4748)
    const mail = k.mails.find((m) => m.template === 'storeOrderConfirmation')!
    expect(mail.data.order.taxCents).toBe(248)
    const page = await k.pub('GET', `/checkout/success?session_id=${o.providerSessionId}`)
    expect(page.text).toContain('Sales tax')
    expect(page.text).toContain('$2.48')
  })

  test('a webhook without a good signature is refused and changes nothing', async () => {
    const r = await k.webhook('checkout.session.completed', paidSession('cs_forged', { amountTotal: 1 }), 't=1,v1=bad')
    expect(r.status).toBe(400)
  })
})

describe('Stripe Tax off', () => {
  test('the store\'s own rate is charged as its own line, and Stripe is not asked to work tax out', async () => {
    const off = await k.O('PATCH', '/api/admin/settings', { stripeTaxEnabled: false })
    expect(off.status).toBe(200)
    const r = await checkout()
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('automatic_tax[enabled]')).toBeNull()
    expect(call.params.get('line_items[1][price_data][product_data][name]')).toBe('Sales tax')
    expect(call.params.get('line_items[1][price_data][unit_amount]')).toBe('330')
    const o = await k.orderBySession(new URL(r.json.url).pathname.split('/').pop()!)
    expect(o.taxAutomatic).toBe(false)
    expect(o.taxCents).toBe(330)
    expect(o.totalCents).toBe(4000 + 500 + 330)
    const [s] = await (k.t.db as any).select().from(k.S.storeSettings).where(eq(k.S.storeSettings.companyId, k.companyId))
    expect(s.stripeTaxEnabled).toBe(false)
  })
})
