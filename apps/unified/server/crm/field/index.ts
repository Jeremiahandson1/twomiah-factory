// Field work: takeoffs, selections, job costing, routing, maps, geofencing, weather, payroll.
//
// Feature gates: takeoffs, selections and job costing carry the gate the template's index.ts put on them. Routing,
// maps, geofencing and weather were ungated in the template and no web screen calls them (the mobile app posts
// /api/geofencing/location), so they stay ungated. Payroll was ungated in the template, but its only screen (the Pay
// run panel) is on the Time screen, which the sidebar gates on time_tracking, so the API is gated the same.
//
// The customer portal needs the selections service the template exported: createSelectionsService (./selectionsService.ts).
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createTakeoffsRoutes } from './takeoffs.ts'
import { createSelectionsRoutes } from './selections.ts'
import { createJobCostingRoutes } from './jobCosting.ts'
import { createRoutingRoutes } from './routing.ts'
import { createMapsRoutes } from './maps.ts'
import { createGeofencingRoutes } from './geofencing.ts'
import { createWeatherRoutes } from './weather.ts'
import { createPayrollRoutes } from './payroll.ts'

export { createSelectionsService, type SelectionsService } from './selectionsService.ts'

export function fieldMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/takeoffs', access: 'user', feature: 'takeoff_tools', router: createTakeoffsRoutes(d) },
    { path: '/api/selections', access: 'user', feature: 'selections', router: createSelectionsRoutes(d) },
    { path: '/api/job-costing', access: 'user', feature: 'job_costing', router: createJobCostingRoutes(d) },
    { path: '/api/routing', access: 'user', router: createRoutingRoutes(d) },
    { path: '/api/maps', access: 'user', router: createMapsRoutes(d) },
    { path: '/api/geofencing', access: 'user', feature: 'gps_tracking', router: createGeofencingRoutes(d) },
    { path: '/api/weather', access: 'user', router: createWeatherRoutes(d) },
    { path: '/api/payroll', access: 'user', feature: 'time_tracking', router: createPayrollRoutes(d) },
  ]
}
