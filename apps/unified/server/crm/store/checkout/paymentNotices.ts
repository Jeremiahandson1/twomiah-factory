// A payment provider's word on an order — paid, refunded, a refund failed, a chargeback — applied once, whichever door it
// came through (owner's decision, 2026-10-26: the store takes Stripe on the business's CONNECTED account, as the rest of
// the app does):
//   · the store's own webhook, POST /api/public/webhooks/payment (./publicRoutes.ts) — Square, PayPal, and a store
//     still on the Stripe keys it pasted before Connect; the provider's signature is checked there;
//   · the Factory's Connect forwarder, POST /api/stripe/factory-event (the shared Stripe module) — a Stripe event on the
//     business's connected account; the Factory checked Stripe's signature and the Factory→tenant key vouches for the
//     forward. `claim` takes the events that are the store's (they name one of its orders) and leaves the rest to the
//     invoices.
// One rule for both: an order is Paid only on the provider's own word, by finalizeOrder (idempotent — a notice delivered
// twice pays, mails and counts once); refunds and refund failures go to the orders group's hooks; disputes to
// orders/disputes.ts.
import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { storeOrder } from '../../../db/schema/store.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import type { WebhookResult } from '../payments/types.ts'
import { parseStripeEvent } from '../payments/stripe.ts'
import { createStoreDisputes } from '../orders/disputes.ts'
import { siteBase, type CheckoutService } from './checkoutService.ts'
import type { OrderHooks } from './publicRoutes.ts'

/** Applied; or the orders group is not wired yet, so the notice must be refused and the provider send it again. */
export type NoticeOutcome = 'done' | 'retry'

export function createPaymentNotices(d: CrmDeps, core: StoreCore, checkout: CheckoutService, orders?: OrderHooks) {
  const { db, logger } = d
  const disputes = createStoreDisputes(d, core)

  /** The provider's word, applied. `origin` is where the owner's dispute email links back to. */
  async function apply(companyId: string, provider: string, result: WebhookResult, origin: string): Promise<NoticeOutcome> {
    // A notice naming one refund is first matched to the store's own (its echo is never counted twice; a refund the
    // provider was holding is settled, or given back on a failure). Anything else is a dashboard refund, by running
    // total. Both are the orders group's; until it is wired the notice is refused so the provider sends it again.
    if (result.type === 'refund_failed' || (result.type === 'refunded' && result.providerPaymentId)) {
      if (!orders) return 'retry'
      if (result.type === 'refund_failed') {
        const outcome = result.providerRefundId ? await orders.applyRefundUpdate(companyId, provider, result.providerRefundId, 'failed', result.refundFailureReason) : 'unknown'
        logger.info('[store] refund failure notification', { outcome })
        return 'done'
      }
      const ours = result.providerRefundId ? await orders.applyRefundUpdate(companyId, provider, result.providerRefundId, 'completed') : 'unknown'
      const outcome = ours !== 'unknown' ? ours : await orders.applyProviderRefund(companyId, provider, result.providerPaymentId!, result.amountRefundedCents ?? 0, result.amountTotalCents ?? 0)
      logger.info('[store] refund notification', { outcome })
      return 'done'
    }
    // A chargeback: the order is marked disputed and the owner told (orders/disputes.ts).
    if (result.type === 'dispute' && result.dispute) {
      const outcome = await disputes.apply(companyId, provider, result.dispute, origin)
      logger.info('[store] dispute notification', { outcome })
      return 'done'
    }
    if (result.type !== 'paid' || !result.providerSessionId) return 'done'

    const [order] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.provider, provider), eq(storeOrder.providerSessionId, result.providerSessionId)))
      .limit(1)
    if (!order) {
      logger.warn('[store] webhook for unknown session', { session: result.providerSessionId })
      return 'done'
    }
    await checkout.finalizeOrder(order, result)
    return 'done'
  }

  /** Does this notice name one of the store's own Stripe orders (by its Checkout Session, or by its payment)? */
  async function namesAnOrder(companyId: string, result: WebhookResult): Promise<boolean> {
    const mine = and(eq(storeOrder.companyId, companyId), eq(storeOrder.provider, 'stripe'))
    const by = result.type === 'paid' && result.providerSessionId ? eq(storeOrder.providerSessionId, result.providerSessionId)
      : result.type === 'refunded' && result.providerPaymentId ? eq(storeOrder.providerPaymentId, result.providerPaymentId)
        : result.type === 'dispute' && result.dispute?.providerPaymentId ? eq(storeOrder.providerPaymentId, result.dispute.providerPaymentId)
          : null
    if (!by) return false
    const [row] = await db.select({ id: storeOrder.id }).from(storeOrder).where(and(mine, by)).limit(1)
    return !!row
  }

  /**
   * A Stripe event on the business's connected account, forwarded by the Factory: the store's when it names one of the
   * store's orders, applied here exactly as the store's own webhook applies it; anything else is null — not ours, the
   * invoices' handling takes it. A notice that cannot be applied yet throws, so Stripe sends it again.
   */
  async function claim(event: Stripe.Event, stripeAccount: string): Promise<Record<string, unknown> | null> {
    const co = await core.shop()
    if (!co) return null
    const result = parseStripeEvent(event)
    if (result.type === 'ignored' || !(await namesAnOrder(co.id, result))) return null
    if ((await apply(co.id, 'stripe', result, siteBase())) === 'retry') throw new Error('The store\'s orders are not ready to take this notice yet')
    logger.info('[store] connected-account notice', { type: event.type, connected: !!stripeAccount })
    return { handled: true, store: true }
  }

  return { apply, claim }
}
export type PaymentNotices = ReturnType<typeof createPaymentNotices>
