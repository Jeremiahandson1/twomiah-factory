// Home care — caregivers and hiring: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{caregivers,caregiverProfile,applications,backgroundChecks,onboardingPackets,onboardingPacketsPublic,jobPostings,careersPublic,certifications,trainingRecords,performanceReviews}.ts.
//
// The paths are the template's (its src/index.ts). Mounted only for the home-care vertical, so no feature gate (the
// template gated none of these). /api/users is home care's caregiver router under its second name, as the template
// mounted it; the CRM's own logins stay at /api/company/users.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createCaregiversRoutes } from './caregivers.ts'
import { createCaregiverProfileRoutes } from './caregiverProfile.ts'
import { createApplicationsRoutes } from './applications.ts'
import { createBackgroundChecksRoutes } from './backgroundChecks.ts'
import { createOnboardingPacketsRoutes, createOnboardingPacketsPublicRoutes } from './onboardingPackets.ts'
import { createJobPostingsRoutes, createCareersPublicRoutes } from './jobPostings.ts'
import { createCertificationsRoutes, createTrainingRecordsRoutes } from './certifications.ts'
import { createPerformanceReviewsRoutes } from './performanceReviews.ts'

export function hrMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  return [
    { path: '/api/caregivers', access: 'user', router: createCaregiversRoutes(core, d) },
    { path: '/api/users', access: 'user', router: createCaregiversRoutes(core, d) },
    { path: '/api/caregiver-profile', access: 'user', router: createCaregiverProfileRoutes(core, d) },
    { path: '/api/applications', access: 'user', router: createApplicationsRoutes(core, d) },
    { path: '/api/background-checks', access: 'user', router: createBackgroundChecksRoutes(core, d) },
    { path: '/api/onboarding-packets', access: 'user', router: createOnboardingPacketsRoutes(core, d) },
    { path: '/api/public/onboarding-packets', access: 'public', router: createOnboardingPacketsPublicRoutes(core, d) },
    { path: '/api/job-postings', access: 'user', router: createJobPostingsRoutes(core, d) },
    { path: '/api/public/careers', access: 'public', router: createCareersPublicRoutes(core, d) },
    { path: '/api/certifications', access: 'user', router: createCertificationsRoutes(core, d) },
    { path: '/api/training-records', access: 'user', router: createTrainingRecordsRoutes(core, d) },
    { path: '/api/performance-reviews', access: 'user', router: createPerformanceReviewsRoutes(core, d) },
  ]
}
