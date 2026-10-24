// Gift cards for the store (2026-10-24, the store upgrade), on the bar's ledger (one per company):
//   · sold as a product (kind gift_card): no shipping, issued and emailed as a code when the order is paid, once;
//   · redeemed at checkout for part of an order: held on the card when checkout starts, the provider told to charge the
//     rest, never leaving less than Stripe's smallest charge; a hold that is never paid (written off, or cancelled) goes
//     back on the card once;
//   · refunded back to the card it came off, in proportion to what it paid, never twice;
//   · the back office's cards are orders:refund (manager and owner), not staff's.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createCheckoutService } from '../server/crm/store/checkout/checkoutService.ts'
import { cardShare, cardShareOfRefund } from '../server/crm/store/giftCards.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let svc: ReturnType<typeof createCheckoutService>
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 0 })
  await k.connectStripe()
  await k.product({ slug: 'gift-card', name: 'Gift card', sku: 'GIFT-25', priceCents: 2500, kind: 'gift_card', qty: null })
  await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000 })
  const deps: any = { db: k.t.db, audit: k.t.services.audit, logger: { info() {}, warn() {}, error() {} }, permissions: k.t.services.permissions, services: k.t.services.crm }
  svc = createCheckoutService(deps, createStoreCore(deps))
}, 120_000)
afterAll(() => k.restore())

const sid = (url: string) => new URL(url).pathname.split('/').pop()!
const card = async (code: string) => (await (k.t.db as any).select().from(k.S.barGiftCard).where(and(eq(k.S.barGiftCard.companyId, k.companyId), eq(k.S.barGiftCard.code, code))))[0]
const ledger = async (cardId: string) => (k.t.db as any).select().from(k.S.barGiftCardLedger).where(eq(k.S.barGiftCardLedger.cardId, cardId))

describe('the rules', () => {
  test('a card pays what is left to pay, at most its balance, never leaving a sliver under the provider minimum (all of it is fine)', () => {
    expect(cardShare(2500, 4500)).toBe(2500)
    expect(cardShare(9000, 4500)).toBe(4500) // covers it all: nothing for the provider to take
    expect(cardShare(4499, 4500, 1)).toBe(4499)
    expect(cardShare(4480, 4500)).toBe(4450)
    expect(cardShare(0, 4500)).toBe(0)
  })
  test('a part refund gives the card its share of what it paid; never more than it paid', () => {
    expect(cardShareOfRefund({ totalCents: 4500, giftCardCents: 2500 }, 900)).toBe(500)
    expect(cardShareOfRefund({ totalCents: 4500, giftCardCents: 2500 }, 9000)).toBe(2500)
    expect(cardShareOfRefund({ totalCents: 4500, giftCardCents: 0 }, 900)).toBe(0)
  })
})

let code = ''
describe('selling a gift card', () => {
  test('no shipping; paid, it is issued and emailed once, whichever notice comes first', async () => {
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'GIFT-25', quantity: 1 }], customerEmail: 'gifter@example.com' })
    expect(r.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('shipping_address_collection[allowed_countries][0]')).toBeNull()
    const o = await k.orderBySession(sid(r.json.url))
    expect(o.fulfillment).toBe('digital')
    expect(o.shippingCents).toBe(0)
    expect(o.totalCents).toBe(2500)
    k.stripe.sessions.set(o.providerSessionId, paidSession(o.providerSessionId, { amountTotal: 2500, email: 'gifter@example.com', shipping: false }))
    await k.webhook('checkout.session.completed', k.stripe.sessions.get(o.providerSessionId))
    await k.pub('GET', `/api/public/order-summary?session_id=${o.providerSessionId}`)
    await k.webhook('checkout.session.completed', k.stripe.sessions.get(o.providerSessionId))
    await k.settle()
    const issued = await (k.t.db as any).select().from(k.S.barGiftCard).where(eq(k.S.barGiftCard.orderId, o.id))
    expect(issued.length).toBe(1)
    expect(issued[0].balanceCents).toBe(2500)
    const mails = k.mails.filter((m) => m.template === 'storeGiftCard')
    expect(mails.length).toBe(1)
    expect(mails[0].to).toBe('gifter@example.com')
    expect(mails[0].data.cards[0].code).toBe(issued[0].code)
    code = issued[0].code
    const bal = await k.pub('GET', `/api/public/gift-cards/balance?code=${encodeURIComponent(code.toLowerCase())}`)
    expect(bal.json).toEqual({ code, balanceCents: 2500 })
    expect((await k.pub('GET', '/api/public/gift-cards/balance?code=NOPE-0000-0000')).status).toBe(404)
  })
})

