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
import { createSegmentRoutes } from './segments/routes.ts'
import { createFollowups } from './followups/followups.ts'
import { createFollowupRoutes } from './followups/routes.ts'
import { createReorderRoutes } from './reorders/routes.ts'
import { createAudienceRoutes } from './audiences/routes.ts'
import { audiencesEnabled, settingsRow as audienceSettings } from './audiences/audiences.ts'
import { createExpressRoutes } from './checkout/expressRoutes.ts'
import { createStoreGiftCards } from './giftCards.ts'
import { createStoreEvents, registerStoreEvents } from './apps/events.ts'
import { createApiKeys } from './apps/apiKeys.ts'
import { createStoreApi } from './apps/publicApi.ts'
import { createApiKeyRoutes, createAppsRoutes, createWebhookRoutes } from './apps/routes.ts'

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
  const followups = createFollowups(d, core)
  d.services.addJob(() => followups.start())
  // 2026-10-31, parity row 8: what happens in the store is told to the shop's webhooks (store_webhooks); the retries run on a timer.
  const events = createStoreEvents(d)
  registerStoreEvents(d.services, events)
  d.services.addJob(() => { const t = setInterval(() => { void events.webhooks.sweep().catch((e: any) => d.logger.warn('[store] webhook sweep failed', { error: e?.message })) }, 60_000); (t as any).unref?.() })
  const apiKeys = createApiKeys(d.db)
  return ([
    // The payment and supplier webhooks move an order's refunds and status by the orders group's rules.
    ...checkoutMounts(d, core, createOrderHooks(d, core)),
    ...ordersMounts(d, core),
    ...catalogMounts(d, core),
    // 2026-10-31, parity row 2: saved customer segments (marketing:read), behind store_segments (not ready).
    { path: '/api/admin/segments', access: 'user', feature: 'store_segments', router: createSegmentRoutes(d, followups.segmentInUse) },
    // 2026-10-31, parity row 3: the post-purchase emails' settings (marketing:read / marketing:update), behind store_followups (not ready).
    { path: '/api/admin/followups', access: 'user', feature: 'store_followups', router: createFollowupRoutes(d, followups) },
    // 2026-10-31, parity row 4: "Draft a reorder" — supplier purchase orders (margin:read, products:update), behind store_reorders (not ready).
    { path: '/api/admin/reorders', access: 'user', feature: 'store_reorders', router: createReorderRoutes(d, core) },
    // 2026-10-31, parity row 7: a segment as an ad audience (hashed file, direct push) and the purchase tags, behind store_audiences (not ready).
    { path: '/api/admin/audiences', access: 'user', feature: 'store_audiences', router: createAudienceRoutes(d) },
    // 2026-10-31, parity row 6: Apple Pay / Google Pay / Link buttons (quote, intent, keys), behind store_fast_checkout (not ready), 404 when off.
    { path: '/api/public/express', access: 'public', feature: 'store_fast_checkout', router: createExpressRoutes(d, core, createCheckoutService(d, core), createStoreGiftCards(d, core)) },
    // 2026-10-31, parity row 8: Apps & integrations — the catalogue, the outgoing webhooks, the Store API keys (each hidden, 403 when off) and
    // the Store API itself, which answers to a key rather than a sign-in (public, 404 when off).
    { path: '/api/admin/apps', access: 'user', feature: 'store_apps', router: createAppsRoutes(d, core) },
    { path: '/api/admin/store-webhooks', access: 'user', feature: 'store_webhooks', router: createWebhookRoutes(d, events) },
    { path: '/api/admin/store-api-keys', access: 'user', feature: 'store_api', router: createApiKeyRoutes(d, apiKeys) },
    { path: '/api/store/v1', access: 'public', feature: 'store_api', router: createStoreApi(d, core, apiKeys) },
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
  /** Whether the order-received page reports the purchase to Tag Manager and the Meta pixel (store_audiences on, and the shop switched it on). */
  purchaseTags(companyId: string): Promise<boolean>
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
    purchaseTags: async (companyId) => (await audiencesEnabled(d as any, companyId)) && !!(await audienceSettings(d.db, companyId).catch(() => null))?.purchaseEventsOn,
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
