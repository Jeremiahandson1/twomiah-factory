// THE schedule engine — ported from CVHC helpers/scheduleOccurrences.js.
//
// Every place that needs to know "does this shift happen on date X, and with what times, caregiver
// and client" should go through here. A recurring shift is ONE row in `schedules` (day_of_week +
// effective_date/end_date/frequency/anchor_date) and every occurrence is re-derived on the fly; CVHC
// once re-derived it in ~28 places that disagreed, so payroll, billing, the calendar and the
// caregiver's phone each gave a different answer for the same shift.
//
// Billing reads it today. (Payroll's shift reviews still expand schedules with their own loop —
// moving them here is the follow-up that makes the two agree by construction.)
//
// Columns produced:
//   schedule_id
//   caregiver_id, client_id                 RESOLVED through the per-day exception overrides
//   pattern_caregiver_id, pattern_client_id what the pattern itself says
//   occ_date                                the calendar date of this occurrence
//   start_time, end_time                    RESOLVED through the overrides (time of day)
//   hours, minutes                          overnight-aware duration of the resolved times
//   is_modified                             this occurrence carries a 'modified' override
//
// The rules CVHC learned the hard way, kept as they are:
//  1. Recurring-ness is `day_of_week IS NOT NULL`, not `schedule_type` (which defaults to
//     'recurring' and so says nothing).
//  2. Bi-weekly lives in `frequency`, not `schedule_type`.
//  3. The effective_date lower bound applies to recurring rows only — a one-time row's date IS its
//     occurrence, and bounding it dropped every shift entered after the fact.
//  4. A cancelled occurrence does not exist: nothing may pay it, bill it, remind for it or alert on it.
//
// Template differences from CVHC's copy:
//   · schedules.start_time / end_time are TIMESTAMP columns here (the wall-clock time as typed, on the
//     schedule's base date), so the time of day is read with ::time. The exception overrides are
//     already TIME.
//   · a one-time row's day is `date`, falling back to the date part of start_time for rows written
//     without one.
//   · frequency 'bi-weekly' is accepted as well as CVHC's 'biweekly'.
//   · `suspended_from` (suspend service) is honoured when the column exists — it arrives with the
//     visits port, and this file must not 500 before it does.
import { sql, type SQL } from 'drizzle-orm'

const RESOLVED_START = sql.raw(`COALESCE(se.override_start_time, s.start_time::time)`)
const RESOLVED_END = sql.raw(`COALESCE(se.override_end_time, s.end_time::time)`)

export interface OccurrenceOptions {
  /** schedules.suspended_from exists on this database */
  hasSuspendedFrom?: boolean
}

/**
 * The CTE body `name AS (…)`, to be used as `WITH ${scheduleOccurrencesCte(...)} SELECT … FROM name`.
 * startDate / endDate are YYYY-MM-DD calendar days (inclusive).
 */
export function scheduleOccurrencesCte(name: string, startDate: string, endDate: string, opts: OccurrenceOptions = {}): SQL {
  const ident = sql.raw(name.replace(/[^a-z_]/gi, ''))
  const overnight = sql`CASE WHEN ${RESOLVED_END} < ${RESOLVED_START} THEN 1 ELSE 0 END`
  // FLOOR, not integer division (which truncates toward zero), so a date 1-6 days BEFORE the anchor
  // counts as the previous week; ((x % 2) + 2) % 2 normalises negative weeks.
  const biweeklyOnWeek = sql.raw(
    `(((FLOOR((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::numeric / 7)::int % 2) + 2) % 2) = 0`,
  )
  const suspended = opts.hasSuspendedFrom
    ? sql.raw(`AND (s.suspended_from IS NULL OR d.dt::date < s.suspended_from)`)
    : sql.raw('')
  return sql`
  ${ident} AS (
    SELECT
      s.id AS schedule_id,
      COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id,    s.client_id)    AS client_id,
      s.caregiver_id AS pattern_caregiver_id,
      s.client_id    AS pattern_client_id,
      d.dt::date AS occ_date,
      ${RESOLVED_START} AS start_time,
      ${RESOLVED_END}   AS end_time,
      (EXTRACT(EPOCH FROM (${RESOLVED_END} - ${RESOLVED_START})) / 3600.0 + (${overnight}) * 24) AS hours,
      (ROUND(EXTRACT(EPOCH FROM (${RESOLVED_END} - ${RESOLVED_START})) / 60)::int + (${overnight}) * 1440) AS minutes,
      (se.id IS NOT NULL AND se.exception_type = 'modified') AS is_modified
    FROM schedules s
    CROSS JOIN generate_series(${startDate}::date, ${endDate}::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
      AND (
        (s.day_of_week IS NULL AND COALESCE(s.date, s.start_time::date) = d.dt::date)
        OR (
          s.day_of_week IS NOT NULL
          AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
          AND (COALESCE(s.frequency, 'weekly') NOT IN ('biweekly', 'bi-weekly') OR ${biweeklyOnWeek})
          AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
          AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
        )
      )
      AND (se.id IS NULL OR se.exception_type <> 'cancelled')
      ${suspended}
  )`
}
