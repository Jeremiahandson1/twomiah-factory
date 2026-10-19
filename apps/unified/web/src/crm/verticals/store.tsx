// The store: its own screens (crm/pages/store/{orders,catalog}) — docs/UNIFIED_STORE_PLAN.md step 4. Its customers are
// the CRM's contacts; its team, audit log, help and the line to Twomiah are the shared screens.
import type { ReactElement } from 'react'
import type { NavItem } from '../../shared'
import { verticalScreens } from '../vertical'
import * as orders from '../pages/store/orders'
import * as catalog from '../pages/store/catalog'

const home = verticalScreens().home
/** True where this page was served for a store (verticals/store/settings.ts screens.home). Read once. */
export const isStore = typeof home === 'string' && home === 'store'

const GROUPS = [orders, catalog]

/** Routes inside /crm, for a store only. */
export const routes: ReactElement[] = isStore ? GROUPS.flatMap((g) => g.routes) : []
/** Menu items, for a store only, each behind the permission its page asks. */
export const nav: NavItem[] = isStore ? GROUPS.flatMap((g) => g.nav) : []

// The store's menu, in its own order (templates/crm-store frontend components/layout/AppLayout.tsx): its pages and the
// shared ones it uses among them. /crm/dashboard is the shared item, which shows the store's home (crm/screens.tsx HOMES).
const ORDER = [
  '/crm/dashboard', '/crm/products', '/crm/orders', '/crm/customers', '/crm/payments', '/crm/discounts', '/crm/store-loyalty',
  '/crm/suppliers', '/crm/shipping', '/crm/product-reviews', '/crm/google-reviews', '/crm/email', '/crm/domain',
  '/crm/store-settings', '/crm/audit',
]

/**
 * A store's whole menu: its order first, then any other shared item it has (the team, help, Contact Twomiah) — each still
 * behind its own feature and permission, so a contractor's jobs, quotes and invoices, which a store is never offered,
 * don't show. The shared Contacts item is the Customers list's (a shopper is a contact), so it's left out.
 */
export function storeMenu(shared: NavItem[]): NavItem[] {
  const own = new Map(nav.map((i) => [i.to, i]))
  const base = shared.filter((i) => !nav.includes(i) && !own.has(i.to) && i.to !== '/crm/contacts')
  const theirs = new Map(base.map((i) => [i.to, i]))
  const ordered = ORDER.map((to) => own.get(to) ?? theirs.get(to)).filter(Boolean) as NavItem[]
  const used = new Set(ORDER)
  const rest = [...nav.filter((i) => !used.has(i.to)), ...base.filter((i) => !used.has(i.to))]
  return [...ordered, ...rest]
}
/** The permission each store page asks, for a URL typed in (the shell's routePermissions). */
export const routePermissions: Record<string, string> = isStore ? Object.assign({}, ...GROUPS.map((g) => g.routePermissions)) : {}
/** The store's own Settings card (crm/screens.tsx extraSubPages), for a store only. */
export const SETTINGS_EXTRA = isStore ? catalog.SETTINGS_EXTRA : []
/** The store's home at /crm/dashboard (crm/screens.tsx HOMES). */
export const dashboard = orders.dashboard
