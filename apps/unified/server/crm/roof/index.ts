// Roofing: the add-on (docs/UNIFIED_ROOF_PLAN.md) — its route groups register here, each behind the feature roofing
// gates it with. Roofing's jobs are the CRM's job table under roofing's own module (./jobs.ts, mounted at /api/jobs by
// server/modules/crm.ts in place of the shared one); its customers, quotes, invoices and portal are the CRM's.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { insuranceMounts } from './insurance/index.ts'
import { reportsMounts } from './reports/index.ts'
import { fieldMounts } from './field/index.ts'
import { inspectionMounts } from './inspection/index.ts'
import { portalFilesMounts } from './portalFiles/index.ts'
import { createRoofCollector } from './collected.ts'
import { createWorkOrderRoutes } from './workOrders.ts'
import { createCrewLinkRoutes } from './crewLink.ts'
import { createPipelineRoutes } from './pipeline.ts'
import { createRoofCommissions } from './commissions.ts'
import { createRoofMoneyRoutes } from './moneySettings.ts'

/** The roofing add-on's mounts, for a vertical that has it (CrmSettings.roof), each named as the add-on's. */
export function roofMounts(d: CrmDeps): Mount[] {
  if (!d.settings?.roof) return []
  // A job whose invoices are all paid is Collected (./collected.ts), however the money came in.
  d.services.onInvoicePaid?.(createRoofCollector(d).collectIfPaid)
  // …and the rep who sold it is paid what the company's plans owe, once the job is Collected (./commissions.ts). Runs after the
  // step above, which is what moves the job there.
  d.services.onInvoicePaid?.(createRoofCommissions(d).earnForInvoice)
  return ([
    ...insuranceMounts(d),
    ...reportsMounts(d),
    ...fieldMounts(d),
    // Work orders for crews and subs (not ready): the office's side, and the crew's private link (no sign-in).
    { path: '/api/work-orders', access: 'user', feature: 'roof_work_orders', router: createWorkOrderRoutes(d) },
    { path: '/api/crew-link', access: 'public', feature: 'roof_work_orders', router: createCrewLinkRoutes(d) },
    // The company's money rules for commissions and job costing (./moneySettings.ts): its minimum profit, and — as the rows land — the
    // disclaimer, who sees commissions and the worksheet approval. An existing feature id: commission tracking.
    { path: '/api/roof-money', access: 'user', feature: 'commission_tracking', router: createRoofMoneyRoutes(d) },
    // What the company calls its stages, and its Retail and Insurance boards (./pipeline.ts): not ready, display names only.
    { path: '/api/roof-pipeline', access: 'user', feature: 'pipeline_boards', router: createPipelineRoutes(d) },
    ...inspectionMounts(d),
    ...portalFilesMounts(d),
  ] as Mount[]).map((m) => ({ ...m, addon: 'roof' }))
}
