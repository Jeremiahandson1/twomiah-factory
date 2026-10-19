// Home care — compliance, incidents, audit, sign-in and the shared modules: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{incidents,compliance,auditLogs,audit,auth,mfa,company,help,platformSupport,onboarding,account,failsafe,webhooks,leads,calltracking,aiReceptionist,ads,adsPublic,gbp,messagingBilling,emailAliases,emailDomain,inboundMessages,inboundParse,saasBilling}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function officeMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
