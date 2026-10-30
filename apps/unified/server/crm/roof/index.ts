// Roofing: the add-on (docs/UNIFIED_ROOF_PLAN.md) — its route groups register here, each behind the feature roofing
// gates it with. Roofing's jobs are the CRM's job table under roofing's own module (./jobs.ts, mounted at /api/jobs by
// server/modules/crm.ts in place of the shared one); its customers, quotes, invoices and portal are the CRM's.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { insuranceMounts } from './insurance/index.ts'
import { reportsMounts } from './reports/index.ts'
import { fieldMounts } from './field/index.ts'
import { inspectionMounts } from './inspection/index.ts'
import { createRoofCollector } from './collected.ts'

/** The roofing add-on's mounts, for a vertical that has it (CrmSettings.roof), each named as the add-on's. */
export function roofMounts(d: CrmDeps): Mount[] {
  if (!d.settings?.roof) return []
  // A job whose invoices are all paid is Collected (./collected.ts), however the money came in.
  d.services.onInvoicePaid?.(createRoofCollector(d).collectIfPaid)
  return ([
    ...insuranceMounts(d),
    ...reportsMounts(d),
    ...fieldMounts(d),
    ...inspectionMounts(d),
  ] as Mount[]).map((m) => ({ ...m, addon: 'roof' }))
}
