// Moved from templates/crm-store/backend/src/payments/square.ts (docs/UNIFIED_STORE_PLAN.md).
import crypto from 'crypto'
import type {
  PaymentProvider, ProviderCredentials, CreateCheckoutInput,
  CreateCheckoutResult, WebhookVerifyInput, WebhookResult, RefundInput, RefundResult,
} from './types.ts'
import { RefundRefused } from './types.ts'
import type { StoreAddress as Address } from '../../../db/schema/store.ts'

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
      throw Object.assign(new Error(`Square ${method} ${path} failed: ${err?.detail || err?.code || res.status}`), { status: res.status })
    }
    return json
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.locationId) throw new Error('Square Location ID not configured')
    const currency = input.currency.toUpperCase()

    // The discount comes off the GOODS only. It was an ORDER-scoped discount, which Square spreads over every line —
    // tax and shipping included — so the Square order read "Sales tax $2.21, Shipping $4.58" for a store that charged
    // $2.41 and $5.00 (E2E Run 2, read back from the sandbox order). Same total either way; only the goods carry it now.
    const discounted = input.discountCents > 0
    const line_items: any[] = input.lineItems.map((li) => ({
      name: li.name,
      quantity: String(li.quantity),
      base_price_money: { amount: li.unitPriceCents, currency },
      ...(discounted ? { applied_discounts: [{ discount_uid: 'discount' }] } : {}),
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
        ...(discounted
          ? { discounts: [{ uid: 'discount', name: 'Discount', amount_money: { amount: input.discountCents, currency }, scope: 'LINE_ITEM' }] }
          : {}),
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
    // A payment with money refunded off it: a refund — made here, or in Square's own dashboard. routes/orders.ts
    // applyProviderRefund tells the two apart by what the order has already sent back.
    const refunded = payment.refunded_money?.amount ?? 0
    if (refunded > 0) {
      return { type: 'refunded', providerPaymentId: payment.id, amountRefundedCents: refunded, amountTotalCents: payment.amount_money?.amount ?? 0, currency: payment.amount_money?.currency }
    }
    // The webhook carries the payment only; who it is for lives on the order (below).
    const order = payment.order_id ? (await this.api('/v2/orders/' + encodeURIComponent(payment.order_id), 'GET').catch(() => null))?.order : null
    return parsePayment(payment, order)
  }

  async retrieveSession(sessionId: string): Promise<WebhookResult> {
    // sessionId = Square order_id. It's paid once a COMPLETED payment (tender)
    // exists on the order.
    const { order } = await this.api('/v2/orders/' + encodeURIComponent(sessionId), 'GET')
    const tenderPaymentId = order?.tenders?.[0]?.payment_id || order?.tenders?.[0]?.id
    if (!tenderPaymentId) return { type: 'ignored' }
    const { payment } = await this.api('/v2/payments/' + encodeURIComponent(tenderPaymentId), 'GET')
    if (!payment || payment.status !== 'COMPLETED') return { type: 'ignored' }
    return parsePayment(payment, order)
  }

  /**
   * Money back to the card, through Square's Refunds API — POST /v2/refunds { idempotency_key, payment_id,
   * amount_money, reason }. Read against the sandbox (10/15): a part refund answers PENDING; the same key again answers
   * the SAME refund; asking for more than is left is a 400 REFUND_AMOUNT_INVALID; the payment's refunded_money adds up.
   * Square always needs the amount, so "whatever is left" is read off the payment first.
   */
  async refund({ providerPaymentId, idempotencyKey, amountCents, currency, reason }: RefundInput): Promise<RefundResult> {
    let amount = amountCents
    let cur = currency?.toUpperCase()
    if (amount == null || !cur) {
      const { payment } = await this.api('/v2/payments/' + encodeURIComponent(providerPaymentId), 'GET')
      cur ||= payment?.amount_money?.currency
      if (amount == null) amount = (payment?.amount_money?.amount ?? 0) - (payment?.refunded_money?.amount ?? 0)
    }
    if (!amount || amount <= 0) return { refundId: null, status: 'succeeded', amountCents: null, alreadyRefunded: true }
    // Square's key limit is 45 characters; a longer key (order-refund-<uuid> is 49) becomes a hash of itself — the same
    // key in, the same key out, so a repeat still finds the same refund.
    const key = idempotencyKey.length <= 45 ? idempotencyKey : crypto.createHash('sha256').update(idempotencyKey).digest('base64url').slice(0, 43)
    const { refund } = await this.api('/v2/refunds', 'POST', {
      idempotency_key: key,
      payment_id: providerPaymentId,
      amount_money: { amount, currency: cur },
      ...(reason ? { reason: reason.slice(0, 192) } : {}),
    }).catch((e: any) => {
      // Square answered no (REFUND_AMOUNT_INVALID and the like): nothing was sent. A timeout or a 5xx is not an answer.
      if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) throw new RefundRefused(e.message)
      throw e
    })
    const status = String(refund?.status || '').toUpperCase()
    if (status === 'REJECTED' || status === 'FAILED') throw new RefundRefused(`Square did not complete the refund (${status.toLowerCase()})`)
    return { refundId: refund?.id ?? null, status: status === 'COMPLETED' ? 'succeeded' : 'pending', amountCents: refund?.amount_money?.amount ?? amount }
  }
}

/**
 * WHO the order is for. A Payment Link checkout puts the shopper's name, email, phone and shipping address on the ORDER's
 * shipment fulfillment (fulfillments[0].shipment_details.recipient) — the payment itself carried none of them, so every
 * Square order arrived with a blank name and "No shipping address" (E2E Run 2, read back from the sandbox order).
 * The recipient first; the payment's own fields as a fallback.
 */
function parsePayment(payment: any, order?: any): WebhookResult {
  const recipient = order?.fulfillments?.find((f: any) => f?.shipment_details?.recipient)?.shipment_details?.recipient
  const ship = payment.shipping_address
  const nameFromShip = ship ? [ship.first_name, ship.last_name].filter(Boolean).join(' ') : ''
  return {
    type: 'paid',
    providerSessionId: payment.order_id,
    providerPaymentId: payment.id,
    amountTotalCents: payment.amount_money?.amount ?? undefined,
    currency: payment.amount_money?.currency ?? undefined,
    customerEmail: payment.buyer_email_address || recipient?.email_address || undefined,
    customerName: recipient?.display_name || nameFromShip || undefined,
    customerPhone: recipient?.phone_number || ship?.phone_number || undefined,
    shippingAddress: toAddress(recipient?.address) || toAddress(ship),
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
