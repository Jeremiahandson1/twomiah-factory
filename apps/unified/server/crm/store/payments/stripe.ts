// Moved from templates/crm-store/backend/src/payments/stripe.ts (docs/UNIFIED_STORE_PLAN.md).
import Stripe from 'stripe'
import type {
  PaymentProvider, ProviderCredentials, CreateCheckoutInput,
  CreateCheckoutResult, WebhookVerifyInput, WebhookResult, RefundInput, RefundResult, DisputeNotice,
} from './types.ts'
import { RefundRefused } from './types.ts'
import type { StoreAddress as Address } from '../../../db/schema/store.ts'

/**
 * The business's Stripe account as the rest of the app takes cards on it (owner's decision, 2026-10-26): the PLATFORM's
 * client (STRIPE_SECRET_KEY) acting on the account the owner created or linked in Settings › Integrations
 * (company.integrations.stripeAccountId), every call carrying it as the Stripe-Account header — so the money lands in
 * their own Stripe and no owner ever pastes a secret key. Its events reach the store through the Factory's Connect
 * forwarder (POST /api/stripe/factory-event → checkout/paymentNotices.ts claim), not through a webhook of its own.
 */
export type ConnectedStripe = { client: Stripe; stripeAccount: string }

// Stripe adapter — hosted Checkout Sessions. We build line items with
// price_data (prices are trusted, computed server-side from the DB), add
// shipping + tax as their own fixed amounts so the provider total exactly
// matches our server-computed order total, and verify webhook signatures.
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const
  private stripe: Stripe
  private webhookSecret?: string
  /** The connected account every call is made on; null for a store still on the keys it pasted before Connect. */
  readonly stripeAccount: string | null
  private opts: { stripeAccount: string } | undefined

  constructor(source: ProviderCredentials | ConnectedStripe) {
    if ('client' in source) {
      this.stripe = source.client
      this.stripeAccount = source.stripeAccount
      this.opts = { stripeAccount: source.stripeAccount }
      return
    }
    // Over fetch — the transport Stripe recommends off plain Node, and the one a test can answer without the network.
    this.stripe = new Stripe(source.secretKey, { httpClient: Stripe.createFetchHttpClient() })
    this.webhookSecret = source.webhookSecret
    this.stripeAccount = null
    this.opts = undefined
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const currency = input.currency.toLowerCase()
    // Stripe Tax (automatic_tax): every price says its tax is added on top (US-style, 'exclusive'), so Stripe never
    // has to fall back on an account default that may not be set; a line with a tax code (a gift card) carries it.
    const auto = !!input.automaticTax
    const taxed = auto ? { tax_behavior: 'exclusive' as const } : {}

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = input.lineItems.map((li) => ({
      quantity: li.quantity,
      price_data: {
        currency,
        unit_amount: li.unitPriceCents,
        ...taxed,
        product_data: {
          name: li.name,
          ...(li.description ? { description: li.description } : {}),
          ...(li.imageUrl ? { images: [li.imageUrl] } : {}),
          ...(auto && li.taxCode ? { tax_code: li.taxCode } : {}),
          metadata: { sku: li.sku },
        },
      },
    }))

    // The store's own (flat or regional) tax as an explicit line item keeps totals exact without Stripe Tax. With Stripe
    // Tax on, Stripe works it out from the address on the payment page instead, and shows it there as its own line.
    if (!auto && input.taxCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: input.taxCents,
          product_data: { name: 'Sales tax' },
        },
      })
    }

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      metadata: input.metadata,
      phone_number_collection: { enabled: true },
      ...(auto ? { automatic_tax: { enabled: true } } : {}),
      ...(input.collectBillingAddress ? { billing_address_collection: 'required' as const } : {}),
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      ...(input.collectShippingAddress
        ? { shipping_address_collection: { allowed_countries: ['US'] } }
        : {}),
      ...(input.shippingCents > 0
        ? {
            shipping_options: [{
              shipping_rate_data: {
                type: 'fixed_amount',
                display_name: 'Shipping',
                fixed_amount: { amount: input.shippingCents, currency },
                ...taxed,
              },
            }],
          }
        : {}),
    }

    // Apply the server-computed discount as a one-time coupon so the hosted total
    // exactly matches our order total.
    if (input.discountCents > 0) {
      const coupon = await this.stripe.coupons.create({
        amount_off: input.discountCents, currency, duration: 'once', name: 'Discount',
      }, this.opts)
      params.discounts = [{ coupon: coupon.id }]
    }

    const session = await this.stripe.checkout.sessions.create(params, this.opts)
    if (!session.url) throw new Error('Stripe did not return a checkout URL')
    return { redirectUrl: session.url, providerSessionId: session.id }
  }

  async verifyAndParseWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    if (!this.webhookSecret) throw new Error('Stripe webhook secret not configured')
    if (!input.signature) throw new Error('Missing Stripe signature')

    // Throws on bad signature — caller returns 400 and we never trust the body.
    const event = await this.stripe.webhooks.constructEventAsync(
      input.rawBody, input.signature, this.webhookSecret,
    )
    return parseStripeEvent(event)
  }

  // Success-page fallback: pull the session's final state straight from Stripe
  // (on the connected account, or with the merchant's own key) so orders finalize even when the
  // webhook is delayed, misconfigured, or intercepted by another endpoint.
  async retrieveSession(sessionId: string): Promise<WebhookResult> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId, {}, this.opts)
    return parseSession(session)
  }

  // Stripe Tax's settings: 'active' once the business has its origin address (and a registration) set in Stripe.
  async taxStatus(): Promise<'active' | 'pending'> {
    const s = await this.stripe.tax.settings.retrieve({}, this.opts)
    return s.status === 'active' ? 'active' : 'pending'
  }

  // Part of the payment (amountCents), or with no amount whatever of it has not gone back yet, to the card it came
  // from. The idempotency key makes a repeat — a second press, a retry after a timeout — return the SAME refund rather
  // than a second one. A payment refunded already (from Stripe's own dashboard) is reported as such, not as a
  // failure: the money is back either way.
  async refund({ providerPaymentId, idempotencyKey, amountCents }: RefundInput): Promise<RefundResult> {
    try {
      const r = await this.stripe.refunds.create(
        { payment_intent: providerPaymentId, reason: 'requested_by_customer', ...(amountCents != null ? { amount: amountCents } : {}) },
        { idempotencyKey, ...this.opts },
      )
      if (r.status === 'failed' || r.status === 'canceled') throw new RefundRefused(`Stripe did not complete the refund (${r.status}${r.failure_reason ? ': ' + r.failure_reason : ''})`)
      return { refundId: r.id, status: r.status ?? 'pending', amountCents: r.amount ?? null }
    } catch (e: any) {
      if (e?.code === 'charge_already_refunded') return { refundId: null, status: 'succeeded', amountCents: null, alreadyRefunded: true }
      // Stripe answered with a refusal (a 4xx): nothing was sent. A connection error or a 5xx is not an answer.
      if (!(e instanceof RefundRefused) && typeof e?.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) throw new RefundRefused(e.message || 'Stripe refused the refund')
      throw e
    }
  }
}

