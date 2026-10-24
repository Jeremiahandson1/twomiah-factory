// Moved from templates/crm-store/backend/src/payments/types.ts (docs/UNIFIED_STORE_PLAN.md).
// Provider-agnostic payment adapter interface.
//
// Every provider (Stripe now; Square + PayPal in Phase 2) implements this same
// shape so the checkout route and webhook route never branch on provider. The
// store is always in "hosted checkout" mode — we hand the provider a set of
// server-priced line items and get back a redirect URL; the buyer's card data
// never touches our servers (PCI scope stays with the provider).
import type { StoreAddress as Address } from '../../../db/schema/store.ts'

export type CheckoutLineItem = {
  name: string
  description?: string
  imageUrl?: string
  unitPriceCents: number
  quantity: number
  sku: string
  /** Stripe Tax's product tax code for this line (a gift card is 'txcd_00000000', not taxable); absent = the account's default. */
  taxCode?: string
}

export type CreateCheckoutInput = {
  lineItems: CheckoutLineItem[]
  currency: string
  shippingCents: number
  taxCents: number
  // Order-level discount already validated + computed server-side (0 if none).
  // Each provider applies it as a native order discount so the hosted total matches.
  discountCents: number
  customerEmail?: string
  successUrl: string
  cancelUrl: string
  collectShippingAddress: boolean
  /**
   * Sales tax worked out by the provider from the shopper's address (Stripe Tax: automatic_tax). taxCents is then 0 and
   * the paid session says what was charged (WebhookResult.taxCents). Only Stripe is ever asked for it.
   */
  automaticTax?: boolean
  /** Ask for the billing address (automatic tax on an order with no shipping address: a pickup, a gift card). */
  collectBillingAddress?: boolean
  // Correlates the provider session back to our pending order row.
  clientReferenceId: string
  metadata?: Record<string, string>
}

export type CreateCheckoutResult = {
  redirectUrl: string
  providerSessionId: string
}

export type WebhookVerifyInput = {
  rawBody: string
  signature: string | undefined
  // All request headers, lowercased. Providers that verify with a single header
  // (Stripe, Square) use `signature`; PayPal needs several transmission headers.
  headers?: Record<string, string>
}

// Normalized result of a verified webhook. `type: 'paid'` is the only event we
// act on in Phase 1; everything else is 'ignored'.
export type WebhookResult = {
  // 'refunded': money sent back from the provider's own dashboard (routes/orders.ts applyProviderRefund), or the
  // provider's notice of a refund the store made (matched by providerRefundId, never counted twice).
  // 'refund_failed': a refund the provider had accepted as pending did not go through (PayPal PAYMENT.REFUND.FAILED).
  // 'dispute': a chargeback opened, changed or closed (Stripe charge.dispute.*), described in `dispute`.
  type: 'paid' | 'refunded' | 'refund_failed' | 'dispute' | 'ignored'
  // For 'paid': the tax the provider worked out (automatic tax), in the smallest unit.
  taxCents?: number
  dispute?: DisputeNotice
  // For 'refunded': how much of the charge has gone back so far, and the charge itself.
  amountRefundedCents?: number
  // For 'refunded' / 'refund_failed': the provider's id for this one refund, and (failed) why.
  providerRefundId?: string
  refundFailureReason?: string
  providerSessionId?: string
  providerPaymentId?: string
  amountTotalCents?: number
  currency?: string
  customerEmail?: string
  customerName?: string
  customerPhone?: string
  shippingAddress?: Address | null
  billingAddress?: Address | null
}

/** A chargeback as the provider describes it (Stripe's Dispute object). */
export type DisputeNotice = {
  providerDisputeId: string
  providerPaymentId: string | null
  amountCents: number
  currency: string
  reason: string | null
  status: string
  livemode: boolean
  evidenceDueBy: Date | null
  /** charge.dispute.created: the owner is told by email. */
  opened: boolean
}

// The merchant's OWN provider credentials, decrypted just-in-time from
// payment_config.credentialsEnc. Never returned to any client.
export type ProviderCredentials = {
  secretKey: string
  publishableKey?: string
  webhookSecret?: string
  mode: 'test' | 'live'
}

/**
 * Money sent back to the shopper — part of an order, or all of what is left. (Owner's decision, 10/12: 'Mark refunded' only changed the order's
 * status — the shopper's money stayed taken. As Shopify does it, Refund now returns it through the provider.)
 */
export type RefundInput = {
  // The provider's id for the captured payment — Stripe's payment_intent, Square's payment id, PayPal's
  // CAPTURE id (not its order id) — as finalizeOrder recorded it.
  providerPaymentId: string
  // One key per refund: a second press, a retry after a timeout, or two people at once all get the SAME refund back.
  idempotencyKey: string
  // How much, in the smallest unit. Absent = whatever of the payment has not been refunded yet (a whole order's refund,
  // after any part refunds — and after any made in the provider's own dashboard).
  amountCents?: number
  currency?: string
  // Shown to the shopper by some providers; kept short.
  reason?: string
}
export type RefundResult = {
  refundId: string | null
  // The provider's word: 'succeeded', or 'pending' while a card network settles it.
  status: string
  amountCents: number | null
  // The payment was already refunded at the provider (from its own dashboard, say): nothing more was sent.
  alreadyRefunded?: boolean
  // The provider has the refund but has NOT sent the money yet, and it may still fail (PayPal's PENDING — an eCheck
  // refund funded from the merchant's bank). The store holds it — reserved, nothing restocked — until the provider says
  // it completed or failed (its webhook, or refundStatus). Square's PENDING is not this: a card refund in flight.
  awaiting?: boolean
}

/**
 * The provider ANSWERED and said no (a 4xx, or a refund it reports failed/rejected): nothing was sent, so the store may
 * give the reservation back. Anything else thrown — a timeout, a dropped connection, a 5xx — is "we do not know": the
 * refund may have gone through, so it stays pending and is asked again with the same idempotency key.
 */
export class RefundRefused extends Error {}

export interface PaymentProvider {
  readonly name: 'stripe' | 'square' | 'paypal'
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>
  verifyAndParseWebhook(input: WebhookVerifyInput): Promise<WebhookResult>
  // Fetch a session's final state directly from the provider — used by the
  // success page to finalize an order even if the webhook never arrived.
  retrieveSession(sessionId: string): Promise<WebhookResult>
  // Return part or all of an order's payment, through the provider. Every provider sends the money back (Stripe, Square,
  // PayPal); an order paid through a provider that is NOT the one connected now is only recorded (routes/orders.ts).
  refund(input: RefundInput): Promise<RefundResult>
  // Where a refund the provider is holding (awaiting) stands now: completed → status 'succeeded'; still pending →
  // awaiting; failed → RefundRefused; anything else thrown → unknown, ask again later. Only PayPal holds refunds.
  refundStatus?(refundId: string): Promise<RefundResult>
  // Whether the account can work out sales tax itself (Stripe Tax's settings status): 'active' once the business has set
  // its origin address and registrations in Stripe. Only Stripe has it.
  taxStatus?(): Promise<'active' | 'pending'>
}
