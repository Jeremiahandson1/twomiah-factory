// Landscaping: the modules templates/crm-landscaping has and the base CRM doesn't, each behind the feature its index.ts
// gated it with (docs/UNIFIED_MOVE_GUIDE.md, step 3e). Served to every vertical; the features decide who sees them (the
// registry offers recurring_routes, area_pricing and snow_billing to landscaping only).
//
// /api/sites was ungated in the template. Its only screens are the property pickers on Snow Billing, Area Pricing and
// the Route Board, each gated by its feature, so the API is gated on any of the three (gate both sides).
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createRecurringRouteRoutes } from './recurringRoutes.ts'
import { createRouteBillingRoutes } from './routeBilling.ts'
import { createAreaPricingRoutes } from './areaPricing.ts'
import { createSnowBillingRoutes } from './snowBilling.ts'
import { createSiteRoutes } from './sites.ts'

export function landscapingMounts(d: CrmDeps): Mount[] {
  return [
    // Billing the route's visits (preview, the monthly run and its undo, one visit). Mounted BEFORE the board's own router, so
    // /api/recurring-routes/billing/... is never read as a route id.
    { path: '/api/recurring-routes/billing', access: 'user', feature: 'recurring_routes', router: createRouteBillingRoutes(d) },
    { path: '/api/recurring-routes', access: 'user', feature: 'recurring_routes', router: createRecurringRouteRoutes(d) },
    { path: '/api/area-pricing', access: 'user', feature: 'area_pricing', router: createAreaPricingRoutes(d) },
    { path: '/api/snow', access: 'user', feature: 'snow_billing', router: createSnowBillingRoutes(d) },
    { path: '/api/sites', access: 'user', feature: ['snow_billing', 'area_pricing', 'recurring_routes'], router: createSiteRoutes(d) },
  ]
}
