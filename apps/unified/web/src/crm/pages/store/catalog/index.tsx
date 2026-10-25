// The store's catalog screens (docs/UNIFIED_STORE_PLAN.md step 4): their routes under /crm, their menu items and the
// permission each page's main API asks. Moved from templates/crm-store/frontend/src/pages/{ProductsPage, ProductEditPage,
// DiscountsPage, ReviewsPage, LoyaltyPage, SettingsPage}.tsx. DomainPage is every business's now (crm/pages/DomainPage.tsx,
// routed in App.tsx, on the shell's menu under Website); the store's menu still lists it in its own order (verticals/store.tsx).
//
// The menu is the template's (components/layout/AppLayout.tsx) order for these pages — Products, Discounts, Loyalty,
// Reviews, Domain — each gated by the permission its page's main API asks (server/crm/store/catalog/*.ts,
// server/modules/domain.ts). The template gated only Domain; the others it showed to every seat, which the store's three
// seats all hold — the permission is named here so a seat without it is never offered a page that refuses it. None has a
// feature: the store's catalogue is core (server/crm/store/catalog/index.ts).
//
// Two addresses differ from the template's, because the app already has a page at each:
//   · product reviews are /crm/product-reviews — /crm/reviews is the CRM's Google review requests (shell.ts, the
//     google_reviews feature; App.tsx registers its route for every business);
//   · loyalty is /crm/store-loyalty — /crm/loyalty is the salon's Loyalty screen (crm/verticals/salon.tsx registers it for
//     every business), over the salon's API.
//
// The template's Settings page is split: the team, two-factor, password and email links are the shared screens; the
// store's own part (the name and support email, currency, tax, shipping and its zones, regional tax rates, the
// abandoned-cart and review-request emails) is one page at /crm/store-settings (the menu's Store Settings, and a card on Settings: SETTINGS_EXTRA below).
//
// Not moved: OnboardingWizard.tsx — the engine's wizard (crm/pages/OnboardingWizard.tsx) is every vertical's first run
// (business details, integrations, branded email, help, done), so the store's is not a second one.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { CreditCard, Gift, Package, Star, Store, Tag, Users } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const ProductsPage = page(() => import('./ProductsPage'))
const ProductEditPage = page(() => import('./ProductEditPage'))
const DiscountsPage = page(() => import('./DiscountsPage'))
const ReviewsPage = page(() => import('./ReviewsPage'))
const LoyaltyPage = page(() => import('./LoyaltyPage'))
const StoreSettingsPage = page(() => import('./StoreSettingsPage'))
const GiftCardsPage = page(() => import('./GiftCardsPage'))
const CustomerGroupsPage = page(() => import('./CustomerGroupsPage'))

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route key="store-products" path="products" element={<ProductsPage />} />,
  <Route key="store-product-new" path="products/new" element={<ProductEditPage />} />,
  <Route key="store-product" path="products/:id" element={<ProductEditPage />} />,
  <Route key="store-discounts" path="discounts" element={<DiscountsPage />} />,
  <Route key="store-loyalty" path="store-loyalty" element={<LoyaltyPage />} />,
  <Route key="store-reviews" path="product-reviews" element={<ReviewsPage />} />,
  <Route key="store-settings" path="store-settings" element={<StoreSettingsPage />} />,
  <Route key="store-gift-cards" path="gift-cards" element={<GiftCardsPage />} />,
  <Route key="store-customer-groups" path="customer-groups" element={<CustomerGroupsPage />} />,
]

/** Menu items, each gated by the permission its page's main API asks. */
export const nav: NavItem[] = [
  // GET /api/admin/products asks products:read (the item also gates /crm/products/new and /crm/products/:id by prefix).
  { to: '/crm/products', icon: Package, label: 'Products', permission: 'products:read' },
  // GET /api/admin/discounts asks discounts:read.
  { to: '/crm/discounts', icon: Tag, label: 'Discounts', permission: 'discounts:read' },
  // GET /api/admin/loyalty/config, /members and /rewards ask loyalty:read.
  { to: '/crm/store-loyalty', icon: Gift, label: 'Loyalty', permission: 'loyalty:read' },
  // GET /api/admin/reviews asks reviews:read.
  { to: '/crm/product-reviews', icon: Star, label: 'Reviews', permission: 'reviews:read' },
  // GET /api/admin/gift-cards asks orders:refund (a card's number is money); /customer-groups asks discounts:read.
  { to: '/crm/gift-cards', icon: CreditCard, label: 'Gift cards', permission: 'orders:refund' },
  { to: '/crm/customer-groups', icon: Users, label: 'Customer groups', permission: 'discounts:read' },
  // The store's settings: its own address, not under /crm/settings, which the shell holds to the owner and admins (a
  // rank, routeRoles) — the store's managers change shipping (shipping:configure, owner's decision 2026-10-10), so the
  // page is offered to whoever may, and shows the rest as a record to a seat that may not.
  { to: '/crm/store-settings', icon: Store, label: 'Store Settings', permission: 'shipping:configure' },
]

/** '/crm/<path>' → the permission its page's main API asks, for a URL typed in (the menu items above carry the same). */
export const routePermissions: Record<string, string> = Object.fromEntries(
  nav.filter((i) => i.permission).map((i) => [i.to, i.permission as string]),
)

/**
 * The store's own Settings card (crm/screens.tsx extraSubPages): the store's name and support email, currency and tax,
 * shipping and its zones, regional tax rates, the abandoned-cart and review-request emails. No permission on the card:
 * GET /api/admin/settings answers every seat, and the page shows each section as a record to a seat that cannot change it
 * (shipping is shipping:configure, a manager's too; the rest settings:update / company:update, the owner's).
 */
export const SETTINGS_EXTRA = [
  { to: '/crm/store-settings', label: 'Store, Shipping & Tax', icon: Store },
]
