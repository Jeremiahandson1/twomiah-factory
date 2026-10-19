// Home care — caregivers and hiring: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{caregivers,caregiverProfile,applications,backgroundChecks,onboardingPackets,onboardingPacketsPublic,jobPostings,careersPublic,certifications,trainingRecords,performanceReviews}.ts.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

export function hrMounts(_core: HomecareCore, _d: CrmDeps): Mount[] {
  return []
}
