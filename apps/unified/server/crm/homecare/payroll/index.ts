// Home care — payroll, rates, mileage, expenses and PTO: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{payroll,payrollShiftReviews,payrollVerification,gusto,mileage,expenses,caregiverRates,caregiverCareTypeRates,pto}.ts,
// at the paths the template's index.ts mounted them. Mounted for the home-care vertical only, so no feature gate (the
// template gated none of them); each action checks its care-payroll permission.
//
// Two paths are also the CRM's: /api/payroll (server/crm/field, the time-tracking pay run) and /api/expenses (the shared
// expense module). Home care's are its own records (payroll_shift_reviews / payroll_records, the `expenses` table), so
// for a home-care business those two CRM mounts stand aside (server/crm/field/index.ts, server/modules/crm.ts).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createHomecarePayrollRoutes } from './payroll.ts'
import { createPayrollShiftReviewRoutes } from './payrollShiftReviews.ts'
import { createPayrollVerificationRoutes } from './payrollVerification.ts'
import { createGustoRoutes } from './gusto.ts'
import { createMileageRoutes } from './mileage.ts'
import { createHomecareExpenseRoutes } from './expenses.ts'
import { createCaregiverRateRoutes } from './caregiverRates.ts'
import { createCaregiverCareTypeRateRoutes } from './caregiverCareTypeRates.ts'
import { createPtoRoutes } from './pto.ts'
import { createPayRulesRoutes } from './payRulesRoutes.ts'
import { createPayrollProviderRoutes } from './providersRoutes.ts'

export function payrollMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  return [
    { path: '/api/payroll', access: 'user', router: createHomecarePayrollRoutes(core, d) },
    { path: '/api/payroll-shift-reviews', access: 'user', router: createPayrollShiftReviewRoutes(core, d) },
    // Not under /api/payroll: a caregiver confirms their own hours here.
    { path: '/api/payroll-verification', access: 'user', router: createPayrollVerificationRoutes(core, d) },
    { path: '/api/gusto', access: 'user', router: createGustoRoutes(core, d) },
    { path: '/api/mileage', access: 'user', router: createMileageRoutes(core, d) },
    { path: '/api/expenses', access: 'user', router: createHomecareExpenseRoutes(d) },
    { path: '/api/caregiver-rates', access: 'user', router: createCaregiverRateRoutes(core, d) },
    { path: '/api/caregiver-care-type-rates', access: 'user', router: createCaregiverCareTypeRateRoutes(d) },
    { path: '/api/pto', access: 'user', router: createPtoRoutes(d) },
    // item 2: overtime rules, paid travel, ADP / Paychex files (not ready)
    { path: '/api/pay-rules', access: 'user', feature: 'care_payroll_rules', router: createPayRulesRoutes(core, d) },
    // row 21: live pushes to ADP, Paychex, Gusto and the embedded full-service provider (not ready)
    { path: '/api/payroll-providers', access: 'user', feature: 'care_payroll_providers', router: createPayrollProviderRoutes(core, d) },
  ]
}
