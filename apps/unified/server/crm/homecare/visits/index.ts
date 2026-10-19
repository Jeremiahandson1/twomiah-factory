// Home care — visits: time, EVV, IVR, GPS and Sandata: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{timeTracking,evv,ivr,sandata,visitDocumentation,visitChangeRequests,alerts}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function visitsMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
