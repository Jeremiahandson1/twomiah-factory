// Home care — the client and family portals, messages and notifications: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{portal,portalVisits,familyPortal,messages,communication,communicationLog,notifications,notificationSettings,push,sms}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function portalsMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
