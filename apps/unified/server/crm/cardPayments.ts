// Can this business take a card from its customer right now — ONE answer for every invoice page and every charge.
//
// Stripe on this server (its keys), the business's own account connected (Settings › Integrations — a charge lands
// there, never on the platform's account), and Online Payments switched on. The CRM's invoice page offers Pay only then
// and its payment route refuses otherwise (packages/tenant-backend portal.ts, payments/stripe.ts). Home care's own
// Billing invoices are held to the same answer (crm/homecare/billing/stripe.ts): its pay page offered a card whenever
// the platform's key was set and charged it to the platform's account, and said "contact Twomiah" to a family when it
// wasn't (live test, 2026-10-23).
import type { CrmDeps } from './deps.ts'

export function cardPaymentsFor(d: Pick<CrmDeps, 'features'> & { services: { stripeService: { connectedAccountFor: (companyId: string) => Promise<string | null> } } }) {
  return async (companyId: string): Promise<boolean> =>
    !!process.env.STRIPE_PUBLISHABLE_KEY
    && !!(await d.services.stripeService.connectedAccountFor(companyId))
    && !!(await d.features.isFeatureEnabled(companyId, 'online_payments'))
}
