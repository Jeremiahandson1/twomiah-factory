// Site records: RFIs, submittals, daily logs, punch lists, inspections, change orders (from templates/crm/backend/src/routes).
// Each behind the feature its template index.ts gated it with.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createRfiRoutes } from './rfis.ts'
import { createSubmittalRoutes } from './submittals.ts'
import { createDailyLogRoutes } from './dailyLogs.ts'
import { createPunchListRoutes } from './punchLists.ts'
import { createInspectionRoutes } from './inspections.ts'
import { createChangeOrderRoutes } from './changeOrders.ts'

export function siteRecordsMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/rfis', access: 'user', feature: 'rfis', router: createRfiRoutes(d) },
    { path: '/api/submittals', access: 'user', feature: 'submittals', router: createSubmittalRoutes(d) },
    { path: '/api/daily-logs', access: 'user', feature: 'daily_logs', router: createDailyLogRoutes(d) },
    { path: '/api/punch-lists', access: 'user', feature: 'punch_lists', router: createPunchListRoutes(d) },
    { path: '/api/inspections', access: 'user', feature: 'inspections', router: createInspectionRoutes(d) },
    { path: '/api/change-orders', access: 'user', feature: 'change_orders', router: createChangeOrderRoutes(d) },
  ]
}
