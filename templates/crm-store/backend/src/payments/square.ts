import crypto from 'crypto'
import type {
  PaymentProvider, ProviderCredentials, CreateCheckoutInput,
  CreateCheckoutResult, WebhookVerifyInput, WebhookResult,
} from './types.ts'
import type { Address } from '../../db/schema.ts'

// Square adapter — hosted checkout via Payment Links. The merchant connects their
// OWN Square account; nothing is Twomiah's. Credential mapping (generic
// ProviderCredentials → Square):
//   secretKey       = Square Access Token (Bearer)
//   publishableKey  = Square Location ID
//   webhookSecret   = Webhook Signature Key
//   mode            = 'live' → production API, else sandbox
//
// Amounts are already in the smallest currency unit (cents), which is exactly
// Square Money.amount. Tax + shipping are added as their own order line items so
// the Square total matches our server-computed total exactly (same trick as the
// Stripe adapter). Buyer card data never touches our servers.
//
// NOTE: written to Square's documented Payment Links + Orders + Payments + Webhook
// APIs; the exact order/payment state transitions should be confirmed against a
// Square sandbox before a merchant processes live payments.
const SQUARE_VERSION = '2024-10-17'

export class SquareProvider implements PaymentProvider {
  readonly name = 'square' as const
  private accessToken: string
  private locationId: string
  private signatureKey?: string
  private base: string
  private notificationUrl: string

  constructor(creds: ProviderCredentials) {
    this.accessToken = creds.secretKey
    this.locationId = creds.publishableKey || ''
    this.signatureKey = creds.webhookSecret
    this.base = creds.mode === 'live'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com'
    // Square signs webhooks over (notificationUrl + rawBody), so it must match the
    // exact URL configured in the merchant's Square dashboard.
    this.notificationUrl = (process.env.BACKEND_URL || '').replace(/\/+$/, '') + '/api/public/webhooks/payment'
  }

  private async api(path: string, method: 'GET' | 'POST', body?: unknown): Promise<any> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = json?.errors?.[0]
      throw new Error(`Square ${method} ${path} failed: ${err?.detail || err?.code || res.status}`)
    }
    return json
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.locationId) throw new Error('Square Location ID not configured')
    const currency = input.currency.toUpperCase()

    const line_items: any[] = input.lineItems.map((li) => ({
      name: li.name,
      quantity: String(li.quantity),
      base_price_money: { amount: li.unitPriceCents, currency },
    }))
    if (input.taxCents > 0) {
      line_items.push({ name: 'Sales tax', quantity: '1', base_price_money: { amount: input.taxCents, currency } })
    }
    if (input.shippingCents > 0) {
      line_items.push({ name: 'Shipping', quantity: '1', base_price_money: { amount: input.shippingCents, currency } })
    }

    const json = await this.api('/v2/online-checkout/payment-links', 'POST', {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: this.locationId,
        reference_id: input.clientReferenceId,
        line_items,
      },
      checkout_options: {
        redirect_url: input.successUrl,
        ask_for_shipping_address: input.collectShippingAddress,
      },
      ...(input.customerEmail ? { pre_populated_data: { buyer_email: input.customerEmail } } : {}),
    })

    const link = json.payment_link
    if (!link?.url || !link?.order_id) throw new Error('Square did not return a checkout URL')
    // We correlate by the order_id — both the webhook and the success-page
    // retrieval key off it.
    return { redirectUrl: link.url, providerSessionId: link.order_id }
  }

  async verifyAndParseWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    if (!this.signatureKey) throw new Error('Square webhook signature key not configured')
    if (!input.signature) throw new Error('Missing Square signature')
    const expected = crypto.createHmac('sha256', this.signatureKey)
      .update(this.notificationUrl + input.rawBody).digest('base64')
    if (!safeEqual(expected, input.signature)) throw new Error('Bad Square signature')

    const event = JSON.parse(input.rawBody)
    const payment = event?.data?.object?.payment
    if (!payment || payment.status !== 'COMPLETED') return { type: 'ignored' }
    return parsePayment(payment)
  }

  async retrieveSession(sessionId: string): Promise<WebhookResult> {
    // sessionId = Square order_id. It's paid once a COMPLETED payment (tender)
    // exists on the order.
    const { order } = await this.api('/v2/orders/' + encodeURIComponent(sessionId), 'GET')
    const tenderPaymentId = order?.tenders?.[0]?.payment_id || order?.tenders?.[0]?.id
    if (!tenderPaymentId) return { type: 'ignored' }
    const { payment } = await this.api('/v2/payments/' + encodeURIComponent(tenderPaymentId), 'GET')
    if (!payment || payment.status !== 'COMPLETED') return { type: 'ignored' }
    return parsePayment(payment)
  }
}

function parsePayment(payment: any): WebhookResult {
  const ship = payment.shipping_address
  return {
    type: 'paid',
    providerSessionId: payment.order_id,
    providerPaymentId: payment.id,
    amountTotalCents: payment.amount_money?.amount ?? undefined,
    currency: payment.amount_money?.currency ?? undefined,
    customerEmail: payment.buyer_email_address ?? undefined,
    customerName: ship ? [ship.first_name, ship.last_name].filter(Boolean).join(' ') || undefined : undefined,
    customerPhone: ship?.phone_number ?? undefined,
    shippingAddress: toAddress(ship),
    billingAddress: toAddress(payment.billing_address),
  }
}

// Square address → our normalized Address.
function toAddress(a: any): Address | null {
  if (!a || !a.address_line_1) return null
  return {
    line1: a.address_line_1,
    line2: a.address_line_2 ?? undefined,
    city: a.locality ?? '',
    state: a.administrative_district_level_1 ?? '',
    postalCode: a.postal_code ?? '',
    country: a.country ?? '',
  }
}

// Constant-time compare of two base64 signature strings.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
