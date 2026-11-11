// Projects and their money: projects, schedules, bids, purchase orders, bills, lien waivers, draw schedules, AIA forms.
// Each behind the feature the template's index.ts gated it with.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createProjectRoutes } from './projects.ts'
import { createGanttChartRoutes } from './ganttCharts.ts'
import { createBaselineRoutes } from './baselines.ts'
import { createProjectDetailRoutes } from './projectDetails.ts'
import { createBidPackageRoutes } from './bidPackages.ts'
import { createProjectParameterRoutes } from './formulaParameters.ts'
import { createClientPortal } from './clientPortal.ts'
import { createProjectPhoneRoutes } from './phone.ts'
import { createBidRoutes } from './bids.ts'
import { createPurchaseOrderRoutes } from './purchaseOrders.ts'
import { createBillRoutes } from './bills.ts'
import { createLienWaiverRoutes } from './lienWaivers.ts'
import { createDrawScheduleRoutes } from './drawSchedules.ts'
import { createAiaFormRoutes } from './aiaForms.ts'
import { createProjectTemplateRoutes } from './projectTemplates.ts'

export function projectMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/projects', access: 'user', feature: 'projects', router: createProjectRoutes(d) },
    { path: '/api/project-templates', access: 'user', feature: 'project_templates', router: createProjectTemplateRoutes(d) },
    { path: '/api/gantt-charts', access: 'user', feature: 'gantt_charts', router: createGanttChartRoutes(d) },
    // A project's schedule saved as its baseline, and plan against now (./baselines.ts). Not ready.
    { path: '/api/project-baselines', access: 'user', feature: 'schedule_baseline', router: createBaselineRoutes(d) },
    // A project's size (price and budget per square foot) and its builder's risk policy (./projectDetails.ts). Not ready.
    { path: '/api/project-details', access: 'user', feature: 'builders_risk', router: createProjectDetailRoutes(d) },
    // Bid packages to subs, priced in the vendor portal, the winner's purchase order (./bidPackages.ts). Not ready.
    { path: '/api/bid-packages', access: 'user', feature: 'bid_packages', router: createBidPackageRoutes(d) },
    // Formula estimating (contractor parity row 9): a job's parameters; 404 while quote_formulas is off.
    { path: '/api/project-parameters', access: 'user', router: createProjectParameterRoutes(d) },
    // The client portal, finished (contractor parity row 10): per-project settings, sharing, to-dos; 404 while client_portal_plus is off.
    { path: '/api/client-portal', access: 'user', router: createClientPortal(d).routes() },
    // The contractor's phone (contractor parity row 11): cost codes by name for the clock; 404 while contractor_phone is off.
    { path: '/api/project-phone', access: 'user', router: createProjectPhoneRoutes(d) },
    { path: '/api/bids', access: 'user', feature: 'bid_management', router: createBidRoutes(d) },
    { path: '/api/purchase-orders', access: 'user', feature: 'purchase_orders', router: createPurchaseOrderRoutes(d) },
    { path: '/api/bills', access: 'user', feature: 'vendor_bills', router: createBillRoutes(d) },
    { path: '/api/lien-waivers', access: 'user', feature: 'lien_waivers', router: createLienWaiverRoutes(d) },
    { path: '/api/draw-schedules', access: 'user', feature: 'draw_schedules', router: createDrawScheduleRoutes(d) },
    { path: '/api/aia-forms', access: 'user', feature: 'aia_forms', router: createAiaFormRoutes(d) },
  ]
}
