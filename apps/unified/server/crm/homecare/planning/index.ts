// Home care — the optimizers, the dashboard and reports: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{optimizer,scheduleOptimizer,rosterOptimizer,dashboard,reports}.ts.
//
// The template mounted (index.ts, none behind a feature):
//   /api/route-optimizer   optimizer
//   /api/optimizer         optimizer AND scheduleOptimizer (two routers on one path; their paths do not overlap)
//   /api/roster-optimizer  rosterOptimizer
//   /api/dashboard         dashboard  → server/modules/crm.ts, CrmSettings.dashboard 'homecare' (one /api/dashboard per app)
//   /api/reports           reports    → server/modules/crm.ts, CrmSettings.reports.module 'homecare' (one /api/reports per app)
// Two routers may not share a path, so /api/optimizer is one router composing both at its root. These mounts are made
// only for the home-care vertical, so they carry no feature.
import { createMarginReportRoutes } from './marginReports.ts'
import { createReportBuilderRoutes } from './reportBuilder.ts'
import { Hono } from 'hono'
import type { Mount } from '../../../http/registry.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createRouteOptimizerRoutes } from './optimizer.ts'
import { createScheduleOptimizerRoutes } from './scheduleOptimizer.ts'
import { createRosterOptimizerRoutes } from './rosterOptimizer.ts'

export function planningMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  const routeOptimizer = createRouteOptimizerRoutes(d)
  return [
    { path: '/api/route-optimizer', access: 'user', router: routeOptimizer },
    { path: '/api/optimizer', access: 'user', router: new Hono<AppEnv>().route('/', routeOptimizer).route('/', createScheduleOptimizerRoutes(d)) },
    { path: '/api/roster-optimizer', access: 'user', router: createRosterOptimizerRoutes(d) },
    { path: '/api/margin-reports', access: 'user', feature: 'care_margin_reports', router: createMarginReportRoutes(core, d) },
    { path: '/api/report-builder', access: 'user', feature: 'care_report_builder', router: createReportBuilderRoutes(core, d) },
  ]
}
