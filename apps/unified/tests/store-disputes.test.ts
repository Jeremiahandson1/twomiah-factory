// Disputes (2026-10-24, the store upgrade): Stripe's charge.dispute.* webhooks, verified by their signature as every
// payment notice is, mark the order disputed and keep the dispute as Stripe last described it; the owner is emailed
// once when one opens (the deadline on the company's clock); the Disputes screen's list is orders:refund.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { STRIPE_WEBHOOK_EVENTS } from '../server/crm/store/checkout/paymentRoutes.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let orderId = ''
// Stripe's Dispute object, as its API reference describes it.
const dispute = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'dp_test_1', object: 'dispute', amount: 4500, currency: 'usd', charge: 'ch_1', payment_intent: 'pi_disputed', reason: 'product_not_received',
  status, livemode: false, evidence_details: { due_by: Math.floor(Date.parse('2026-11-03T05:59:00Z') / 1000), has_evidence: false, past_due: false, submission_count: 0 }, ...extra,
})
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).update(k.S.company).set({ timezone: 'America/Chicago' }).where(eq(k.S.company.id, k.companyId))
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd' })
  await k.connectStripe()
  const [o] = await (k.t.db as any).insert(k.S.storeOrder).values({
    companyId: k.companyId, orderNumber: 'ORD-DISPUTE', provider: 'stripe', providerSessionId: 'cs_disputed', providerPaymentId: 'pi_disputed', status: 'shipped',
    customerEmail: 'ada@example.com', subtotalCents: 4500, totalCents: 4500, currency: 'usd',
  }).returning()
  orderId = o.id
}, 120_000)
afterAll(() => k.restore())

describe('the webhooks', () => {
  test('the store listens for every dispute event', () => {
    for (const e of ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']) expect(STRIPE_WEBHOOK_EVENTS as readonly string[]).toContain(e)
  })

  test('an unsigned notice is refused and writes nothing', async () => {
    const r = await k.webhook('charge.dispute.created', dispute('needs_response'), 't=1,v1=forged')
    expect(r.status).toBe(400)
    expect((await (k.t.db as any).select().from(k.S.storeDispute)).length).toBe(0)
    expect((await k.order(orderId)).disputeStatus).toBeNull()
  })

  test('opened: the order is marked, the dispute kept, the owner emailed once with the deadline on the company clock', async () => {
    expect((await k.webhook('charge.dispute.created', dispute('needs_response'))).status).toBe(200)
    expect((await k.webhook('charge.dispute.created', dispute('needs_response'))).status).toBe(200)
    await k.settle()
    expect((await k.order(orderId)).disputeStatus).toBe('needs_response')
    const rows = await (k.t.db as any).select().from(k.S.storeDispute)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ orderId, amountCents: 4500, reason: 'product_not_received', status: 'needs_response', providerDisputeId: 'dp_test_1' })
    const mails = k.mails.filter((m) => m.template === 'storeDisputeOpened')
    expect(mails.length).toBe(1)
    expect(mails[0].to).toBe('owner@shop.test')
    expect(mails[0].data).toMatchObject({ orderNumber: 'ORD-DISPUTE', amount: '$45.00', reason: 'Product not received', respondUrl: 'https://dashboard.stripe.com/test/disputes/dp_test_1' })
    // 05:59 UTC on 3 November is 11:59 PM on 2 November in Chicago (CST after the clocks go back).
    expect(mails[0].data.dueBy).toBe('Nov 2, 2026, 11:59 PM CST')
  })

  test('updated and closed: the dispute and the order follow it', async () => {
    await k.webhook('charge.dispute.updated', dispute('under_review'))
    expect((await k.order(orderId)).disputeStatus).toBe('under_review')
    await k.webhook('charge.dispute.closed', dispute('lost'))
    expect((await k.order(orderId)).disputeStatus).toBe('lost')
    expect((await (k.t.db as any).select().from(k.S.storeDispute))[0].status).toBe('lost')
    expect(k.mails.filter((m) => m.template === 'storeDisputeOpened').length).toBe(1)
  })
})

describe('the Disputes screen', () => {
  test('is the seats that refund: staff refused; a manager sees the order, reason, deadline and the link to respond', async () => {
    expect((await k.ST('GET', '/api/admin/disputes')).status).toBe(403)
    const r = await k.M('GET', '/api/admin/disputes')
    expect(r.status).toBe(200)
    expect(r.json.data[0]).toMatchObject({ orderId, orderNumber: 'ORD-DISPUTE', reasonLabel: 'Product not received', status: 'lost', respondUrl: 'https://dashboard.stripe.com/test/disputes/dp_test_1' })
    expect(new Date(r.json.data[0].evidenceDueBy).toISOString()).toBe('2026-11-03T05:59:00.000Z')
  })
})
