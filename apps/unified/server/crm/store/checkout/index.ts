// The store's checkout group (docs/UNIFIED_STORE_PLAN.md step 3): the storefront's public API, the merchant's payment
// connection, and the checkout sweeps. Moved from templates/crm-store/backend/src (routes/public.ts, routes/payments.ts,
// services/abandonedCart.ts, services/reviews.ts, and the timers index.ts started).
//
// Mounts:
//   · /api/public          public — the storefront's API (./publicRoutes.ts). Shared with other public routers
//                          (/api/public/ads-experiments), so its store-closed door and rate limits are on its own paths;
//   · /api/admin/payments  user — the payment connection (./paymentRoutes.ts), connect/disconnect behind payments:update.
// No feature gate on either: the template gated nothing (every store feature is core) and its menu shows Payments to
// every seat.
//
// Timers (registered with services.addJob — started once at boot, never in tests): stale pending orders (hourly and at
// boot), abandoned-cart reminders (every 30 minutes, first after a minute), review requests (every 6 hours, first after
// two minutes), and the once-after-boot webhook set-up (30 s). The supplier sweep and the pending-refund resume are the
// orders group's.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { createCheckoutService } from './checkoutService.ts'
import { createStorePublicRoutes, type OrderHooks } from './publicRoutes.ts'
import { createStorePaymentRoutes, ensurePayPalWebhookEvents, ensureStripeWebhookEvents } from './paymentRoutes.ts'

export type { OrderHooks } from './publicRoutes.ts'
export { createCheckoutService } from './checkoutService.ts'
export { storefrontCatalogue, storefrontProduct } from './catalogue.ts'

/**
 * `orders` is what the orders group lends the webhooks (the lifecycle and a provider's refund notice). Until it is
 * passed, a refund notice or a supplier's "shipped" answers 503, so the provider sends it again later.
 */
export function checkoutMounts(d: CrmDeps, core: StoreCore, orders?: OrderHooks): Mount[] {
  const checkout = createCheckoutService(d, core)

  d.services.addJob(() => {
    const log = (what: string) => (err: any) => d.logger.warn(`[store] ${what} failed`, { error: err?.message })
    setInterval(() => { void checkout.sweepStalePending() }, 60 * 60 * 1000)
    void checkout.sweepStalePending()
    // Abandoned carts: remind once, then let the sweep above age them out.
    setInterval(() => { checkout.sweepAbandonedCarts().catch(log('abandoned-cart sweep')) }, 30 * 60 * 1000)
    setTimeout(() => { checkout.sweepAbandonedCarts().catch(log('abandoned-cart sweep')) }, 60_000)
    // Ask for a review once, a few days after an order ships.
    setInterval(() => { checkout.sweepReviewRequests().catch(log('review-request sweep')) }, 6 * 60 * 60 * 1000)
    setTimeout(() => { checkout.sweepReviewRequests().catch(log('review-request sweep')) }, 120_000)
    // A store connected before refunds were listened for has its webhook brought up to date, so refunds made in the
    // provider's dashboard reach the order. (10/12, 10/17)
    setTimeout(() => { void ensureStripeWebhookEvents(d, core); void ensurePayPalWebhookEvents(d, core) }, 30_000)
  })

  return [
    { path: '/api/public', access: 'public', router: createStorePublicRoutes(d, core, checkout, orders) },
    { path: '/api/admin/payments', access: 'user', router: createStorePaymentRoutes(d) },
  ]
}
