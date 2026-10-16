// Minutes per week of a client's care tasks — the ONE rule (Run 4).
//
// A task's minutes per week = its times per week × its minutes per task, where times per week is:
//   · a DAILY task (cadence 'daily' = done on every visit — the caregiver checklist and the
//     adherence report already expect it each shift): the client's scheduled visits per week, from
//     the shared schedule engine (the next 4 weeks' visits ÷ 4). When nothing is scheduled yet, the
//     task's own "times per week" stands in.
//   · a WEEKLY task: its own "times per week".
//   · a task imported from an insurer assessment (assessment_source set): the assessment's own count,
//     whatever its cadence — the import's reconciliation checks that count against the assessment's
//     total, and the PDF/screens must show the same number.
// Before this every task counted weekly_frequency, which the Add Task form defaults to 1, so a daily
// task typed in by the office counted ONCE a week (30 + 5 + 3×20 = 95, Run 4).
//
// Readers: GET /api/care-tasks/client/:clientId (each row carries times_per_week and
// minutes_per_week; the Care Tasks screen and the Care Plans panel print those) and the care plan
// PDF. No screen re-derives them.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencyToday, addDays } from './agencyTime.ts'
import { occurrencesCte } from './scheduleOccurrences.ts'

const WINDOW_DAYS = 28
const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

/** The client's scheduled visits per week: the next 4 weeks' visits ÷ 4 (one decimal). */
export async function clientVisitsPerWeek(clientId: string): Promise<number> {
  const today = await agencyToday()
  const r = rowsOf(await db.execute(sql`
    WITH ${occurrencesCte(today, addDays(today, WINDOW_DAYS - 1))}
    SELECT COUNT(*)::int AS n FROM occ WHERE occ.client_id = ${clientId}`))[0]
  return Math.round((Number(r?.n || 0) / (WINDOW_DAYS / 7)) * 10) / 10
}

type TaskRow = { cadence?: string | null; weekly_frequency?: number | string | null; allotted_minutes?: number | string | null; assessment_source?: string | null }

/** How many times a week the task is done (the rule above). */
export function taskTimesPerWeek(t: TaskRow, visitsPerWeek: number): number {
  const own = Number(t.weekly_frequency) > 0 ? Number(t.weekly_frequency) : 1
  if (t.assessment_source) return own
  if ((t.cadence || 'daily') === 'daily' && visitsPerWeek > 0) return visitsPerWeek
  return own
}

/** Each row with times_per_week, minutes_per_week (whole minutes) and every_visit added. */
export function withWeeklyMinutes<T extends TaskRow>(tasks: T[], visitsPerWeek: number) {
  return tasks.map((t) => {
    const times = taskTimesPerWeek(t, visitsPerWeek)
    return {
      ...t,
      times_per_week: times,
      minutes_per_week: Math.round(times * (Number(t.allotted_minutes) || 0)),
      every_visit: !t.assessment_source && (t.cadence || 'daily') === 'daily' && visitsPerWeek > 0,
    }
  })
}
