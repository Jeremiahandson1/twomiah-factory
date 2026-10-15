// Schedule expansion + the agency's calendar day, for the incident case file.
//
// Ported from CVHC helpers/scheduleOccurrences.js (its SCHEDULE_OCCURRENCES_CTE), adapted to this
// template's schedules table:
//   · start_time / end_time are timestamps here (only the clock time means anything on a pattern),
//     while schedule_exceptions overrides are `time` — so both are reduced to ::time.
//   · bi-weekly is written as frequency 'bi-weekly' by this template and 'biweekly' by CVHC; both
//     are honoured.
//   · there is no schedules.suspended_from in this template. A caregiver removed pending an incident
//     investigation is taken off the pattern by end-dating it (recurring) or deactivating it (one
//     visit), both of which every reader here already honours; see routes/incidents.ts.
//
// The three rules CVHC's engine encodes are kept: recurring-ness is `day_of_week IS NOT NULL` (not
// schedule_type); bi-weekly lives in `frequency`; the effective_date lower bound applies only to
// recurring rows. A cancelled occurrence does not exist; a modified one carries its overrides.
//
// NOTE for whoever merges the visits area: if it adds a shared occurrence engine (and
// schedules.suspended_from), point this file at it — one engine, not two.
import { sql, type SQL } from 'drizzle-orm'

/** Default when the agency has not set settings.timezone. */
export const DEFAULT_AGENCY_TZ = process.env.AGENCY_TIMEZONE || 'America/Chicago'

const validTz = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export type Q = { execute: (q: SQL) => Promise<any> }

export const rowsOf = async (q: Q, query: SQL): Promise<any[]> => {
  const r = await q.execute(query)
  return (r?.rows ?? r ?? []) as any[]
}

/** The agency's IANA time zone: agencies.settings.timezone, else the default. */
export async function agencyTimeZone(q: Q): Promise<string> {
  try {
    const [row] = await rowsOf(q, sql`SELECT settings->>'timezone' AS tz FROM agencies ORDER BY created_at LIMIT 1`)
    if (validTz(row?.tz)) return row.tz
  } catch { /* no agency row yet */ }
  return DEFAULT_AGENCY_TZ
}

/** Today's calendar date (YYYY-MM-DD) in the agency's zone — not the server's UTC date. */
export async function agencyToday(q: Q, tz?: string): Promise<string> {
  const zone = tz || await agencyTimeZone(q)
  const [row] = await rowsOf(q, sql`SELECT to_char((NOW() AT TIME ZONE ${zone})::date, 'YYYY-MM-DD') AS d`)
  return row.d
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

/**
 * time_entries.start_time is a timestamp without time zone holding UTC wall time; this is the
 * agency-local calendar date of such a column.
 */
export const localDate = (col: SQL, tz: string): SQL => sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`

/**
 * `occ AS (...)` — every occurrence of every active schedule between from and to (inclusive), with
 * caregiver, client and clock times resolved through that day's exception. Use as
 *   sql`WITH ${occurrencesCte(from, to)} SELECT ... FROM occ ...`
 */
export const occurrencesCte = (from: string, to: string): SQL => sql`occ AS (
  SELECT
    s.id AS schedule_id,
    COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
    COALESCE(se.override_client_id, s.client_id) AS client_id,
    s.caregiver_id AS pattern_caregiver_id,
    s.client_id AS pattern_client_id,
    d.dt::date AS occ_date,
    COALESCE(se.override_start_time, s.start_time::time) AS start_time,
    COALESCE(se.override_end_time, s.end_time::time) AS end_time,
    (se.id IS NOT NULL AND se.exception_type = 'modified') AS is_modified
  FROM schedules s
  CROSS JOIN generate_series(${from}::date, ${to}::date, '1 day'::interval) AS d(dt)
  LEFT JOIN schedule_exceptions se ON se.schedule_id = s.id AND se.exception_date = d.dt::date
  WHERE s.is_active = true
    AND (
      (s.day_of_week IS NULL AND s.date IS NOT NULL AND s.date = d.dt::date)
      OR (
        s.day_of_week IS NOT NULL
        AND s.day_of_week = EXTRACT(DOW FROM d.dt)::int
        AND (COALESCE(s.frequency, 'weekly') NOT IN ('biweekly', 'bi-weekly')
             OR (((FLOOR((d.dt::date - COALESCE(s.anchor_date, s.effective_date, s.created_at::date))::numeric / 7)::int % 2) + 2) % 2) = 0)
        AND d.dt::date >= COALESCE(s.effective_date, s.created_at::date)
        AND (s.end_date IS NULL OR d.dt::date <= s.end_date)
      )
    )
    AND (se.id IS NULL OR se.exception_type <> 'cancelled')
)`
