// The agency's own calendar day and clock.
//
// A schedule says "Tuesday 09:00" in the agency's local time, while the server (and Postgres) run in
// UTC. Reading "today" or "now" off the process clock is how CVHC's reminders fired five hours early
// and its clock-in matched tomorrow's weekday after 7pm. Everything in the visits area that asks
// "what day / time is it for the agency?" goes through here.
//
// The zone is per agency: agencies.settings.timezone (IANA name), else AGENCY_TIMEZONE, else
// America/Chicago (the zone the template shipped with). Cached for a minute.
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'

const FALLBACK_TZ = 'America/Chicago'
let cached: { tz: string; at: number } | null = null

function validZone(tz: unknown): string | null {
  if (!tz || typeof tz !== 'string') return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return null }
}

export async function agencyTimezone(): Promise<string> {
  if (cached && Date.now() - cached.at < 60_000) return cached.tz
  let tz: string | null = null
  try {
    const [a] = await db.select({ settings: agencies.settings }).from(agencies).limit(1)
    tz = validZone((a?.settings as any)?.timezone)
  } catch { /* no agency row yet */ }
  tz = tz || validZone(process.env.AGENCY_TIMEZONE) || FALLBACK_TZ
  cached = { tz, at: Date.now() }
  return tz
}

/** Test hook: forget the cached zone. */
export function _resetAgencyTimezone() { cached = null }

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

/** Shift a 'YYYY-MM-DD' by whole days. */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** A display time like 9:05 AM in the agency's zone. */
export function fmtClock(at: Date, tz: string): string {
  return at.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
}
