// Home care — the optimizers, the dashboard and reports: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{optimizer,scheduleOptimizer,rosterOptimizer,dashboard,reports}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function planningMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
