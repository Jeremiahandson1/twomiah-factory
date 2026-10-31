// The store: the add-on (docs/UNIFIED_STORE_PLAN.md). Its route groups register here, each given the shared services
// built once (./core.ts). Its customers are the CRM's contacts, its loyalty the shared programme, its sign-in, team,
// company, audit, email and billing the engine's.
//   checkout/  the storefront's public API: the catalogue it shows, checkout, the payment webhooks, the order summary,
//              cart recovery, a shopper's review; the merchant's payment connection; the pending-order sweeps
//   orders/    the back office's orders: status and fulfilment, refunds, the label carrier, dropship suppliers
//   catalog/   products, variants and images; discount codes; review moderation; the loyalty programme; the settings
// The website's shop pages (server/site/routes.ts) read the same store through createStorefront.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createStoreCore, type StoreCore } from './core.ts'
import { checkoutMounts } from './checkout/index.ts'
import { createCheckoutService, type OrderSummary } from './checkout/checkoutService.ts'
import { productUpsells, storefrontCatalogue, storefrontProduct, type StorefrontProduct } from './checkout/catalogue.ts'
import { ordersMounts, createOrderHooks } from './orders/index.ts'
import { ratingSummaries } from '../../data/storeCheckout.ts'
import { catalogMounts } from './catalog/index.ts'
import { createShopperAccountRoutes } from './accounts/routes.ts'

/** One store core per app (keyed by its CRM services), shared by the routes and the website. */
const cores = new WeakMap<object, StoreCore>()
function coreFor(d: Pick<CrmDeps, 'db' | 'logger' | 'services'>): StoreCore {
  let core = cores.get(d.services)
  if (!core) { core = createStoreCore(d); cores.set(d.services, core) }
  return core
}

/** The store add-on's mounts, for a vertical that has it (CrmSettings.store), each named as the add-on's. */
export function storeMounts(d: CrmDeps): Mount[] {
  if (!d.settings?.store) return []
  const core = coreFor(d)
  return ([
    // The payment and supplier webhooks move an order's refunds and status by the orders group's rules.
    ...checkoutMounts(d, core, createOrderHooks(d, core)),
    ...ordersMounts(d, core),
    ...catalogMounts(d, core),
    // 2026-10-30, gap 7: shoppers sign in (their own cookie, not the staff's); behind store_accounts (not ready), 404 when off.
    { path: '/api/public/account', access: 'public', feature: 'store_accounts', router: createShopperAccountRoutes(d, core) },
  ] as Mount[]).map((m) => ({ ...m, addon: 'store' }))
}

/** What the website's shop pages read: the catalogue on sale, one product, an order received, and whether the shop is open. */
export interface Storefront {
  companyId(): Promise<string | null>
  isClosed(): Promise<boolean>
  /** Whether shoppers can sign in to an account (the store_accounts feature): the Account pages exist only then. */
  accountsOn(companyId: string): Promise<boolean>
  catalogue(companyId: string): Promise<StorefrontProduct[]>
  product(companyId: string, slug: string): Promise<StorefrontProduct | null>
  /** The order summary by the provider's return (?session_id= or ?ref=), finishing an order whose payment notice is late. */
  orderSummary(companyId: string, q: { ref?: string | null; sessionId?: string | null }): Promise<OrderSummary | null>
  /** A product page's "Frequently bought together" and "You may also like". */
  upsells(companyId: string, product: StorefrontProduct): Promise<{ together: StorefrontProduct[]; alsoLike: StorefrontProduct[] }>
  /**
   * A product page's reviews: the approved ones and their average, and whether the shop takes new ones (Store settings'
   * reviewsEnabled). Store live test, 2026-10-26: the product page had no review form though Product Reviews was there.
   */
  reviews(companyId: string, product: StorefrontProduct): Promise<{ open: boolean; reviews: any[]; summary: { average: number; count: number } }>
}
// `audit`: finishing an order from the thank-you page writes its "paid" row (checkoutService finalizeOrder). Without it the
// website's copy crashed right after marking the order paid — no order emails, no audit row (store final check, 2026-10-26);
// an `as CrmDeps` cast had hidden the missing piece from the type check.
export function createStorefront(d: Pick<CrmDeps, 'db' | 'logger' | 'services' | 'audit'> & { isFeatureEnabled?: (companyId: string, feature: string) => Promise<boolean> }): Storefront {
  const core = coreFor(d)
  const checkout = createCheckoutService(d, core)
  return {
    companyId: async () => (await core.shop())?.id ?? null,
    isClosed: () => core.isClosed(),
    accountsOn: async (companyId) => (d.isFeatureEnabled ? await d.isFeatureEnabled(companyId, 'store_accounts').catch(() => false) : false),
    catalogue: (companyId) => storefrontCatalogue(d, companyId),
    product: (companyId, slug) => storefrontProduct(d, companyId, slug),
    orderSummary: (companyId, q) => checkout.orderSummary(companyId, q),
    upsells: (companyId, product) => productUpsells(d, companyId, product),
    reviews: async (companyId, product) => {
      const id = (product as any).id as string
      const [settings, reviews, summary] = await Promise.all([core.settings(companyId), checkout.approvedReviews(companyId, id, 20), ratingSummaries(d.db, companyId, [id])])
      return { open: settings.reviewsEnabled !== false, reviews, summary: summary[id] ?? { average: 0, count: 0 } }
    },
  }
}
