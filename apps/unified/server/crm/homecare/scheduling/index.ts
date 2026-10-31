// Home care — scheduling and open shifts: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{schedules,schedulesAll,schedulesEnhanced,scheduleExceptions,scheduling,schedulingHub,openShifts,shiftSwaps,absences,blackoutDates,caregiverAvailability,matching,noShow,forecast}.ts.
//
// Mounted for the home-care vertical only, so no feature gate: the template's index.ts gated none of these paths. Each
// action checks its own permission (care-schedule; matching's client writes care-clients; the forecast care-billing).
// The SQL is server/data/homecareScheduling.ts.
import { Hono } from 'hono'
import type { Mount } from '../../../http/registry.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createSchedulingShared } from './shared.ts'
import { createSchedulesRoutes } from './schedules.ts'
import { createSchedulesAllRoutes } from './schedulesAll.ts'
import { createSchedulesEnhancedRoutes } from './schedulesEnhanced.ts'
import { createScheduleExceptionsRoutes } from './scheduleExceptions.ts'
import { createSchedulingHubRoutes } from './schedulingHub.ts'
import { createSchedulingRoutes } from './scheduling.ts'
import { createOpenShiftsRoutes } from './openShifts.ts'
import { createShiftSwapsRoutes } from './shiftSwaps.ts'
import { createAbsencesRoutes } from './absences.ts'
import { createBlackoutDatesRoutes } from './blackoutDates.ts'
import { createCaregiverAvailabilityRoutes } from './caregiverAvailability.ts'
import { createMatchingRoutes } from './matching.ts'
import { createNoShowRoutes } from './noShow.ts'
import { createForecastRoutes } from './forecast.ts'
import { createPickupRewardsRoutes } from './pickupRewards.ts'

export function schedulingMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  const shared = createSchedulingShared(d)
  // The template mounted two routers on /api/scheduling — the Schedule Hub's first, then the scheduling module's (time
  // off, absences, no-show). One mount here, the two composed at its root in the same order.
  const scheduling = new Hono<AppEnv>()
    .route('/', createSchedulingHubRoutes(core, d, shared))
    .route('/', createSchedulingRoutes(core, d))
  return [
    { path: '/api/schedules', access: 'user', router: createSchedulesRoutes(core, d, shared) },
    { path: '/api/schedules-all', access: 'user', router: createSchedulesAllRoutes(core, d) },
    { path: '/api/schedules-enhanced', access: 'user', router: createSchedulesEnhancedRoutes(core, d, shared) },
    { path: '/api/schedule-exceptions', access: 'user', router: createScheduleExceptionsRoutes(core, d) },
    { path: '/api/scheduling', access: 'user', router: scheduling },
    { path: '/api/open-shifts', access: 'user', router: createOpenShiftsRoutes(core, d, shared) },
    { path: '/api/shift-swaps', access: 'user', router: createShiftSwapsRoutes(core, d) },
    { path: '/api/absences', access: 'user', router: createAbsencesRoutes(core, d) },
    { path: '/api/blackout-dates', access: 'user', router: createBlackoutDatesRoutes(core, d) },
    { path: '/api/caregiver-availability', access: 'user', router: createCaregiverAvailabilityRoutes(core, d) },
    { path: '/api/matching', access: 'user', router: createMatchingRoutes(core, d) },
    { path: '/api/no-show', access: 'user', router: createNoShowRoutes(core, d) },
    { path: '/api/forecast', access: 'user', router: createForecastRoutes(core, d) },
    { path: '/api/care-rewards', access: 'user', feature: 'care_pickup_rewards', router: createPickupRewardsRoutes(core, d) },
  ]
}
