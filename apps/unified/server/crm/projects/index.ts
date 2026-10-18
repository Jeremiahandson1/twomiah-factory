// Projects and their money: projects, schedules, bids, purchase orders, bills, lien waivers, draw schedules, AIA forms.
// Each behind the feature the template's index.ts gated it with.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createProjectRoutes } from './projects.ts'
import { createGanttChartRoutes } from './ganttCharts.ts'
import { createBidRoutes } from './bids.ts'
import { createPurchaseOrderRoutes } from './purchaseOrders.ts'
import { createBillRoutes } from './bills.ts'
import { createLienWaiverRoutes } from './lienWaivers.ts'
import { createDrawScheduleRoutes } from './drawSchedules.ts'
import { createAiaFormRoutes } from './aiaForms.ts'

export function projectMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/projects', access: 'user', feature: 'projects', router: createProjectRoutes(d) },
    { path: '/api/gantt-charts', access: 'user', feature: 'gantt_charts', router: createGanttChartRoutes(d) },
    { path: '/api/bids', access: 'user', feature: 'bid_management', router: createBidRoutes(d) },
    { path: '/api/purchase-orders', access: 'user', feature: 'purchase_orders', router: createPurchaseOrderRoutes(d) },
    { path: '/api/bills', access: 'user', feature: 'vendor_bills', router: createBillRoutes(d) },
    { path: '/api/lien-waivers', access: 'user', feature: 'lien_waivers', router: createLienWaiverRoutes(d) },
    { path: '/api/draw-schedules', access: 'user', feature: 'draw_schedules', router: createDrawScheduleRoutes(d) },
    { path: '/api/aia-forms', access: 'user', feature: 'aia_forms', router: createAiaFormRoutes(d) },
  ]
}
