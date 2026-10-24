// Chargebacks (2026-10-24, the store upgrade). Stripe's charge.dispute.* webhooks — verified with the signature like
// every other payment notice (checkout/publicRoutes.ts) — are kept here as Stripe last described each dispute: its
// amount, reason, status and the deadline for evidence. The order it is for is marked with the dispute's status
// (orders.dispute_status), the owner is emailed when one opens, and the Disputes screen lists them with a link to answer
// in Stripe's dashboard (the evidence is sent there; the store does not upload it).
//
// GET /api/admin/disputes is orders:refund — a chargeback is money leaving the shop, the manager's and the owner's,
// the same seats that refund. The menu item asks the same.
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { companyTimeZone } from '@twomiah/tenant-backend'
import { storeDispute, storeOrder } from '../../../db/schema/store.ts'
import type { AppEnv } from '../../../http/env.ts'
import { listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import type { DisputeNotice } from '../payments/types.ts'

/** Where the owner answers a dispute: Stripe's dashboard page for it (the test-mode one for a test-mode dispute). */
export const stripeDisputeUrl = (id: string, livemode: boolean) => `https://dashboard.stripe.com/${livemode ? '' : 'test/'}disputes/${encodeURIComponent(id)}`

/** Stripe's reason codes, in words. */
const REASONS: Record<string, string> = {
  fraudulent: 'Fraudulent', product_not_received: 'Product not received', product_unacceptable: 'Product unacceptable',
  duplicate: 'Duplicate charge', subscription_canceled: 'Subscription cancelled', unrecognized: 'Unrecognised charge',
  credit_not_processed: 'Credit not processed', general: 'General', incorrect_account_details: 'Incorrect account details',
  insufficient_funds: 'Insufficient funds', bank_cannot_process: 'Bank cannot process', debit_not_authorized: 'Debit not authorised',
  customer_initiated: 'Customer initiated', noncompliant: 'Non-compliant', check_returned: 'Cheque returned',
}
export const reasonLabel = (r: string | null | undefined) => (r ? REASONS[r] || r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Not given')

export function createStoreDisputes(d: CrmDeps, core: StoreCore) {
  const { db, logger } = d

  /**
   * One dispute notice: written once per dispute and updated as it moves (a retried webhook writes the same row). The
   * order — found by the payment's id — carries the dispute's status. Only a notice that OPENED a dispute we had not
   * seen emails the owner, so Stripe's retries never send a second email.
   */
  async function apply(companyId: string, provider: string, n: DisputeNotice, origin: string): Promise<'opened' | 'updated' | 'unmatched'> {
    const [order] = n.providerPaymentId
      ? await db.select().from(storeOrder).where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.provider, provider), eq(storeOrder.providerPaymentId, n.providerPaymentId))).limit(1)
      : [undefined]
    const fields = {
      orderId: order?.id ?? null, providerPaymentId: n.providerPaymentId, amountCents: n.amountCents, currency: n.currency,
      reason: n.reason, status: n.status, livemode: n.livemode, evidenceDueBy: n.evidenceDueBy, updatedAt: new Date(),
    }
    const inserted = await db.insert(storeDispute).values({ companyId, provider, providerDisputeId: n.providerDisputeId, ...fields })
      .onConflictDoNothing().returning({ id: storeDispute.id })
    if (!inserted.length) {
      await db.update(storeDispute).set(fields).where(and(eq(storeDispute.companyId, companyId), eq(storeDispute.provider, provider), eq(storeDispute.providerDisputeId, n.providerDisputeId)))
    }
    if (order) await db.update(storeOrder).set({ disputeStatus: n.status, updatedAt: new Date() }).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))
    else logger.warn('[store] dispute for a payment with no order', { dispute: n.providerDisputeId })

    if (inserted.length) {
      // The email never fails the notice: the dispute is already written, and a retried notice is not "opened" again.
      try {
        const co = await core.shop()
        if (co?.email) {
          const dueBy = n.evidenceDueBy ? await companyDay(n.evidenceDueBy, companyId) : null
          void core.mail(co.email, 'storeDisputeOpened', {
            orderNumber: order?.orderNumber ?? null, amount: formatCents(n.amountCents, n.currency), reason: reasonLabel(n.reason), dueBy,
            respondUrl: stripeDisputeUrl(n.providerDisputeId, n.livemode), disputesUrl: `${origin.replace(/\/+$/, '')}/crm/disputes`,
          })
        }
      } catch (e: any) { logger.warn('[store] dispute email not sent', { dispute: n.providerDisputeId, error: e?.message }) }
      return order ? 'opened' : 'unmatched'
    }
    return order ? 'updated' : 'unmatched'
  }

  /** The dispute's deadline as a day and time on the company's clock (its own time zone), for the email. */
  async function companyDay(at: Date, companyId: string): Promise<string> {
    const timeZone = await companyTimeZone(db, companyId)
    return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)
  }

  return { apply }
}

export function createDisputeRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('orders:refund'))
  app.get('/', async (c) => {
    const companyId = c.get('user').companyId
    const rows = await db.select({ dispute: storeDispute, orderNumber: storeOrder.orderNumber, customerEmail: storeOrder.customerEmail })
      .from(storeDispute).leftJoin(storeOrder, eq(storeOrder.id, storeDispute.orderId))
      .where(eq(storeDispute.companyId, companyId)).orderBy(desc(storeDispute.createdAt), desc(storeDispute.id))
    return listAll(c, rows.map((r: any) => ({
      ...r.dispute, orderNumber: r.orderNumber ?? null, customerEmail: r.customerEmail ?? null,
      reasonLabel: reasonLabel(r.dispute.reason), respondUrl: stripeDisputeUrl(r.dispute.providerDisputeId, r.dispute.livemode),
    })))
  })
  return app
}
