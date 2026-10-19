// Home care — billing: authorizations, invoices, claims, EDI, remittance, payments: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{billing,claims,edi,remittance,payments,payers,authorizations,pricing,stripe}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function billingMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