/**
 * One Stripe event in the store's terms — read the same whether it came signed to the store's own webhook (a store on
 * the keys it pasted before Connect) or forwarded by the Factory's Connect endpoint (a connected account: the Factory
 * checked Stripe's signature, and the Factory→tenant key vouches for the forward).
 */
export function parseStripeEvent(event: Pick<Stripe.Event, 'type' | 'data'>): WebhookResult {
  // A refund — made here (Refund on an order) or in Stripe's own dashboard. routes/orders.ts tells the two apart.
  if (event.type === 'charge.refunded') {
    const ch = event.data.object as Stripe.Charge
    const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id
    if (!pi) return { type: 'ignored' }
    return { type: 'refunded', providerPaymentId: pi, amountRefundedCents: ch.amount_refunded, amountTotalCents: ch.amount, currency: ch.currency }
  }
  // A chargeback opened, changed (evidence submitted, under review, funds withdrawn) or closed (won, lost).
  if (event.type.startsWith('charge.dispute.')) {
    return { type: 'dispute', dispute: parseDispute(event.data.object as Stripe.Dispute, event.type === 'charge.dispute.created') }
  }
  if (event.type !== 'checkout.session.completed') return { type: 'ignored' }
  return parseSession(event.data.object as Stripe.Checkout.Session)
}

// Normalizes a Stripe Checkout Session into our provider-agnostic result.
// Shared by the webhook (verified event) and the success-page retrieval.
function parseSession(session: Stripe.Checkout.Session): WebhookResult {
  if (session.payment_status !== 'paid') return { type: 'ignored' }
  const cd = session.customer_details
  // Stripe moved the collected shipping address across API versions: newest is
  // session.collected_information.shipping_details, older is session.shipping_details,
  // oldest is session.shipping. Check all three so shipping is always captured.
  const shipping = (session as any).collected_information?.shipping_details
    ?? (session as any).shipping_details
    ?? (session as any).shipping
  return {
    type: 'paid',
    providerSessionId: session.id,
    providerPaymentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id,
    amountTotalCents: session.amount_total ?? undefined,
    // What Stripe Tax charged (0 when the store's own tax line was sent instead — that line is part of the total).
    taxCents: session.total_details?.amount_tax ?? undefined,
    currency: session.currency ?? undefined,
    customerEmail: cd?.email ?? undefined,
    customerName: shipping?.name ?? cd?.name ?? undefined,
    customerPhone: cd?.phone ?? undefined,
    shippingAddress: toAddress(shipping?.address),
    billingAddress: toAddress(cd?.address),
  }
}

function parseDispute(dp: Stripe.Dispute, opened: boolean): DisputeNotice {
  const pi = typeof dp.payment_intent === 'string' ? dp.payment_intent : dp.payment_intent?.id ?? null
  const due = dp.evidence_details?.due_by
  return {
    providerDisputeId: dp.id, providerPaymentId: pi, amountCents: dp.amount, currency: dp.currency, reason: dp.reason ?? null,
    status: dp.status, livemode: !!dp.livemode, evidenceDueBy: typeof due === 'number' ? new Date(due * 1000) : null, opened,
  }
}

function toAddress(a: Stripe.Address | null | undefined): Address | null {
  if (!a || !a.line1) return null
  return {
    line1: a.line1,
    line2: a.line2 ?? undefined,
    city: a.city ?? '',
    state: a.state ?? '',
    postalCode: a.postal_code ?? '',
    country: a.country ?? '',
  }
}
