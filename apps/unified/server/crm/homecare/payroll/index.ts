// Home care — payroll, rates, mileage, expenses and PTO: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{payroll,payrollShiftReviews,payrollVerification,gusto,mileage,expenses,caregiverRates,caregiverCareTypeRates,pto}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function payrollMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
