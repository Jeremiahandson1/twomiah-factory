// Roofing's insurance group (docs/UNIFIED_ROOF_PLAN.md step 3): insurance claims, supplements, adjusters, claim activity and the Xactimate export (routes/insurance.ts, services/xactimate.ts). Moved from templates/crm-roof/backend/src.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import { createInsuranceRoutes } from './insurance.ts'
import { createInsuranceExtras } from './extras.ts'
import { createPermitRoutes } from './permits.ts'

export function insuranceMounts(d: CrmDeps): Mount[] {
  // The template's index.ts gated /api/insurance with insurance_workflow.
  return [{ path: '/api/insurance', access: 'user', feature: 'insurance_workflow', router: createInsuranceRoutes(d) },
    // Held-depreciation reminders and mortgage-company checks (./extras.ts): not ready, behind their own switch.
    { path: '/api/insurance-extras', access: 'user', feature: 'insurance_extras', router: createInsuranceExtras(d) },
    // Permits on a job and the board across jobs (./permits.ts): not ready, behind their own switch.
    { path: '/api/permits', access: 'user', feature: 'roof_permits', router: createPermitRoutes(d) }]
}
