// Landscaping: the screens templates/crm-landscaping has and the base CRM doesn't (crm/pages/landscaping/), their routes under /crm and
// their menu items, each gated by the template's features so no other vertical sees them (docs/UNIFIED_MOVE_GUIDE.md).
// Its field-service screens (Dispatch, Maintenance Contracts, Parts, Flat-Rate) are field service's, in its words by
// VerticalSettings.screens.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { Route as RouteIcon, Ruler, Snowflake } from 'lucide-react'
import type { NavItem } from '../../shared'
import { page } from '../lazy'

const RecurringRoutesPage = page(() => import('../pages/landscaping/RecurringRoutesPage'))
const AreaPricingPage = page(() => import('../pages/landscaping/AreaPricingPage'))
const SnowBillingPage = page(() => import('../pages/landscaping/SnowBillingPage'))

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = [
  <Route key="landscaping-routes" path="recurring-routes" element={<RecurringRoutesPage />} />,
  <Route key="landscaping-area" path="area-pricing" element={<AreaPricingPage />} />,
  <Route key="landscaping-snow" path="snow-billing" element={<SnowBillingPage />} />,
]

/**
 * Menu items, gated by features (and the permission each page's API asks). templates/crm-landscaping shellConfig.ts.
 * The registry offers these three features to landscaping only. The Route Board's reads ask jobs:read; every read on
 * Area Pricing asks quotes:read (T63); every endpoint behind Snow Billing is invoices:* (T41).
 */
export const nav: NavItem[] = [
  { to: '/crm/recurring-routes', icon: RouteIcon, label: 'Route Board', section: 'Landscaping', features: ['recurring_routes'], permission: 'jobs:read' },
  { to: '/crm/area-pricing', icon: Ruler, label: 'Area Pricing', features: ['area_pricing'], permission: 'quotes:read' },
  { to: '/crm/snow-billing', icon: Snowflake, label: 'Snow Billing', features: ['snow_billing'], permission: 'invoices:read' },
]
