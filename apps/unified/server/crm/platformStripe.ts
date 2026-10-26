// The platform's Stripe client (STRIPE_SECRET_KEY) — the one every vertical uses to act on a business's CONNECTED account
// (company.integrations.stripeAccountId, created or linked in Settings › Integrations) with the Stripe-Account header:
// the bar's card reader and online orders, and the store's checkout (2026-10-26). One client, made once, over fetch —
// the transport Stripe recommends off plain Node, and the one a test answers without the network.
import Stripe from 'stripe'

let cached: { key: string; client: Stripe } | null = null

/** The platform's client; null when STRIPE_SECRET_KEY is not set. A test may hand one in (services.testStripeClient). */
export function platformStripe(testClient?: unknown): Stripe | null {
  if (testClient) return testClient as Stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (!cached || cached.key !== key) cached = { key, client: new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }) }
  return cached.client
}
