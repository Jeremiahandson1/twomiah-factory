// The agency's clock — the ONE place the template decides what time zone the agency lives in.
//
// Reports, the dashboard, the live board, billing, payroll, EVV weeks, reminders, the caregiver's
// clock-in match, care-plan schedules, incident files, notification quiet hours and PDFs all count
// calendar days the way the office lives them. The server and the database run UTC, so a bare
// `start_time::date` files a 7pm visit under the next day, a bare CURRENT_DATE rolls "today" over at
// 7pm, and a 9am schedule time compared with NOW()::time reads five hours late. CVHC fixed this by
// writing America/Chicago into every query; a template serves agencies in every state, so:
//
//   the zone = agencies.timezone (the office's own setting, Company settings / PUT /api/company)
//            → else AGENCY_TIMEZONE from the environment
//            → else the usual zone for the agency's state
//            → else America/Chicago (the zone this product shipped with).
//
// (Earlier copies read agencies.settings.timezone, a separate EVV zone, or defaulted to UTC; 0021
// copies a settings.timezone into agencies.timezone, and every reader now comes through here.)
//
// Storage facts the SQL helpers below depend on:
//   · time_entries / performance_ratings / audit_logs … are `timestamp` WITHOUT time zone holding
//     UTC wall-clock values (drizzle writes Date.toISOString(); defaultNow() runs in a UTC session).
//     Their local reading is therefore (col AT TIME ZONE 'UTC') AT TIME ZONE <tz>.
//   · schedules.start_time / end_time are `timestamp` holding the WALL-CLOCK visit time the office
//     typed; only their time-of-day means anything (start_time::time). No conversion.
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../../db/index.ts'

/** Anything that can run a query: `db`, or a transaction handle (never read `db` inside a tx). */
export type Q = { execute: (q: SQL) => Promise<any> }
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

// Primary IANA zone per US state / territory. States split across zones use the zone most of the
// population lives in; an agency on the other side of the line sets agencies.timezone.
const STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
  GU: 'Pacific/Guam', VI: 'America/St_Thomas',
}

export const DEFAULT_TIMEZONE = 'America/Chicago'

/** True when `tz` is a zone this runtime (and therefore Postgres' tz database) recognises. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** The zone for an agency row: its own setting, else AGENCY_TIMEZONE, else its state's, else the default. */
export function resolveTimezone(agency: { timezone?: string | null; state?: string | null } | null | undefined): string {
  if (agency?.timezone && isValidTimezone(agency.timezone)) return agency.timezone
  if (isValidTimezone(process.env.AGENCY_TIMEZONE)) return process.env.AGENCY_TIMEZONE
  const st = String(agency?.state || '').trim().toUpperCase()
  return STATE_ZONES[st] || DEFAULT_TIMEZONE
}

/** The agency's zone, read fresh (one row — no cache to go stale after an edit). */
export async function agencyTimezone(q: Q = db): Promise<string> {
  try {
    const r = await q.execute(sql`SELECT timezone, state FROM agencies ORDER BY created_at LIMIT 1`)
    return resolveTimezone((rowsOf(r)[0] as any) || null)
  } catch {
    return resolveTimezone(null) // no agency row / table yet
  }
}

/** The agency's two-letter state ('WI'), upper-cased, or null when it has not been entered. */
export async function agencyState(q: Q = db): Promise<string | null> {
  try {
    const r = await q.execute(sql`SELECT state FROM agencies ORDER BY created_at LIMIT 1`)
    const s = String((rowsOf(r)[0] as any)?.state || '').trim().toUpperCase()
    return s || null
  } catch { return null }
}

/** Today's date (YYYY-MM-DD) on the agency's clock. */
export async function agencyToday(tz?: string, q: Q = db): Promise<string> {
  const zone = tz || await agencyTimezone(q)
  const r = await q.execute(sql`SELECT to_char((NOW() AT TIME ZONE ${zone})::date, 'YYYY-MM-DD') AS d`)
  return String((rowsOf(r)[0] as any).d)
}

/** 'YYYY-MM-DD' of an instant in a zone. */
export function ymdIn(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** 'HH:MM:SS' (24h) of an instant in a zone. */
export function hmsIn(at: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const g = (t: string) => p.find((x) => x.type === t)?.value || '00'
  return `${g('hour')}:${g('minute')}:${g('second')}`
}

/** The agency's date and wall-clock time at an instant (default: now). */
export async function agencyNow(at: Date = new Date()): Promise<{ date: string; time: string; tz: string }> {
  const tz = await agencyTimezone()
  return { date: ymdIn(at, tz), time: hmsIn(at, tz), tz }
}

/** A display time like 9:05 AM in the agency's zone. */
export function fmtClock(at: Date, tz: string): string {
  return at.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
}

/** A Date as the agency's wall-clock date + time, e.g. "10/15/2026, 7:05:00 PM". */
export function formatInZone(d: Date | string | null | undefined, tz: string): string {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', { timeZone: tz })
}

/** The Sunday (YYYY-MM-DD) of the Sun–Sat week containing `ymd` (pure calendar arithmetic). */
export function sundayOfWeek(ymd: string): string {
  return addDays(ymd, -new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`).getUTCDay())
}

/**
 * The Sunday of the agency's CURRENT Sun–Sat week. The week-at-a-time screens (Client Hours by Week,
 * Portal Claim Days) open here when they are not asked for a week — this week, on the agency's
 * clock, never the laptop's and never "last full week" (Run 4).
 */
export async function agencyWeekStart(): Promise<string> {
  return sundayOfWeek(await agencyToday())
}

/** `date` + n days, as YYYY-MM-DD (pure calendar arithmetic, no zone involved). */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** A naive-UTC timestamp column read on the agency's clock (a local timestamp). */
export const localTs = (col: SQL, tz: string): SQL => sql`((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${tz}`

/** The agency-local calendar date of a naive-UTC timestamp column. */
export const localDate = (col: SQL, tz: string): SQL => sql`(((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`

/** Local midnight at the start of `ymd`, expressed as a naive-UTC timestamp (comparable to the columns). */
export const dayStartUtc = (ymd: string, tz: string): SQL => sql`(((${ymd})::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`

/** Local midnight at the END of `ymd` (start of the next day), as a naive-UTC timestamp. */
export const dayEndUtc = (ymd: string, tz: string): SQL => sql`((((${ymd})::date + 1))::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`

/** "Now" as a naive-UTC timestamp, so it subtracts cleanly from the timestamp columns. */
export const nowUtc = sql`(NOW() AT TIME ZONE 'UTC')`

/** True for a strict YYYY-MM-DD that is a real calendar date. */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
