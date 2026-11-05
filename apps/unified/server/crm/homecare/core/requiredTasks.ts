// Required tasks before clock-out (item 12, docs/parity/homecare-required-tasks-repeats.md).
//
// The office marks a client's task "required". The caregiver cannot clock out of that client's visit until each required
// task is done, or skipped / refused WITH A REASON (a note). Row 5: a task's days of the week and time of day are read, so a
// Tuesday task holds only a Tuesday visit (core/taskDays.ts). A weekly task already done on another shift this week does
// not hold the clock-out. Only for a company with the care_required_tasks feature (not ready until the owner has tested
// it) — without it nothing changes for anyone. The office's force clock-out is never blocked.
import { pendingRequiredTasks } from '../../../data/homecareClients.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import { taskBelongsTo, visitWhen, type VisitWhen } from './taskDays.ts'

export const REQUIRED_TASKS_FEATURE = 'care_required_tasks'

export function createRequiredTasks(d: CrmDeps, deps: { time: AgencyTime }) {
  return {
    enabled: (companyId: string) => d.features.isFeatureEnabled(companyId, REQUIRED_TASKS_FEATURE),
    /** The required tasks still open on this visit ([] when the agency does not have the feature). */
    // A task's days of the week and time of day are read (row 5): a Tuesday task is open only on a Tuesday visit, an AM task only on
    // a morning visit. `entry.startTime` is the visit's start; the visit is judged on the agency's clock.
    async pendingFor(companyId: string, entry: { id: string; clientId: string; startTime?: Date | string | null; endTime?: Date | string | null }): Promise<{ taskId: string; taskName: string }[]> {
      if (!(await d.features.isFeatureEnabled(companyId, REQUIRED_TASKS_FEATURE))) return []
      const tz = await deps.time.timezone(companyId)
      const rows = await pendingRequiredTasks(d.db, companyId, entry.id, entry.clientId, tz)
      const when = entry.startTime ? visitWhen(new Date(entry.startTime), entry.endTime ? new Date(entry.endTime) : null, tz) : null
      return rows.filter((t) => !when || taskBelongsTo(t, when)).map((t) => ({ taskId: t.taskId, taskName: t.taskName }))
    },
    /** When this visit is, on the agency's clock — null when the agency does not have the feature (days and times then stay labels). */
    async whenOf(companyId: string, entry: { startTime?: Date | string | null; endTime?: Date | string | null }): Promise<VisitWhen | null> {
      if (!entry.startTime || !(await d.features.isFeatureEnabled(companyId, REQUIRED_TASKS_FEATURE))) return null
      return visitWhen(new Date(entry.startTime), entry.endTime ? new Date(entry.endTime) : null, await deps.time.timezone(companyId))
    },
  }
}
