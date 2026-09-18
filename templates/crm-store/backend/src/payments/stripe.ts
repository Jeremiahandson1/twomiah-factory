import Stripe from 'stripe'
import type {
  PaymentProvider, ProviderCredentials, CreateCheckoutInput,
  CreateCheckoutResult, WebhookVerifyInput, WebhookResult,
} from './types.ts'
import type { Address } from '../../db/schema.ts'

// Stripe adapter — hosted Checkout Sessions. We build line items with
// price_data (prices are trusted, computed server-side from the DB), add
// shipping + tax as their own fixed amounts so the provider total exactly
// matches our server-computed order total, and verify webhook signatures.
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const
  private stripe: Stripe
  private webhookSecret?: string

  constructor(creds: ProviderCredentials) {
    this.stripe = new Stripe(creds.secretKey)
    this.webhookSecret = creds.webhookSecret
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const currency = input.currency.toLowerCase()

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = input.lineItems.map((li) => ({
      quantity: li.quantity,
      price_data: {
        currency,
        unit_amount: li.unitPriceCents,
        product_data: {
          name: li.name,
          ...(li.description ? { description: li.description } : {}),
          ...(li.imageUrl ? { images: [li.imageUrl] } : {}),
          metadata: { sku: li.sku },
        },
      },
    }))

    // Tax as an explicit line item keeps totals exact without requiring the
    // merchant to configure Stripe Tax.
    if (input.taxCents > 0) {
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
              },
            }],
          }
        : {}),
    }

    const session = await this.stripe.checkout.sessions.create(params)
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

    if (event.type !== 'checkout.session.completed') return { type: 'ignored' }
    return parseSession(event.data.object as Stripe.Checkout.Session)
  }

  // Success-page fallback: pull the session's final state straight from Stripe
  // (authenticated with the merchant's own key) so orders finalize even when the
  // webhook is delayed, misconfigured, or intercepted by another endpoint.
  async retrieveSession(sessionId: string): Promise<WebhookResult> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId)
    return parseSession(session)
  }
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
    currency: session.currency ?? undefined,
    customerEmail: cd?.email ?? undefined,
    customerName: shipping?.name ?? cd?.name ?? undefined,
    customerPhone: cd?.phone ?? undefined,
    shippingAddress: toAddress(shipping?.address),
    billingAddress: toAddress(cd?.address),
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
