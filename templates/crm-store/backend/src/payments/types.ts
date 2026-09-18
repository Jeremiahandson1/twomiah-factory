// Provider-agnostic payment adapter interface.
//
// Every provider (Stripe now; Square + PayPal in Phase 2) implements this same
// shape so the checkout route and webhook route never branch on provider. The
// store is always in "hosted checkout" mode — we hand the provider a set of
// server-priced line items and get back a redirect URL; the buyer's card data
// never touches our servers (PCI scope stays with the provider).
import type { Address } from '../../db/schema.ts'

export type CheckoutLineItem = {
  name: string
  description?: string
  imageUrl?: string
  unitPriceCents: number
  quantity: number
  sku: string
}

export type CreateCheckoutInput = {
  lineItems: CheckoutLineItem[]
  currency: string
  shippingCents: number
  taxCents: number
  customerEmail?: string
  successUrl: string
  cancelUrl: string
  collectShippingAddress: boolean
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
}

// Normalized result of a verified webhook. `type: 'paid'` is the only event we
// act on in Phase 1; everything else is 'ignored'.
export type WebhookResult = {
  type: 'paid' | 'ignored'
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

// The merchant's OWN provider credentials, decrypted just-in-time from
// payment_config.credentialsEnc. Never returned to any client.
export type ProviderCredentials = {
  secretKey: string
  publishableKey?: string
  webhookSecret?: string
  mode: 'test' | 'live'
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'square' | 'paypal'
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>
  verifyAndParseWebhook(input: WebhookVerifyInput): Promise<WebhookResult>
  // Fetch a session's final state directly from the provider — used by the
  // success page to finalize an order even if the webhook never arrived.
  retrieveSession(sessionId: string): Promise<WebhookResult>
}
