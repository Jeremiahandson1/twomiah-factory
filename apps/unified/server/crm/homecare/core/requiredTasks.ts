// Required tasks before clock-out (item 12, docs/parity/homecare-required-tasks-repeats.md).
//
// The office marks a client's task "required". The caregiver cannot clock out of that client's visit until each required
// task is done, or skipped / refused WITH A REASON (a note). A weekly task already done on another shift this week does
// not hold the clock-out. Only for a company with the care_required_tasks feature (not ready until the owner has tested
// it) — without it nothing changes for anyone. The office's force clock-out is never blocked.
import { pendingRequiredTasks } from '../../../data/homecareClients.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'

export const REQUIRED_TASKS_FEATURE = 'care_required_tasks'

export function createRequiredTasks(d: CrmDeps, deps: { time: AgencyTime }) {
  return {
    enabled: (companyId: string) => d.features.isFeatureEnabled(companyId, REQUIRED_TASKS_FEATURE),
    /** The required tasks still open on this visit ([] when the agency does not have the feature). */
    async pendingFor(companyId: string, entry: { id: string; clientId: string }): Promise<{ taskId: string; taskName: string }[]> {
      if (!(await d.features.isFeatureEnabled(companyId, REQUIRED_TASKS_FEATURE))) return []
      return pendingRequiredTasks(d.db, companyId, entry.id, entry.clientId, await deps.time.timezone(companyId))
    },
  }
}
