// Minutes per week of a client's care tasks — the ONE rule (Run 4). Moved from
// templates/crm-homecare/backend/src/services/careTaskMinutes.ts.
//
// A task's minutes per week = its times per week × its minutes per task, where times per week is:
//   · a DAILY task (cadence 'daily' = done on every visit): the client's scheduled visits per week, from the shared
//     schedule engine (the next 4 weeks' visits ÷ 4). When nothing is scheduled yet, the task's own "times per week".
//   · a WEEKLY task: its own "times per week".
//   · a task imported from an insurer assessment (assessmentSource set): the assessment's own count, whatever its
//     cadence.
//
// Changes: the visit count is the company's (clientVisitsPerWeek takes its id); task rows are camelCase (cadence,
// weeklyFrequency, allottedMinutes, assessmentSource) and gain timesPerWeek, minutesPerWeek and everyVisit (the
// template's times_per_week, minutes_per_week, every_visit).
import { clientOccurrenceCount } from '../../../data/homecareCore.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'

const WINDOW_DAYS = 28

type TaskRow = { cadence?: string | null; weeklyFrequency?: number | string | null; allottedMinutes?: number | string | null; assessmentSource?: string | null }

/** How many times a week the task is done (the rule above). */
export function taskTimesPerWeek(t: TaskRow, visitsPerWeek: number): number {
  const own = Number(t.weeklyFrequency) > 0 ? Number(t.weeklyFrequency) : 1
  if (t.assessmentSource) return own
  if ((t.cadence || 'daily') === 'daily' && visitsPerWeek > 0) return visitsPerWeek
  return own
}

/** Each row with timesPerWeek, minutesPerWeek (whole minutes) and everyVisit added. */
export function withWeeklyMinutes<T extends TaskRow>(tasks: T[], visitsPerWeek: number) {
  return tasks.map((t) => {
    const times = taskTimesPerWeek(t, visitsPerWeek)
    return {
      ...t,
      timesPerWeek: times,
      minutesPerWeek: Math.round(times * (Number(t.allottedMinutes) || 0)),
      everyVisit: !t.assessmentSource && (t.cadence || 'daily') === 'daily' && visitsPerWeek > 0,
    }
  })
}

export function createCareTaskMinutes(d: CrmDeps, deps: { time: AgencyTime }) {
  /** The client's scheduled visits per week: the next 4 weeks' visits ÷ 4 (one decimal). */
  async function clientVisitsPerWeek(companyId: string, clientId: string): Promise<number> {
    const today = await deps.time.today(companyId)
    const n = await clientOccurrenceCount(d.db, companyId, clientId, today, addDays(today, WINDOW_DAYS - 1))
    return Math.round((n / (WINDOW_DAYS / 7)) * 10) / 10
  }
  return { clientVisitsPerWeek }
}
