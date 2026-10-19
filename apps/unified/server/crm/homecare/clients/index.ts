// Home care — clients and care: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{clients,carePlans,carePlanTemplates,careTasks,careTypes,medications,adl,clientDocuments,insuranceCards,forms,documents,emergency,serviceCodes,referralSources,prospects,prospectAppointments}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function clientsMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
