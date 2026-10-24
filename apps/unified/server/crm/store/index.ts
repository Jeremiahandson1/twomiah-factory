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
import { catalogMounts } from './catalog/index.ts'

/** One store core per app (keyed by its CRM services), shared by the routes and the website. */
const cores = new WeakMap<object, StoreCore>()
function coreFor(d: Pick<CrmDeps, 'db' | 'logger' | 'services'>): StoreCore {
  let core = cores.get(d.services)
  if (!core) { core = createStoreCore(d as CrmDeps); cores.set(d.services, core) }
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
  ] as Mount[]).map((m) => ({ ...m, addon: 'store' }))
}

/** What the website's shop pages read: the catalogue on sale, one product, an order received, and whether the shop is open. */
export interface Storefront {
  companyId(): Promise<string | null>
  isClosed(): Promise<boolean>
  catalogue(companyId: string): Promise<StorefrontProduct[]>
  product(companyId: string, slug: string): Promise<StorefrontProduct | null>
  /** The order summary by the provider's return (?session_id= or ?ref=), finishing an order whose payment notice is late. */
  orderSummary(companyId: string, q: { ref?: string | null; sessionId?: string | null }): Promise<OrderSummary | null>
  /** A product page's "Frequently bought together" and "You may also like". */
  upsells(companyId: string, product: StorefrontProduct): Promise<{ together: StorefrontProduct[]; alsoLike: StorefrontProduct[] }>
}
export function createStorefront(d: Pick<CrmDeps, 'db' | 'logger' | 'services'>): Storefront {
  const core = coreFor(d)
  const checkout = createCheckoutService(d as CrmDeps, core)
  return {
    companyId: async () => (await core.shop())?.id ?? null,
    isClosed: () => core.isClosed(),
    catalogue: (companyId) => storefrontCatalogue(d, companyId),
    product: (companyId, slug) => storefrontProduct(d, companyId, slug),
    orderSummary: (companyId, q) => checkout.orderSummary(companyId, q),
    upsells: (companyId, product) => productUpsells(d, companyId, product),
  }
}
