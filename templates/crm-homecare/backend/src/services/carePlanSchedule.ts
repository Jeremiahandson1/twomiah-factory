// A client's recurring visit schedule in words, for saving onto a care plan ("Fill from current
// schedule") and for noticing when the live schedule has drifted from what a plan recorded.
//
// A pattern is listed when it produces at least one visit in the next WINDOW_DAYS days, expanded
// ONLY through the shared schedule engine (services/scheduleOccurrences.ts), so ended, inactive,
// suspended and not-yet-started rows drop out exactly the way they do for billing and payroll.
//
// The text describes the PATTERN (its day, times, caregiver, frequency, end date, paused-from date) —
// not one-week overrides or one-time visits — so a single swapped shift does not make an
// otherwise-current plan look out of date.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencyToday, addDays } from './agencyTime.ts'
import { occurrencesCte } from './scheduleOccurrences.ts'

export const WINDOW_DAYS = 28
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

export const fmtTime = (t: string) => {
  const [h, m] = String(t).split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}
const fmtDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return `${m}/${day}/${y}` }

export async function getClientVisitSchedule(clientId: string) {
  const today = await agencyToday()
  const until = addDays(today, WINDOW_DAYS - 1)
  const patterns = rowsOf(await db.execute(sql`
    WITH ${occurrencesCte(today, until)}
    SELECT s.id, s.day_of_week,
           to_char(s.start_time::time, 'HH24:MI') AS start_time,
           to_char(s.end_time::time, 'HH24:MI') AS end_time,
           COALESCE(s.frequency, 'weekly') AS frequency,
           s.end_date::text AS end_date,
           s.suspended_from::text AS suspended_from,
           TRIM(REGEXP_REPLACE(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''), '\\s+', ' ', 'g')) AS caregiver
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      LEFT JOIN users u ON u.id = s.caregiver_id
     WHERE occ.pattern_client_id = ${clientId}
     GROUP BY s.id, u.first_name, u.last_name`))
  const upcoming = rowsOf(await db.execute(sql`
    WITH ${occurrencesCte(today, until)}
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
    if (x.suspended_from) line += ` · paused from ${fmtDate(x.suspended_from)}`
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
