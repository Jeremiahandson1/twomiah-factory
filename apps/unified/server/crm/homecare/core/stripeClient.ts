// The Stripe client for home care's card features — ONE place, so a visit invoice's checkout (billing/stripe.ts) and autopay
// (core/autopay.ts) ask the same client, and a test's fake (TestSeams.stripe → d.services.testStripeClient) stands in for both.
// Moved unchanged from billing/stripe.ts.
import type { CrmDeps } from '../../deps.ts'

let client: any = undefined
/** The Stripe client for STRIPE_SECRET_KEY, made once; null when the key (or the SDK) is missing. */
export async function sdkClient(logger: CrmDeps['logger']): Promise<any | null> {
  if (client !== undefined) return client
  client = null
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = (await import('stripe')).default
      client = new Stripe(process.env.STRIPE_SECRET_KEY)
    } catch {
      logger.warn('Stripe SDK not installed — payment endpoints disabled')
    }
  }
  return client
}

/** The tests' fake client when one was handed to the app (TestSeams.stripe), else the one made from the key. */
export const stripeClientFor = (d: Pick<CrmDeps, 'services' | 'logger'>) =>
  d.services.testStripeClient !== undefined ? Promise.resolve(d.services.testStripeClient) : sdkClient(d.logger)
