import type {
  PaymentProvider, ProviderCredentials, CreateCheckoutInput,
  CreateCheckoutResult, WebhookVerifyInput, WebhookResult, RefundInput, RefundResult,
} from './types.ts'
import { RefundRefused } from './types.ts'
import type { Address } from '../../db/schema.ts'

// PayPal adapter — hosted checkout via Orders v2. The merchant connects their OWN
// PayPal REST app. Credential mapping (generic ProviderCredentials → PayPal):
//   secretKey       = Client Secret
//   publishableKey  = Client ID
//   webhookSecret   = Webhook ID (used for signature verification)
//   mode            = 'live' → production API, else sandbox
//
// Flow differs from Stripe/Square: PayPal orders are created with intent=CAPTURE,
// the buyer APPROVES on PayPal, and we must explicitly CAPTURE on return — done in
// retrieveSession (the success page). PayPal amounts are decimal strings, not
// cents, so everything is converted. Card/PayPal balance never touches our servers.
//
// NOTE: written to PayPal's documented Orders v2 + webhook-verify APIs; the
// capture-on-return and webhook-verify flows should be confirmed against a PayPal
// sandbox app before a merchant processes live payments.
export class PayPalProvider implements PaymentProvider {
  readonly name = 'paypal' as const
  private clientId: string
  private clientSecret: string
  private webhookId?: string
  private base: string

  constructor(creds: ProviderCredentials) {
    this.clientId = creds.publishableKey || ''
    this.clientSecret = creds.secretKey
    this.webhookId = creds.webhookSecret
    this.base = creds.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  }

  private async token(): Promise<string> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const res = await fetch(this.base + '/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.access_token) throw Object.assign(new Error(`PayPal auth failed: ${json?.error_description || res.status}`), { status: res.status })
    return json.access_token
  }

  // A failure carries PayPal's HTTP status and its first issue code (details[0].issue, e.g. REFUND_AMOUNT_EXCEEDED), so a
  // caller can tell "PayPal answered no" (4xx) from "we do not know" (5xx, or no answer at all).
  private async api(path: string, method: 'GET' | 'POST', body?: unknown, token?: string, headers?: Record<string, string>): Promise<any> {
    const t = token || await this.token()
    const res = await fetch(this.base + path, {
      method,
      headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json', ...(headers || {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const issue: string | undefined = json?.details?.[0]?.issue
      const said = json?.details?.[0]?.description || json?.message || json?.name || res.status
      throw Object.assign(new Error(`PayPal ${method} ${path} failed: ${issue ? issue + ' — ' : ''}${said}`), { status: res.status, issue })
    }
    return json
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const cc = input.currency.toUpperCase()
    const itemsTotal = input.lineItems.reduce((s, li) => s + li.unitPriceCents * li.quantity, 0)
    const total = itemsTotal + input.shippingCents + input.taxCents - input.discountCents

    const order = await this.api('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: input.clientReferenceId,
        amount: {
          currency_code: cc,
          value: money(total),
          breakdown: {
            item_total: { currency_code: cc, value: money(itemsTotal) },
            ...(input.shippingCents > 0 ? { shipping: { currency_code: cc, value: money(input.shippingCents) } } : {}),
            ...(input.taxCents > 0 ? { tax_total: { currency_code: cc, value: money(input.taxCents) } } : {}),
            ...(input.discountCents > 0 ? { discount: { currency_code: cc, value: money(input.discountCents) } } : {}),
          },
        },
        items: input.lineItems.map((li) => ({
          name: li.name.slice(0, 127),
          quantity: String(li.quantity),
          unit_amount: { currency_code: cc, value: money(li.unitPriceCents) },
          ...(li.sku ? { sku: li.sku.slice(0, 127) } : {}),
        })),
      }],
      application_context: {
        return_url: input.successUrl,
        cancel_url: input.cancelUrl,
        shipping_preference: input.collectShippingAddress ? 'GET_FROM_FILE' : 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    })

