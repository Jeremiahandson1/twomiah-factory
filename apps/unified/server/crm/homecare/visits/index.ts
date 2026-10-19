// Home care — visits: time, EVV, IVR, GPS and Sandata: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{timeTracking,evv,ivr,sandata,visitDocumentation,visitChangeRequests,alerts}.ts.
// The paths are the template's (its src/index.ts). None was behind a feature there, and none is here: they are mounted
// only for the home-care vertical. Each action checks its own permission (see each file's header).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createTimeTrackingRoutes } from './timeTracking.ts'
import { createEvvRoutes } from './evv.ts'
import { createIvrRoutes } from './ivr.ts'
import { createSandataRoutes } from './sandata.ts'
import { createVisitDocumentationRoutes } from './visitDocumentation.ts'
import { createVisitChangeRequestRoutes } from './visitChangeRequests.ts'
import { createAlertRoutes } from './alerts.ts'

export { createVisitChanges, CANCEL_NOTICE_HOURS, hoursUntilVisit, visitIdentity, type VisitChanges } from './visitChanges.ts'

export function visitsMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  return [
    // The punch: the office's Time & GPS page at /api/time-tracking, the caregiver app at /api/time-entries — one
    // router, built twice (two paths may not share a router instance's mount).
    { path: '/api/time-tracking', access: 'user', router: createTimeTrackingRoutes(core, d) },
    { path: '/api/time-entries', access: 'user', router: createTimeTrackingRoutes(core, d) },
    { path: '/api/evv', access: 'user', router: createEvvRoutes(core, d) },
    { path: '/api/sandata', access: 'user', router: createSandataRoutes(core, d) },
    { path: '/api/visit-docs', access: 'user', router: createVisitDocumentationRoutes(core, d) },
    { path: '/api/visit-change-requests', access: 'user', router: createVisitChangeRequestRoutes(core, d) },
    { path: '/api/alerts', access: 'user', router: createAlertRoutes(core, d) },
    // The phone line: Twilio's webhooks, no session — each request proves it is Twilio (ivr.ts).
    { path: '/api/ivr', access: 'public', router: createIvrRoutes(core, d) },
  ]
}
