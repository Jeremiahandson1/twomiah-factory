// Card deposits for bookings, on Stripe's own payment page (Checkout) and the business's connected Stripe account —
// the premium site's lib/stripe-deposit.ts, with the money going to the business, never the platform
// (payments/stripe.ts createBookingDepositCheckout refuses without a connected account; the booking then stands
// without a deposit). The customer comes back to their own booking page; the payment reaches the engine through the
// Factory's Connect forwarder → /api/stripe/factory-event → depositPaid (crm/services.ts useBookingDeposits).
import type { DepositProvider } from './engine.ts'
import { siteOrigin } from './happenings.ts'

export interface DepositCheckouts {
  createBookingDepositCheckout(p: {
    bookingId: string; companyId: string; amount: number; customerEmail: string; description: string
    successUrl: string; cancelUrl: string; expiresAt: Date
  }): Promise<{ url: string; sessionId: string } | null>
}

export function createStripeDeposits(stripe: DepositCheckouts, origin: () => string = siteOrigin): DepositProvider {
  return {
    async checkout(a) {
      const back = `${origin()}/booking/${encodeURIComponent(a.token)}`
      const page = await stripe.createBookingDepositCheckout({
        bookingId: a.bookingId, companyId: a.companyId, amount: a.amount, customerEmail: a.customerEmail, description: a.description,
        successUrl: back + '?deposit=paid', cancelUrl: back + '?deposit=cancelled', expiresAt: a.expiresAt,
      })
      return page ? { url: page.url, reference: page.sessionId } : null
    },
  }
}