    const approve = (order.links || []).find((l: any) => l.rel === 'approve')?.href
    if (!approve || !order.id) throw new Error('PayPal did not return an approval URL')
    return { redirectUrl: approve, providerSessionId: order.id }
  }

  async retrieveSession(sessionId: string): Promise<WebhookResult> {
    const token = await this.token()
    let order = await this.api('/v2/checkout/orders/' + encodeURIComponent(sessionId), 'GET', undefined, token)
    // Buyer approved on PayPal and returned — capture now (idempotent: capturing an
    // already-captured order returns its COMPLETED state).
    if (order.status === 'APPROVED') {
      try {
        order = await this.api('/v2/checkout/orders/' + encodeURIComponent(sessionId) + '/capture', 'POST', {}, token)
      } catch (e: any) {
        // ORDER_ALREADY_CAPTURED → re-read the completed order.
        order = await this.api('/v2/checkout/orders/' + encodeURIComponent(sessionId), 'GET', undefined, token)
      }
    }
    if (order.status !== 'COMPLETED') return { type: 'ignored' }
    return parseOrder(order)
  }

  async verifyAndParseWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    if (!this.webhookId) throw new Error('PayPal webhook id not configured')
    const h = input.headers || {}
    const token = await this.token()
    const verify = await this.api('/v1/notifications/verify-webhook-signature', 'POST', {
      transmission_id: h['paypal-transmission-id'],
      transmission_time: h['paypal-transmission-time'],
      cert_url: h['paypal-cert-url'],
      auth_algo: h['paypal-auth-algo'],
      transmission_sig: h['paypal-transmission-sig'],
      webhook_id: this.webhookId,
      webhook_event: JSON.parse(input.rawBody),
    }, token)
    if (verify.verification_status !== 'SUCCESS') throw new Error('Bad PayPal signature')

    const event = JSON.parse(input.rawBody)
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return { type: 'ignored' }
    // Capture resource → correlate to our stored order id (the v2 order id).
    const cap = event.resource || {}
    const orderId = cap.supplementary_data?.related_ids?.order_id
    if (!orderId) return { type: 'ignored' }
    return {
      type: 'paid',
      providerSessionId: orderId,
      providerPaymentId: cap.id,
      amountTotalCents: cap.amount ? cents(cap.amount.value) ?? undefined : undefined,
      currency: cap.amount?.currency_code,
      // Full buyer/shipping details come from retrieveSession (primary path); the
      // webhook is a backup and finalizeOrder is idempotent.
    }
  }

  /**
   * Money back to the buyer, through PayPal's Payments v2 API — POST /v2/payments/captures/{capture_id}/refund.
   *   - providerPaymentId is the CAPTURE id (purchase_units[0].payments.captures[0].id on the captured order, or the
   *     capture resource's id on PAYMENT.CAPTURE.COMPLETED) — finalizeOrder stores it from parseOrder / the webhook.
   *   - PayPal-Request-Id is the idempotency key: the same key again answers the SAME refund, never a second one.
   *   - With an amount, that much goes back. With none (a whole order's first refund), the body carries no amount and
   *     PayPal refunds whatever of the capture is left — the way the Stripe adapter is called, and it allows for anything
   *     already refunded in PayPal's own dashboard. A capture with nothing left (CAPTURE_FULLY_REFUNDED) is reported as
   *     already refunded, not as a failure: the money is back either way.
   *   - COMPLETED → succeeded; PENDING → pending (accepted, PayPal still settling); FAILED / CANCELLED, or any 4xx
   *     (REFUND_AMOUNT_EXCEEDED, a bad capture id …) → RefundRefused: PayPal answered, nothing was sent. A 5xx or no
   *     answer at all is thrown as it is — the refund may have gone through, so it is asked again under the same key.
   * NOTE: written to PayPal's documented API and tested against a stand-in for it; not yet run against a PayPal sandbox.
   */
  async refund({ providerPaymentId, idempotencyKey, amountCents, currency, reason }: RefundInput): Promise<RefundResult> {
    if (!providerPaymentId) throw new RefundRefused('No PayPal capture id is on record for this order, so there is no PayPal payment to refund. Refund it in your PayPal dashboard.')
    if (amountCents != null && (!Number.isInteger(amountCents) || amountCents <= 0)) throw new RefundRefused(`A refund must be a whole number of cents above zero (got ${amountCents})`)
    if (amountCents != null && !currency) throw new RefundRefused('A part refund needs the order\'s currency')
    const token = await this.token().catch((e: any) => {
      // PayPal refused the credentials: the refund was never asked for. A dropped connection or a 5xx is not an answer.
      if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) throw new RefundRefused(e.message)
      throw e
    })
    let refund: any
    try {
      refund = await this.api('/v2/payments/captures/' + encodeURIComponent(providerPaymentId) + '/refund', 'POST', {
        ...(amountCents != null ? { amount: { value: money(amountCents), currency_code: currency!.toUpperCase() } } : {}),
        ...(reason ? { note_to_payer: reason.slice(0, 255) } : {}),
      }, token, { 'PayPal-Request-Id': idempotencyKey, 'Prefer': 'return=representation' })
    } catch (e: any) {
      if (e?.issue === 'CAPTURE_FULLY_REFUNDED' && amountCents == null) return { refundId: null, status: 'succeeded', amountCents: null, alreadyRefunded: true }
      if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) throw new RefundRefused(e.message)
      throw e
    }
    const status = String(refund?.status || '').toUpperCase()
    if (status === 'FAILED' || status === 'CANCELLED') throw new RefundRefused(`PayPal did not complete the refund (${status.toLowerCase()}${refund?.status_details?.reason ? ': ' + refund.status_details.reason : ''})`)
    const back = refund?.amount?.value != null ? cents(refund.amount.value) : null
    return { refundId: refund?.id ?? null, status: status === 'COMPLETED' ? 'succeeded' : 'pending', amountCents: back ?? amountCents ?? null }
  }
}

