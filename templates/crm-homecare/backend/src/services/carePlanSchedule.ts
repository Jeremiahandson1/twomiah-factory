// A client's recurring visit schedule in words, for saving onto a care plan ("Fill from current
// schedule") and for noticing when the live schedule has drifted from what a plan recorded.
//
// A pattern is listed when it produces at least one visit in the next WINDOW_DAYS days, so
// ended, inactive and not-yet-started rows drop out exactly the way they do everywhere else.
// The occurrence rules are the schedule engine's:
//   * recurring-ness is `day_of_week IS NOT NULL`, not schedule_type
//   * bi-weekly lives in `frequency` ('biweekly'; the older 'bi-weekly' spelling is read too),
//     on the anchor's fortnight
//   * the effective_date lower bound applies to recurring rows only; a one-time row's date IS
//     its occurrence
//   * a cancelled exception removes that occurrence
//
// The text describes the PATTERN (its day, times, caregiver, frequency, end date) — not one-week
// overrides or one-time visits — so a single swapped shift does not make an otherwise-current plan
// look out of date.
//
// NOTE for the visits port: when schedules gain `suspended_from` (suspend service), add
// `AND (s.suspended_from IS NULL OR d.dt::date < s.suspended_from)` to OCCURRENCES and
// ` · paused from <date>` to the line, as the source CRM does.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencyTimeZone } from '../utils/agencyTimezone.ts'

export const WINDOW_DAYS = 28
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

export const fmtTime = (t: string) => {
  const [h, m] = String(t).split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}
const fmtDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return `${m}/${day}/${y}` }

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Every occurrence of every active schedule between two dates (inclusive).
const occurrences = (from: string, to: string) => sql`
  SELECT s.id AS schedule_id,
         COALESCE(se.override_client_id, s.client_id) AS client_id,
         s.client_id AS pattern_client_id,
         d.dt::date AS occ_date
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
     AND (se.id IS NULL OR se.exception_type <> 'cancelled')`

export async function agencyToday(): Promise<string> {
  const tz = await agencyTimeZone()
  return rowsOf(await db.execute(sql`SELECT ((NOW() AT TIME ZONE ${tz})::date)::text AS d`))[0].d
}

export async function getClientVisitSchedule(clientId: string) {
  const today = await agencyToday()
  const until = addDays(today, WINDOW_DAYS - 1)
  const patterns = rowsOf(await db.execute(sql`
    WITH occ AS (${occurrences(today, until)})
    SELECT s.id, s.day_of_week,
           to_char(s.start_time::time, 'HH24:MI') AS start_time,
           to_char(s.end_time::time, 'HH24:MI') AS end_time,
           COALESCE(s.frequency, 'weekly') AS frequency,
           s.end_date::text AS end_date,
           TRIM(REGEXP_REPLACE(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''), '\\s+', ' ', 'g')) AS caregiver
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      LEFT JOIN users u ON u.id = s.caregiver_id
     WHERE occ.pattern_client_id = ${clientId}
     GROUP BY s.id, u.first_name, u.last_name`))
  const upcoming = rowsOf(await db.execute(sql`
    WITH occ AS (${occurrences(today, until)})
    SELECT COUNT(*)::int AS n FROM occ WHERE occ.client_id = ${clientId} OR occ.pattern_client_id = ${clientId}`))[0]

  const recurring = patterns
    .filter((x) => x.day_of_week !== null && x.day_of_week !== undefined && x.start_time && x.end_time)
    .sort((a, b) => ((a.day_of_week + 6) % 7) - ((b.day_of_week + 6) % 7)
      || String(a.start_time).localeCompare(String(b.start_time))
      || String(a.caregiver).localeCompare(String(b.caregiver)))
  const lines = recurring.map((x) => {
    const biweekly = x.frequency === 'biweekly' || x.frequency === 'bi-weekly'
    let line = `${DAY_NAMES[x.day_of_week]} ${fmtTime(x.start_time)} – ${fmtTime(x.end_time)} · ${x.caregiver || 'Unassigned'} · ${biweekly ? 'every other week' : 'weekly'}`
    if (x.end_date) line += ` · through ${fmtDate(x.end_date)}`
    return line
  })

  return {
    asOf: today,
    windowDays: WINDOW_DAYS,
    text: lines.join('\n'),
    lines,
    upcomingVisits: Number(upcoming?.n || 0),
  }
}
