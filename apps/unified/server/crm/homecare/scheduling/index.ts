// Home care — scheduling and open shifts: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{schedules,schedulesAll,schedulesEnhanced,scheduleExceptions,scheduling,schedulingHub,openShifts,shiftSwaps,absences,blackoutDates,caregiverAvailability,matching,noShow,forecast}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function schedulingMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