// A COMPLETED PayPal order → our normalized result.
function parseOrder(order: any): WebhookResult {
  const pu = order.purchase_units?.[0] || {}
  const cap = pu.payments?.captures?.[0] || {}
  const payer = order.payer || {}
  const ship = pu.shipping || {}
  const amount = cap.amount || pu.amount
  return {
    type: 'paid',
    providerSessionId: order.id,
    providerPaymentId: cap.id,
    amountTotalCents: amount ? cents(amount.value) ?? undefined : undefined,
    currency: amount?.currency_code,
    customerEmail: payer.email_address ?? undefined,
    customerName: ship.name?.full_name
      ?? ([payer.name?.given_name, payer.name?.surname].filter(Boolean).join(' ') || undefined),
    customerPhone: payer.phone?.phone_number?.national_number ?? undefined,
    shippingAddress: toAddress(ship.address),
    billingAddress: null,
  }
}

// PayPal address → our normalized Address.
function toAddress(a: any): Address | null {
  if (!a || !a.address_line_1) return null
  return {
    line1: a.address_line_1,
    line2: a.address_line_2 ?? undefined,
    city: a.admin_area_2 ?? '',
    state: a.admin_area_1 ?? '',
    postalCode: a.postal_code ?? '',
    country: a.country_code ?? '',
  }
}

// cents → PayPal decimal string, e.g. 1050 → "10.50", 5 → "0.05". Integer arithmetic only: no float in the way.
export function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Not a whole number of cents: ${cents}`)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// PayPal decimal string → cents, e.g. "10.5" → 1050, "12.34" → 1234. Read as text, not parseFloat.
export function cents(value: string | number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(String(value).trim())
  if (!m) return null
  const n = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'))
  return m[1] ? -n : n
}
