// Roofing's field group (docs/UNIFIED_ROOF_PLAN.md step 3): storms, storm radar, canvassing, crews, materials and roofing's
// dashboard (routes/storms.ts, stormRadar.ts, canvassing.ts, crews.ts, materials.ts, dashboard.ts, with
// services/stormData.ts and stormRadar.ts). Moved from templates/crm-roof/backend/src.
//
// Each behind the feature roofing's index.ts gates it with; crews behind its own switch (it was ungated, as in the template's
// Crews item carries no feature). The dashboard is not mounted here: /api/dashboard is the CRM's mount, which answers
// with createRoofDashboardRoutes (./dashboard.ts) where the vertical's CrmSettings.dashboard says so.
//
// Timers: ONE — the scheduled NOAA check (stormData.ts runScheduledNoaaCheck), hourly, which does anything only for a company
// that has the hidden storm_customer_map switch on at 5 am on its own clock (owner, 2026-10-30; today no company has it). The
// template's own daily check (runDailyStormCheck, with auto-leads) was never started and still is not, and the storm-radar sync
// is a stub per provider (stormRadarService.ts). A manager, admin or the owner can run the check on demand
// (POST /api/storm-map/noaa-check, storms:update).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import { createStormRoutes } from './storms.ts'
import { createStormRadarRoutes } from './stormRadar.ts'
import { createCanvassingRoutes } from './canvassing.ts'
import { createCrewRoutes } from './crews.ts'
import { createMaterialRoutes } from './materials.ts'
import { createMaterialListRoutes } from './materialListRoutes.ts'
import { createMaterialListTemplateRoutes } from './materialListTemplates.ts'
import { createMaterialSupplyRoutes } from './materialSupplyRoutes.ts'
import { createStormMapRoutes } from './stormMap.ts'
import { createTerritoryRoutes } from './territories.ts'
import { createStormData } from './stormData.ts'

export function fieldMounts(d: CrmDeps): Mount[] {
  // The scheduled NOAA check: the CRM's boot-time job list starts it (never in tests); the switch it needs is not ready.
  d.services.addJob(() => createStormData(d).startNoaaSchedule())
  return [
    { path: '/api/storms', access: 'user', feature: 'storm_lead_gen', router: createStormRoutes(d) },
    { path: '/api/storm-radar', access: 'user', feature: 'storm_radar_overlay', router: createStormRadarRoutes(d) },
    { path: '/api/canvassing', access: 'user', feature: 'canvassing_tool', router: createCanvassingRoutes(d) },
    { path: '/api/crews', access: 'user', feature: 'crews', router: createCrewRoutes(d) }, // the Crews switch's, as its menu item and the job pages' crew pickers are (2026-10-22)
    { path: '/api/materials', access: 'user', feature: 'materials', router: createMaterialRoutes(d) },
    { path: '/api/material-list/templates', access: 'user', feature: 'roof_material_list', router: createMaterialListTemplateRoutes(d) }, // saved assumption sets (not ready)
    { path: '/api/material-list', access: 'user', feature: 'roof_material_list', router: createMaterialListRoutes(d) },
    { path: '/api/material-supply', access: 'user', feature: 'material_supply', router: createMaterialSupplyRoutes(d) }, // supplier price lists, ordering from the supplier (not ready) // the squares → material list calculator (not ready)
    // Roofing depth gap 9 (not ready): past customers in a storm's path + "check NOAA now"; drawn canvass territories.
    { path: '/api/storm-map', access: 'user', feature: 'storm_customer_map', router: createStormMapRoutes(d) },
    { path: '/api/territories', access: 'user', feature: 'canvass_territories', router: createTerritoryRoutes(d) },
  ]
}
