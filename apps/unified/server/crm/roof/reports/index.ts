// Roofing's reports group (docs/UNIFIED_ROOF_PLAN.md step 3c): measurements, roof reports and the public instant
// estimator, with packages/roof-core (routes/measurements.ts, roofReports.ts, estimator.ts, settings.ts' estimator, and
// index.ts' Factory review endpoints). Moved from templates/crm-roof/backend/src.
//
// Gates, both sides the same (templates/crm-roof index.ts and frontend AppLayout.tsx):
//   · /api/measurements — measurement_reports, the switch whose name and description are this module ("Satellite roof
//     measurement ordering"); the template mounted it ungated and showed its menu item to every roofer, so a roofer
//     could order Google Solar measurements and add credits without paying while the feature was not ready (owner,
//     2026-10-19: "none of those roof features should be on"). Its menu item and the job page's card carry it too;
//   · /api/roof-reports — measurement_reports, applied inside the router after the two shared-link paths;
//   · /api/estimator — public, behind instant_estimator (the menu's Roof Estimator switch; the template's API had none);
//   · /api/settings — only PUT /estimator; ungated, as the template's settings router and its Settings card were.
// No timers: the template started none for these routes (a measurement is processed right after its order's reply).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import { createMeasurementRoutes } from './measurements.ts'
import { createRoofReportRoutes, createRoofReportInternalRoutes } from './roofReports.ts'
import { createEstimatorRoutes, createEstimatorSettingsRoutes } from './estimator.ts'

export function reportsMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/measurements', access: 'user', feature: 'measurement_reports', router: createMeasurementRoutes(d) },
    { path: '/api/roof-reports', access: 'public', router: createRoofReportRoutes(d) },
    { path: '/api/internal/roof-reports', access: 'factory', router: createRoofReportInternalRoutes(d) },
    { path: '/api/estimator', access: 'public', feature: 'instant_estimator', router: createEstimatorRoutes(d) },
    { path: '/api/settings', access: 'user', router: createEstimatorSettingsRoutes(d) },
  ]
}
