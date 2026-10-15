// THE schedule engine. Every place that needs to know "does this shift happen on date X, and with
// what times, caregiver and client" must go through here — billing, payroll's shift reviews, the
// reports, the calendar, the caregiver's phone, the portal's schedule, care-plan visit schedules and
// incident coverage. (Ported from the CVHC home care CRM, helpers/scheduleOccurrences.js. CVHC once
// re-derived it in ~28 places that disagreed; this template had three copies of this file, one per
// port area, merged here into one.)
//
// A recurring shift is ONE row in `schedules` (day_of_week + effective_date / end_date / frequency /
// anchor_date) and every occurrence is re-derived on the fly. Anything that expands a schedule and
// does NOT use this CTE will disagree with payroll, billing, the calendar and the caregiver's phone.
//
// This template stores schedules.start_time / end_time as TIMESTAMPs whose wall-clock part is the
// shift time, so the engine reads `::time` of each. schedule_exceptions overrides are TIME already.
//
// Columns produced:
//   schedule_id
//   caregiver_id, client_id                 — RESOLVED through the exception overrides
//   pattern_caregiver_id, pattern_client_id — what the pattern itself says
//   occ_date                                — the calendar date of this occurrence
//   start_time, end_time (TIME)             — RESOLVED through the exception overrides
//   hours, minutes                          — overnight-aware duration of the resolved times
//   is_modified                             — this occurrence carries a 'modified' override
//   is_training                             — a training shift (paid, never billed)
//
// Rules the old copies got wrong, kept here on purpose:
//  1. Recurring-ness is `day_of_week IS NOT NULL`, never `schedule_type` (it defaults to 'recurring').
//  2. Bi-weekly lives in `frequency` ('biweekly', or 'bi-weekly' as some writers stored it), never in
//     `schedule_type`, and runs on its anchor fortnight.
//  3. The effective_date lower bound applies to RECURRING rows only — a one-time row's date IS its
//     occurrence, and a shift entered after the fact must still exist. A one-time row written without
//     `date` falls back to the date part of its start_time.
//  4. A cancelled occurrence does not exist — nothing may pay, bill, remind or alert on it.
//  5. A suspended schedule generates nothing on/after suspended_from; earlier, worked visits stay.
//  6. A row with no start or end time is not a visit (nothing to pay, bill or show).
import { sql, type SQL } from 'drizzle-orm'

const START = sql.raw(`COALESCE(se.override_start_time, s.start_time::time)`)
const END = sql.raw(`COALESCE(se.override_end_time, s.end_time::time)`)
// An end time earlier than the start wrapped past midnight.
const WRAP = sql.raw(`(CASE WHEN COALESCE(se.override_end_time, s.end_time::time) < COALESCE(se.override_start_time, s.start_time::time) THEN 1 ELSE 0 END)`)

// Bi-weekly parity: FLOOR (not truncation) so a date 1–6 days before the anchor counts as the
// previous week; ((x % 2) + 2) % 2 normalises negative weeks — the same rule as helpers/biweekly.ts
// and the frontend's isBiweeklyOn.
const BIWEEKLY_ON_WEEK = sql.raw(
  `(((FLOOR((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::numeric / 7)::int % 2) + 2) % 2) = 0`,
)

/**
 * `name AS (...)` — use inside `WITH ${occurrencesCte(from, to)} SELECT … FROM occ`.
 * from / to are 'YYYY-MM-DD' (inclusive); name is the CTE's name (default `occ`).
 */
export function occurrencesCte(from: string, to: string, name = 'occ'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`bad CTE name: ${name}`)
  return sql`${sql.raw(name)} AS (
    SELECT
      s.id AS schedule_id,
      COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id,    s.client_id)    AS client_id,
      s.caregiver_id AS pattern_caregiver_id,
      s.client_id    AS pattern_client_id,
      d.dt::date AS occ_date,
      ${START} AS start_time,
      ${END}   AS end_time,
      (EXTRACT(EPOCH FROM (${END} - ${START})) / 3600.0 + ${WRAP} * 24) AS hours,
      (ROUND(EXTRACT(EPOCH FROM (${END} - ${START})) / 60)::int + ${WRAP} * 1440) AS minutes,
      (se.id IS NOT NULL AND se.exception_type = 'modified') AS is_modified,
      COALESCE(s.is_training, false) AS is_training
    FROM schedules s
    CROSS JOIN generate_series((${from})::date, (${to})::date, '1 day'::interval) AS d(dt)
    LEFT JOIN schedule_exceptions se
      ON se.schedule_id = s.id AND se.exception_date = d.dt::date
    WHERE s.is_active = true
      AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
      AND (
        (s.day_of_week IS NULL AND COALESCE(s.date, s.start_time::date) = d.dt::date)
        OR (
          s.day_of_week IS NOT NULL
          AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
          AND (COALESCE(s.frequency, 'weekly') NOT IN ('biweekly', 'bi-weekly') OR ${BIWEEKLY_ON_WEEK})
          AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
          AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
        )
      )
      AND (se.id IS NULL OR se.exception_type <> 'cancelled')
      AND (s.suspended_from IS NULL OR d.dt::date < s.suspended_from)
  )`
}

/** Wall-clock HH:MM:SS of a schedules.start_time / end_time column, for responses. */
export const schedTime = (col: string) => sql.raw(`to_char(${col}, 'HH24:MI:SS')`)

/** 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS', or null when it is not a time. */
export function hms(t: unknown): string | null {
  if (t === null || t === undefined || t === '') return null
  const m = String(t).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3] || 0)
  if (h > 23 || mi > 59 || s > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}:${String(s).padStart(2, '0')}`
}

/**
 * The value written to a schedules.start_time / end_time TIMESTAMP column for a wall-clock time:
 * 'YYYY-MM-DD HH:MM:SS' on the row's own date (one-time) or its effective date (recurring).
 * Cast with ::timestamp in SQL.
 */
export function schedTs(time: unknown, baseDate: string): string | null {
  const t = hms(time)
  if (!t) return null
  return `${String(baseDate).slice(0, 10)} ${t}`
}

/**
 * The same value as an SQL expression, for writers that build the row in SQL (the optimizers):
 * `date + time`. A bare "08:00" cannot be written to a timestamp column as-is — Postgres refuses it.
 * Throws on anything that is not HH:MM[:SS].
 */
export function wallClock(date: string, hhmm: unknown): SQL {
  const t = typeof hhmm === 'string' ? hhmm.trim() : ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`Invalid time "${String(hhmm)}" — expected HH:MM`)
  return sql`((${date})::date + (${`${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`})::time)`
}

/**
 * Hours between two HH:MM(:SS) times, wrapping past midnight (13:00 → 12:00 is 23, not -1; equal
 * times are a 24-hour shift). 0 when either is missing or not a time.
 */
export function shiftHours(start: unknown, end: unknown): number {
  const a = hms(start), b = hms(end)
  if (!a || !b) return 0
  const toMin = (x: string) => { const [h, m, s] = x.split(':').map(Number); return h * 60 + m + s / 60 }
  const h = (toMin(b) - toMin(a)) / 60
  return h <= 0 ? h + 24 : h
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
