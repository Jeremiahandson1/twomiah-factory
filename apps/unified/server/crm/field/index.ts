// Field work: takeoffs, selections, job costing, routing, maps, geofencing, weather, payroll.
//
// Feature gates: takeoffs, selections and job costing carry the gate the template's index.ts put on them. Routing,
// maps and weather were ungated in the template and no screen in any copy, web or mobile, calls them: each is gated
// on its feature (RULEBOOK §6), so a business without it — a salon, a vet, a website — cannot reach it. Geofencing is
// gps_tracking's (the mobile app posts /api/geofencing/location). Payroll was ungated in the template, but its only
// screen (the Pay run panel) is on the Time screen, which the sidebar gates on time_tracking, so the API is gated the same.
//
// The customer portal needs the selections service the template exported: createSelectionsService (./selectionsService.ts).
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createTakeoffsRoutes } from './takeoffs.ts'
import { createSelectionsRoutes } from './selections.ts'
import { createJobCostingRoutes } from './jobCosting.ts'
import { createRoutingRoutes } from './routing.ts'
import { createMapsRoutes, createMapCenterRoutes } from './maps.ts'
import { createGeofencingRoutes } from './geofencing.ts'
import { createWeatherRoutes } from './weather.ts'
import { createPayrollRoutes } from './payroll.ts'

export { createSelectionsService, type SelectionsService } from './selectionsService.ts'

export function fieldMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/takeoffs', access: 'user', feature: 'takeoff_tools', router: createTakeoffsRoutes(d) },
    { path: '/api/selections', access: 'user', feature: 'selections', router: createSelectionsRoutes(d) },
    { path: '/api/job-costing', access: 'user', feature: 'job_costing', router: createJobCostingRoutes(d) },
    { path: '/api/routing', access: 'user', feature: 'route_optimization', router: createRoutingRoutes(d) },
    { path: '/api/maps', access: 'user', feature: 'map_view', router: createMapsRoutes(d) },
    // Where a new map opens (the business's address or service area): every map screen's, so no one map's feature.
    { path: '/api/map-center', access: 'user', router: createMapCenterRoutes(d) },
    { path: '/api/geofencing', access: 'user', feature: 'gps_tracking', router: createGeofencingRoutes(d) },
    // The forecast for a job or a project, and the weather filled into a daily log.
    { path: '/api/weather', access: 'user', feature: ['jobs', 'projects', 'daily_logs'], router: createWeatherRoutes(d) },
    // Home care's /api/payroll is its own pay run (server/crm/homecare/payroll/payroll.ts), so this one stands aside there.
    ...(d.settings?.homecare ? [] : [{ path: '/api/payroll', access: 'user' as const, feature: 'time_tracking', router: createPayrollRoutes(d) }]),
  ]
}
