/**
 * Stripe deposit at booking time.
 *
 * Service can require an upfront deposit. We create a Stripe Checkout
 * Session with the deposit amount, return the URL, and the customer
 * pays before the booking row is finalized. Webhook flips the booking
 * from pending → confirmed when payment succeeds.
 *
 * Tenant Stripe credentials live in env (STRIPE_SECRET_KEY) — the same
 * Stripe account they use for their main billing.
 */

const STRIPE_API = 'https://api.stripe.com/v1'

export function depositAmountFor(service: { priceCents?: number | null; depositAmountCents?: number | null; depositPercent?: number | null }): number {
  if (service.depositAmountCents && service.depositAmountCents > 0) return service.depositAmountCents
  if (service.depositPercent && service.depositPercent > 0 && service.priceCents) {
    return Math.round((service.priceCents * service.depositPercent) / 100)
  }
  return 0
}

export async function createDepositCheckoutSession(opts: {
  amountCents: number
  serviceName: string
  customerEmail: string
  bookingId: string
  successUrl: string
  cancelUrl: string
}): Promise<{ url: string; sessionId: string } | null> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  const body = new URLSearchParams()
  body.append('mode', 'payment')
  body.append('success_url', opts.successUrl)
  body.append('cancel_url', opts.cancelUrl)
  body.append('customer_email', opts.customerEmail)
  body.append('line_items[0][price_data][currency]', 'usd')
  body.append('line_items[0][price_data][unit_amount]', String(opts.amountCents))
  body.append('line_items[0][price_data][product_data][name]', 'Deposit — ' + opts.serviceName)
  body.append('line_items[0][quantity]', '1')
  body.append('metadata[booking_id]', opts.bookingId)
  body.append('payment_intent_data[metadata][booking_id]', opts.bookingId)
  const res = await fetch(STRIPE_API + '/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!res.ok) {
    console.warn('[stripe] checkout session create failed:', res.status, await res.text().catch(() => ''))
    return null
  }
  const data: any = await res.json()
  return { url: data.url, sessionId: data.id }
}

export function verifyStripeWebhook(signature: string, payload: string): boolean {
  // Tiny verification — splits the signature and HMACs the timestamp+payload.
  // Avoids the stripe SDK dep (10MB) for one webhook.
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const parts = Object.fromEntries(signature.split(',').map(p => p.split('=')))
  const t = parts.t; const v1 = parts.v1
  if (!t || !v1) return false
  const crypto = require('crypto')
  const signed = crypto.createHmac('sha256', secret).update(t + '.' + payload).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(v1)) } catch { return false }
}
