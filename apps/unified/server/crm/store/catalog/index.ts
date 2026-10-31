// The store's catalog group (docs/UNIFIED_STORE_PLAN.md step 3): the catalogue (products, variants, photos), discount
// codes, review moderation, the loyalty programme's admin and the commerce settings. Moved from
// templates/crm-store/backend/src/routes/{products,media,discounts,reviews,loyalty,settings}.ts.
//
// None is behind a feature: the store has no feature switches (everything is core), and the template's index.ts and
// sidebar gated none of these. The registry signs the person in; each route asks its permission.
// The template's /media proxy is not mounted here: the website's /media/* (server/site/routes.ts) serves the same
// public keys, and product uploads are stored under its prefix (./products.ts).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { createProductRoutes } from './products.ts'
import { createDiscountRoutes } from './discounts.ts'
import { createReviewRoutes } from './reviews.ts'
import { createLoyaltyAdminRoutes } from './loyalty.ts'
import { createStoreSettingsRoutes } from './settings.ts'
import { createCustomerGroupRoutes } from './groups.ts'
import { createGiftCardRoutes } from './giftCardRoutes.ts'
import { createProductWriterRoutes } from './writer.ts'

export function catalogMounts(d: CrmDeps, core: StoreCore): Mount[] {
  return [
    { path: '/api/admin/products', access: 'user', router: createProductRoutes(d, core) },
    { path: '/api/admin/discounts', access: 'user', router: createDiscountRoutes(d, core) },
    { path: '/api/admin/reviews', access: 'user', router: createReviewRoutes(d) },
    { path: '/api/admin/loyalty', access: 'user', router: createLoyaltyAdminRoutes(d, core) },
    { path: '/api/admin/settings', access: 'user', router: createStoreSettingsRoutes(d, core) },
    // 2026-10-24, the store upgrade: wholesale customer groups (discounts:*), gift cards (orders:refund).
    { path: '/api/admin/customer-groups', access: 'user', router: createCustomerGroupRoutes(d) },
    { path: '/api/admin/gift-cards', access: 'user', router: createGiftCardRoutes(d, core) },
    // 2026-10-30, gap 5: the AI product writer — drafts only, behind its (not ready) feature and products:update.
    { path: '/api/admin/product-writer', access: 'user', feature: 'store_ai_writer', router: createProductWriterRoutes(d) },
  ]
}
