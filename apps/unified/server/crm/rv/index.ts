// Dealership (RV, powersports): the modules templates/crm-rv has and the base CRM doesn't (docs/UNIFIED_MOVE_GUIDE.md,
// step 3e). Served to every vertical; the features decide who sees them.
//
// Gates. The template's index.ts gated none of these; its menu gated Inventory on unit_inventory, the Sales Pipeline on
// deal_pipeline, Service on service_dept and Alerts on either, and left the rest ungated (the whole template was a
// dealership). Mounted for every vertical here, an ungated module would answer a contractor, so each is gated on the
// dealership's own features, both sides (menu: web/src/crm/verticals/rv.tsx): units on unit_inventory, the pipeline on
// deal_pipeline, repair orders on service_dept, alerts on either; everything else the template left open on any of the
// three (DEALERSHIP) — the registry offers them to crm-rv only, as core features.
//
// The dashboard (/api/dashboard) is not here: its paths are the jobs dashboard's, so it is a switch
// (CrmSettings.dashboard 'dealership', server/modules/crm.ts).
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createUnitRoutes } from './units.ts'
import { createSalesLeadRoutes } from './salesLeads.ts'
import { createRepairOrderRoutes } from './repairOrders.ts'
import { createAlertRoutes } from './alerts.ts'
import { createRentalRoutes } from './rentals.ts'
import { createAccountingRoutes } from './accounting.ts'
import { createFiRoutes } from './fi.ts'
import { createTitleRegRoutes } from './titleReg.ts'
import { createFloorplanRoutes, createLaborGuideRoutes } from './serviceData.ts'
import { createOemPartsRoutes, createPartsOrderRoutes } from './parts.ts'
import { createRecallRoutes } from './recalls.ts'
import { createSyndicationRoutes, createPublicFeedRoutes } from './syndication.ts'
import { createScheduleEventRoutes } from './scheduleEvents.ts'
import { createAiLeadRoutes, createAiReportRoutes, createAiTradeRoutes } from './ai.ts'
import { createValuationRoutes } from './valuation.ts'
import { createSeedUnitsRoute } from './seedUnits.ts'

export { createDealershipDashboardRoutes } from './dashboard.ts'

/** Any of the dealership's core features: this business is a dealership. */
export const DEALERSHIP = ['unit_inventory', 'deal_pipeline', 'service_dept']

export function rvMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/units', access: 'user', feature: 'unit_inventory', router: createUnitRoutes(d) },
    { path: '/api/sales-leads', access: 'user', feature: 'deal_pipeline', router: createSalesLeadRoutes(d) },
    { path: '/api/repair-orders', access: 'user', feature: 'service_dept', router: createRepairOrderRoutes(d) },
    // A home-care agency's /api/alerts is its own office alert queue (server/crm/homecare/visits/alerts.ts); the
    // dealership's alerts are behind dealership features such an agency never has, so the path is home care's there.
    ...(d.settings?.homecare ? [] : [{ path: '/api/alerts', access: 'user', feature: ['deal_pipeline', 'service_dept'], router: createAlertRoutes(d) } as Mount]),
    { path: '/api/ai-reports', access: 'user', feature: DEALERSHIP, router: createAiReportRoutes(d) },
    { path: '/api/ai-leads', access: 'user', feature: DEALERSHIP, router: createAiLeadRoutes(d) },
    { path: '/api/ai-trade', access: 'user', feature: 'trade_in', router: createAiTradeRoutes(d) }, // Trade-In Management's (trade_in), as its menu item is
    { path: '/api/oem-parts', access: 'user', feature: DEALERSHIP, router: createOemPartsRoutes(d) },
    { path: '/api/parts-orders', access: 'user', feature: DEALERSHIP, router: createPartsOrderRoutes(d) },
    { path: '/api/labor-guide', access: 'user', feature: DEALERSHIP, router: createLaborGuideRoutes() },
    { path: '/api/fi', access: 'user', feature: DEALERSHIP, router: createFiRoutes(d) },
    { path: '/api/title-reg', access: 'user', feature: DEALERSHIP, router: createTitleRegRoutes(d) },
    { path: '/api/floorplan', access: 'user', feature: DEALERSHIP, router: createFloorplanRoutes() },
    { path: '/api/rentals', access: 'user', feature: DEALERSHIP, router: createRentalRoutes(d) },
    { path: '/api/accounting', access: 'user', feature: DEALERSHIP, router: createAccountingRoutes(d) },
    { path: '/api/recalls', access: 'user', feature: DEALERSHIP, router: createRecallRoutes(d) },
    { path: '/api/syndication', access: 'user', feature: DEALERSHIP, router: createSyndicationRoutes(d) },
    { path: '/api/valuation', access: 'user', feature: DEALERSHIP, router: createValuationRoutes(d) },
    { path: '/api/schedule-events', access: 'user', feature: DEALERSHIP, router: createScheduleEventRoutes(d) },
    // The marketplaces pull the feed by token; switched off, it is not there (404).
    { path: '/api/public/feed', access: 'public', feature: DEALERSHIP, router: createPublicFeedRoutes(d) },
    // The Factory's website→CRM inventory copy.
    { path: '/api/internal/seed-units', access: 'factory', router: createSeedUnitsRoute(d) },
  ]
}