let paidId = ''
describe('paying with a gift card', () => {
  test('part of an order: held when checkout starts, the provider charges the rest; a gift card cannot buy a gift card', async () => {
    const only = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'GIFT-25', quantity: 1 }], customerEmail: 'ada@example.com', giftCardCode: code })
    expect(only.status).toBe(400)
    expect(only.json.code).toBe('gift_card')
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], customerEmail: 'ada@example.com', giftCardCode: code })
    expect(r.status).toBe(200)
    expect(k.stripe.last('/v1/coupons')!.params.get('amount_off')).toBe('2500')
    const o = await k.orderBySession(sid(r.json.url))
    expect(o.giftCardCents).toBe(2500)
    expect(o.totalCents).toBe(4500)
    expect((await card(code)).balanceCents).toBe(0)
    const moves = await ledger((await card(code)).id)
    expect(moves.find((m: any) => m.kind === 'redeem' && m.orderId === o.id).amountCents).toBe(-2500)
    // A second checkout on the empty card is told so.
    expect((await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'ada@example.com', giftCardCode: code })).json.code).toBe('gift_card')
    await k.webhook('checkout.session.completed', paidSession(o.providerSessionId, { amountTotal: 2000 }))
    await k.settle()
    const paid = await k.order(o.id)
    expect(paid.status).toBe('paid')
    expect(paid.totalCents).toBe(4500)
    paidId = o.id
    const receipt = await k.pub('GET', `/api/public/order-summary?ref=${o.id}`)
    expect(receipt.json.giftCardCents).toBe(2500)
  })

  test('refunded back the way it was paid: the card gets its share, Stripe the rest, and a retry pays neither twice', async () => {
    const part = await k.O('POST', `/api/admin/orders/${paidId}/refunds`, { items: [], shippingCents: 0, amountCents: 900, restock: false })
    expect(part.status).toBe(200)
    expect(k.stripe.last('/v1/refunds')!.params.get('amount')).toBe('400')
    expect((await card(code)).balanceCents).toBe(500)
    expect((await k.order(paidId)).giftCardRefundedCents).toBe(500)
    const rest = await k.O('PATCH', `/api/admin/orders/${paidId}/status`, { status: 'refunded' })
    expect(rest.status).toBe(200)
    expect(k.stripe.last('/v1/refunds')!.params.get('amount')).toBe('1600')
    const after = await card(code)
    expect(after.balanceCents).toBe(2500)
    const backs = (await ledger(after.id)).filter((m: any) => m.kind === 'refund')
    expect(backs.map((m: any) => m.amountCents).sort()).toEqual([2000, 500])
    expect((await k.order(paidId)).giftCardRefundedCents).toBe(2500)
  })

  test('a hold never paid goes back on the card once: the owner cancelling it, or the sweep writing it off', async () => {
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], customerEmail: 'ada@example.com', giftCardCode: code })
    const o = await k.orderBySession(sid(r.json.url))
    expect(o.giftCardCents).toBe(2500)
    expect((await card(code)).balanceCents).toBe(0)
    const cancel = await k.O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'cancelled' })
    expect(cancel.status).toBe(200)
    expect((await card(code)).balanceCents).toBe(2500)
    const r2 = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], customerEmail: 'ada@example.com', giftCardCode: code })
    const o2 = await k.orderBySession(sid(r2.json.url))
    await (k.t.db as any).update(k.S.storeOrder).set({ createdAt: new Date(Date.now() - 26 * 3600_000) }).where(eq(k.S.storeOrder.id, o2.id))
    await svc.sweepStalePending()
    await svc.sweepStalePending()
    expect((await k.order(o2.id)).status).toBe('cancelled')
    expect((await card(code)).balanceCents).toBe(2500)
    expect((await ledger((await card(code)).id)).filter((m: any) => m.kind === 'release').length).toBe(2)
  })

  test('a card that covers the order pays it outright (and a refund goes back on it); one that would leave a sliver leaves 50¢', async () => {
    const big = await k.O('POST', '/api/admin/gift-cards', { cents: 3000 })
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'ada@example.com', giftCardCode: big.json.code })
    expect(r.json.paidByGiftCard).toBe(true)
    const id = new URL(r.json.url).searchParams.get('ref')!
    const o = await k.order(id)
    expect(o.status).toBe('paid')
    expect(o.provider).toBe('giftcard')
    expect(o.giftCardCents).toBe(2500)
    expect((await card(big.json.code)).balanceCents).toBe(500)
    const back = await k.O('PATCH', `/api/admin/orders/${id}/status`, { status: 'refunded' })
    expect(back.status).toBe(200)
    expect(back.json.refund.kind).toBe('refunded')
    expect((await card(big.json.code)).balanceCents).toBe(3000)
    const odd = await k.O('POST', '/api/admin/gift-cards', { cents: 2480 })
    const r2 = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'ada@example.com', giftCardCode: odd.json.code })
    expect((await k.orderBySession(sid(r2.json.url))).giftCardCents).toBe(2450)
  })
})

describe('the back office', () => {
  test('staff are refused; a manager lists, issues and voids', async () => {
    expect((await k.ST('GET', '/api/admin/gift-cards')).status).toBe(403)
    const list = await k.M('GET', '/api/admin/gift-cards')
    expect(list.status).toBe(200)
    expect(list.json.data.some((c: any) => c.code === code)).toBe(true)
    const made = await k.M('POST', '/api/admin/gift-cards', { cents: 1000, recipientEmail: 'friend@example.com' })
    expect(made.status).toBe(201)
    expect(k.mails.some((m) => m.template === 'storeGiftCard' && m.to === 'friend@example.com')).toBe(true)
    expect((await k.M('POST', `/api/admin/gift-cards/${made.json.id}/void`, { reason: 'Test' })).status).toBe(200)
    expect((await k.M('POST', `/api/admin/gift-cards/${made.json.id}/void`, { reason: 'Again' })).status).toBe(409)
  })
})
