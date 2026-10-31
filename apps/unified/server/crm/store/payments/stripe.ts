// Moved from templates/crm-store/backend/src/payments/stripe.ts (docs/UNIFIED_STORE_PLAN.md).
import Stripe from 'stripe'
import type {
  PaymentProvider, ProviderCredentials, CreateCheckoutInput,
  CreateCheckoutResult, WebhookVerifyInput, WebhookResult, RefundInput, RefundResult, DisputeNotice, PayoutSummary, PayoutLine,
  SavedCard, ChargeSavedCardInput, ChargeSavedCardResult, ExpressIntentInput,
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
  private publishableKey?: string
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
    this.publishableKey = source.publishableKey
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

    let prefillCustomer: string | null = null
    if (input.customerId) {
      // The shopper's own customer on this account (store_fast_checkout): their saved address goes onto it, so the page opens with it.
      prefillCustomer = input.customerId
      if (input.prefill && input.collectShippingAddress) {
        const a = input.prefill.shipping.address
        await this.stripe.customers.update(input.customerId, {
          name: input.prefill.name,
          shipping: { name: input.prefill.shipping.name, address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, postal_code: a.postalCode, country: a.country } },
        }, this.opts)
      }
    } else if (input.prefill && input.collectShippingAddress) {
      const a = input.prefill.shipping.address
      const customer = await this.stripe.customers.create({
        ...(input.customerEmail ? { email: input.customerEmail } : {}), name: input.prefill.name,
        shipping: { name: input.prefill.shipping.name, address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, postal_code: a.postalCode, country: a.country } },
      }, this.opts)
      prefillCustomer = customer.id
    }

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      metadata: input.metadata,
      phone_number_collection: { enabled: true },
      // The shopper ticked "save my card": Stripe keeps it on their customer after this payment, for the next one.
      ...(input.saveCard && input.customerId ? { payment_intent_data: { setup_future_usage: 'on_session' as const } } : {}),
      ...(auto ? { automatic_tax: { enabled: true } } : {}),
      ...(input.collectBillingAddress ? { billing_address_collection: 'required' as const } : {}),
      // A signed-in shopper's saved address: a Stripe Customer (on the merchant's own account) that carries it, so the
      // payment page opens with it filled in. Checkout takes the customer in place of customer_email.
      ...(prefillCustomer ? { customer: prefillCustomer, customer_update: input.collectShippingAddress ? { shipping: 'auto' as const, name: 'auto' as const } : { name: 'auto' as const } } : input.customerEmail ? { customer_email: input.customerEmail } : {}),
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

  // ── Saved cards and one-tap payment (store_fast_checkout) ───────────────────────────────────────────────────────
  /** The shopper's Customer on the merchant's own Stripe account: the one given when it is still there, else a new one. */
  async ensureCustomer(input: { email: string; name?: string | null; existingId?: string | null; shipping?: { name: string; address: Address } }): Promise<string> {
    if (input.existingId) {
      try {
        const got = await this.stripe.customers.retrieve(input.existingId, {}, this.opts)
        if (!('deleted' in got && got.deleted)) return input.existingId
      } catch (e: any) { if (e?.statusCode !== 404 && e?.code !== 'resource_missing') throw e }
    }
    const a = input.shipping?.address
    const customer = await this.stripe.customers.create({
      email: input.email, ...(input.name ? { name: input.name } : {}),
      ...(a ? { shipping: { name: input.shipping!.name, address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, postal_code: a.postalCode, country: a.country } } } : {}),
    }, this.opts)
    return customer.id
  }

  /** The card a paid payment left on the customer (null when it was not kept: the shopper did not agree, or it is not a card). */
  async savedCardOf(paymentIntentId: string, customerId: string): Promise<SavedCard | null> {
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['payment_method'] }, this.opts)
    const pm = pi.payment_method && typeof pi.payment_method !== 'string' ? pi.payment_method : null
    if (!pm || pm.type !== 'card' || !pm.card) return null
    const owner = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
    if (owner !== customerId) return null // paid, but never attached to the customer: not saved
    return { paymentMethodId: pm.id, brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year }
  }

  /** Take the card off the customer, so it can no longer be charged. A card Stripe no longer has is already gone. */
  async forgetCard(paymentMethodId: string): Promise<void> {
    try { await this.stripe.paymentMethods.detach(paymentMethodId, {}, this.opts) } catch (e: any) { if (e?.code !== 'resource_missing' && e?.statusCode !== 404) throw e }
  }

  /**
   * The one tap: charge the saved card for the order now. The shopper is at the screen (on_session), so a bank that wants
   * them to confirm is sent to its page (3-D Secure) and back to returnUrl. A refusal is a sentence, not an exception.
   */
  async chargeSavedCard(input: ChargeSavedCardInput): Promise<ChargeSavedCardResult> {
    try {
      const a = input.shipping?.address
      const pi = await this.stripe.paymentIntents.create({
        amount: input.amountCents, currency: input.currency.toLowerCase(), customer: input.customerId, payment_method: input.paymentMethodId,
        confirm: true, off_session: false, return_url: input.returnUrl, payment_method_types: ['card'],
        ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}), ...(input.description ? { description: input.description } : {}),
        ...(a ? { shipping: { name: input.shipping!.name, address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, postal_code: a.postalCode, country: a.country } } } : {}),
        // `twomiah_flow` marks it ours, so the payment notice for it is told apart from a Checkout Session's own payment.
        metadata: { orderId: input.orderId, twomiah_flow: 'saved_card' },
      }, { ...(this.opts ?? {}), idempotencyKey: input.idempotencyKey })
      if (pi.status === 'succeeded') return { status: 'succeeded', paymentIntentId: pi.id }
      if (pi.status === 'requires_action' && pi.next_action?.type === 'redirect_to_url' && pi.next_action.redirect_to_url?.url) {
        return { status: 'requires_action', paymentIntentId: pi.id, redirectUrl: pi.next_action.redirect_to_url.url }
      }
      return { status: 'declined', message: 'The card could not be charged.' }
    } catch (e: any) {
      if (e?.type === 'StripeCardError' || e?.code === 'card_declined' || e?.statusCode === 402) return { status: 'declined', message: e?.message || 'The card was declined.' }
      throw e
    }
  }

  /** The key Stripe.js starts with: the platform's, acting on the connected account; or the key the owner pasted. Null when there is none. */
  expressKeys(): { publishableKey: string; stripeAccount: string | null } | null {
    const key = this.stripeAccount ? process.env.STRIPE_PUBLISHABLE_KEY : this.publishableKey
    return key ? { publishableKey: key, stripeAccount: this.stripeAccount } : null
  }

  /** A PaymentIntent for the wallet buttons: the browser confirms it with what the shopper chose in their wallet. */
  async createExpressIntent(input: ExpressIntentInput): Promise<{ paymentIntentId: string; clientSecret: string }> {
    const a = input.shipping?.address
    const pi = await this.stripe.paymentIntents.create({
      amount: input.amountCents, currency: input.currency.toLowerCase(), automatic_payment_methods: { enabled: true },
      ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}), ...(input.description ? { description: input.description } : {}),
      ...(a ? { shipping: { name: input.shipping!.name, address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, postal_code: a.postalCode, country: a.country } } } : {}),
      metadata: { orderId: input.orderId, twomiah_flow: 'express' },
    }, { ...(this.opts ?? {}), idempotencyKey: `store-express-${input.orderId}` })
    if (!pi.client_secret) throw new Error('Stripe did not return a client secret')
    return { paymentIntentId: pi.id, clientSecret: pi.client_secret }
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
    // A one-tap payment's handle is its PaymentIntent (pi_…), not a Checkout Session.
    if (sessionId.startsWith('pi_')) return parsePaymentIntent(await this.stripe.paymentIntents.retrieve(sessionId, {}, this.opts))
    const session = await this.stripe.checkout.sessions.retrieve(sessionId, {}, this.opts)
    return parseSession(session)
  }

  // Stripe Tax's settings: 'active' once the business has its origin address (and a registration) set in Stripe.
  async taxStatus(): Promise<'active' | 'pending'> {
    const s = await this.stripe.tax.settings.retrieve({}, this.opts)
    return s.status === 'active' ? 'active' : 'pending'
  }

  // Payouts that reached the bank on or after `sinceUnix` (Stripe: status 'paid'), oldest first.
  async payouts(sinceUnix: number): Promise<PayoutSummary[]> {
    const list = await this.stripe.payouts.list({ status: 'paid', arrival_date: { gte: sinceUnix }, limit: 100 }, this.opts)
    return list.data.map((p) => ({ id: p.id, amountCents: p.amount, currency: p.currency, arrivedAt: new Date(p.arrival_date * 1000) }))
      .sort((a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime())
  }

  // What one payout was made of: its balance transactions, each with the charge or refund behind it. The payout's own
  // line (type 'payout') is the total itself and is left out.
  async payoutLines(payoutId: string): Promise<PayoutLine[]> {
    const lines: PayoutLine[] = []
    let after: string | undefined
    for (;;) {
      const page = await this.stripe.balanceTransactions.list({ payout: payoutId, limit: 100, expand: ['data.source'], ...(after ? { starting_after: after } : {}) }, this.opts)
      for (const t of page.data) {
        if (t.type === 'payout') continue
        const src: any = t.source && typeof t.source === 'object' ? t.source : null
        const pi = src?.payment_intent ?? src?.charge?.payment_intent ?? null
        lines.push({
          id: t.id, type: t.type, grossCents: t.amount, feeCents: t.fee, netCents: t.net,
          paymentId: typeof pi === 'string' ? pi : pi?.id ?? null,
          refundId: t.type === 'refund' || t.type === 'payment_refund' ? (src?.id ?? null) : null,
          description: t.description ?? null,
        })
      }
      if (!page.has_more || !page.data.length) break
      after = page.data[page.data.length - 1].id
    }
    return lines
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
  // A one-tap (saved card) payment: ours only when we marked it so — a Checkout Session's own payment is finalised by its session.
  if (event.type === 'payment_intent.succeeded') return parsePaymentIntent(event.data.object as Stripe.PaymentIntent)
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

/** A PaymentIntent the store itself made (saved card): paid, in the store's terms. Anything else is not the store's. */
function parsePaymentIntent(pi: Stripe.PaymentIntent): WebhookResult {
  if (!['saved_card', 'express'].includes(pi.metadata?.twomiah_flow ?? '') || pi.status !== 'succeeded') return { type: 'ignored' }
  const sh = pi.shipping
  return {
    type: 'paid', providerSessionId: pi.id, providerPaymentId: pi.id, amountTotalCents: pi.amount_received || pi.amount, currency: pi.currency,
    customerEmail: pi.receipt_email ?? undefined, customerName: sh?.name ?? undefined, shippingAddress: toAddress(sh?.address),
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
