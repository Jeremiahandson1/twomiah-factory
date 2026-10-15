// THE schedule engine — ported from CVHC helpers/scheduleOccurrences.js.
//
// A recurring shift is ONE row in `schedules` (day_of_week + effective_date / end_date / frequency /
// anchor_date) and every occurrence is re-derived on the fly. CVHC re-derived it in ~28 places that
// disagreed, so payroll, billing, the calendar and the caregiver's phone each gave a different answer
// for the same shift. Anything here that expands a schedule goes through this CTE.
//
// occurrencesCte('occ', start, end) returns a CTE body (use it as `WITH ${occurrencesCte(...)} …`)
// with one row per occurrence between two YYYY-MM-DD dates, inclusive:
//   schedule_id
//   caregiver_id, client_id                  — RESOLVED through the day's 'modified' exception
//   pattern_caregiver_id, pattern_client_id  — what the pattern itself says
//   occ_date                                 — the calendar date of the occurrence
//   start_time, end_time                     — `time`, resolved through the exception overrides
//   hours, minutes                           — overnight-aware duration of the resolved times
//   is_modified                              — the occurrence carries a 'modified' exception
//
// The three rules CVHC's old copies got wrong, kept here:
//  1. Recurring-ness is `day_of_week IS NOT NULL`, not `schedule_type` (schedule_type defaults to
//     'recurring', so one-time coverage rows carried a date, no day_of_week and type 'recurring').
//  2. Bi-weekly lives in `frequency = 'biweekly'` (what every writer stores), not in schedule_type.
//  3. The effective_date lower bound applies only to RECURRING rows. A one-time row's `date` IS its
//     occurrence; bounding it dropped every shift entered after the fact.
// Plus: a cancelled occurrence does not exist, and a suspended schedule stops generating on and after
// suspended_from (earlier, already-worked occurrences still generate).
//
// Template difference: schedules.start_time / end_time are `timestamp` columns holding the wall-clock
// time the office typed, so the time-of-day is `start_time::time`. Exception overrides are `time`.
import { sql, type SQL } from 'drizzle-orm'

// Bi-weekly parity: FLOOR (not truncation toward zero) so a date 1–6 days BEFORE the anchor counts as
// the previous week; ((x % 2) + 2) % 2 normalises negative weeks.
const BIWEEKLY_ON_WEEK = sql.raw(
  `(((FLOOR((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::numeric / 7)::int % 2) + 2) % 2) = 0`,
)
const RESOLVED_START = `COALESCE(se.override_start_time, s.start_time::time)`
const RESOLVED_END = `COALESCE(se.override_end_time, s.end_time::time)`
// An end earlier than the start means the visit wrapped past midnight.
const OVERNIGHT_WRAP = `CASE WHEN ${RESOLVED_END} < ${RESOLVED_START} THEN 1 ELSE 0 END`

export function occurrencesCte(name: string, startDate: string, endDate: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`bad CTE name: ${name}`)
  return sql`
  ${sql.raw(name)} AS (
    SELECT
      s.id AS schedule_id,
      COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id,    s.client_id)    AS client_id,
      s.caregiver_id AS pattern_caregiver_id,
      s.client_id    AS pattern_client_id,
      d.dt::date AS occ_date,
      ${sql.raw(RESOLVED_START)} AS start_time,
      ${sql.raw(RESOLVED_END)}   AS end_time,
      (EXTRACT(EPOCH FROM (${sql.raw(RESOLVED_END)} - ${sql.raw(RESOLVED_START)})) / 3600.0
        + (${sql.raw(OVERNIGHT_WRAP)}) * 24) AS hours,
      (ROUND(EXTRACT(EPOCH FROM (${sql.raw(RESOLVED_END)} - ${sql.raw(RESOLVED_START)})) / 60)::int
        + (${sql.raw(OVERNIGHT_WRAP)}) * 1440) AS minutes,
      (se.id IS NOT NULL AND se.exception_type = 'modified') AS is_modified
    FROM schedules s
    CROSS JOIN generate_series((${startDate})::date, (${endDate})::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
      AND (
        (s.day_of_week IS NULL AND s.date IS NOT NULL AND s.date = d.dt::date)
        OR (
          s.day_of_week IS NOT NULL
          AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
          AND (COALESCE(s.frequency, 'weekly') <> 'biweekly' OR ${BIWEEKLY_ON_WEEK})
          AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
          AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
        )
      )
      AND (se.id IS NULL OR se.exception_type <> 'cancelled')
      AND (s.suspended_from IS NULL OR d.dt::date < s.suspended_from)
  )`
}

/** Hours between two HH:MM[:SS] times, wrapping past midnight (13:00 → 12:00 is 23, not -1). */
export function shiftHours(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0
  const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }
  const h = (toMin(end) - toMin(start)) / 60
  return h <= 0 ? h + 24 : h
}

/**
 * A schedule's start/end value. schedules.start_time / end_time are `timestamp` columns whose
 * time-of-day is the wall-clock visit time (the engine reads start_time::time), so a bare "08:00" —
 * what the optimizers propose — cannot be written as-is: Postgres refuses it for a timestamp. It is
 * written on `date` (the day the pattern is created). Throws on anything that is not HH:MM[:SS].
 */
export function wallClock(date: string, hhmm: unknown): SQL {
  const t = typeof hhmm === 'string' ? hhmm.trim() : ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`Invalid time "${String(hhmm)}" — expected HH:MM`)
  return sql`((${date})::date + (${`${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`})::time)`
}
