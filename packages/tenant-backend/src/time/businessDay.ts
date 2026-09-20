// Which day it is, for a business.
//
// "Today" was `new Date(); setHours(0,0,0,0)` — the SERVER's midnight, and Render runs UTC. So a crew in
// Ohio saw their Today board roll over at 8pm, three hours before they went home, and "completed today"
// counted only the jobs finished since 7pm. The dispensary hit the same thing on its sales reports and
// it was raised as a blocker (T24 N1); this is the same fault on the shared surfaces every other vertical
// uses.
//
// Two rules, and the second is what makes this safe to land on seven verticals at once:
//
//   1. An INSTANT (completed_at, created_at) belongs to the store's day that contains it. Convert.
//   2. A DATE MARKER does not. job.scheduled_date holds BOTH: the jobs API, agreements and bulk
//      reschedule all store `new Date('2026-09-19')`, which is midnight UTC standing in for a calendar
//      day, while a booking stores the real instant it was booked for. Converting a marker would shift
//      it a day backwards in every zone behind UTC — the opposite bug. The two are told apart by where
//      the row came from: a booking sets source = 'online_booking', nothing else does.
//
// The fallback everywhere is UTC, which is exactly what the code did before, so a company with no state
// and no configured zone behaves precisely as it does today. That is deliberate: this can correct a day
// or leave it alone, never move it the wrong way.
import { sql } from 'drizzle-orm'

const STATE_TIME_ZONES: Record<string, string> = {
  AK: 'America/Anchorage', AL: 'America/Chicago', AR: 'America/Chicago', AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DC: 'America/New_York',
  DE: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  IA: 'America/Chicago', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', MA: 'America/New_York',
  MD: 'America/New_York', ME: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MO: 'America/Chicago', MS: 'America/Chicago', MT: 'America/Denver', NC: 'America/New_York',
  ND: 'America/Chicago', NE: 'America/Chicago', NH: 'America/New_York', NJ: 'America/New_York',
  NM: 'America/Denver', NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VA: 'America/New_York', VT: 'America/New_York', WA: 'America/Los_Angeles',
  WI: 'America/Chicago', WV: 'America/New_York', WY: 'America/Denver',
}

/** Behaves exactly as the old server-midnight did — the safe answer when nothing better is known. */
export const DEFAULT_BUSINESS_ZONE = 'UTC'

/** A zone only counts if this runtime knows it; an unknown name makes Postgres throw on AT TIME ZONE. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/**
 * The zone this company keeps its books in: what they configured, else the one their state implies,
 * else UTC. Read straight from the company row, because the shared modules are wired with the tables
 * they need and adding `company` to every template's call would be a far wider change than the fix.
 */
export async function companyTimeZone(db: any, companyId: string): Promise<string> {
  try {
    const r: any = await db.execute(sql`SELECT settings, state FROM company WHERE id = ${companyId} LIMIT 1`)
    const row = ((r as any)?.rows || r)?.[0]
    if (!row) return DEFAULT_BUSINESS_ZONE
    const s = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings
    if (isValidTimeZone(s?.timezone)) return s.timezone
    const byState = STATE_TIME_ZONES[String(row.state || '').trim().toUpperCase()]
    return byState || DEFAULT_BUSINESS_ZONE
  } catch {
    // No company row, unreadable settings, a table that does not exist on this vertical: behave as before.
    return DEFAULT_BUSINESS_ZONE
  }
}

/**
 * The value a CALENDAR-DAY column should hold for a given local date: midnight UTC, standing in for
 * that day rather than naming an instant in it.
 *
 * A timesheet day is a calendar day — "the hours I worked on Friday" — not a moment. Storing `new Date()`
 * in such a column is what made a 20:00 Friday clock-in land on Saturday's sheet. Write the day.
 */
export const dayMarker = (dateStr: string) => new Date(`${String(dateStr).slice(0, 10)}T00:00:00.000Z`)

/** What the store's wall clock calls this instant's date, as YYYY-MM-DD. */
export function storeDateString(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

function zoneOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  return Date.UTC(g('year'), g('month') - 1, g('day') % 32, g('hour') % 24, g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000
}

/** The UTC instant at which a local date begins in this zone. */
export function storeDayStart(dateStr: string, tz: string): Date {
  const asUtcMidnight = new Date(`${dateStr}T00:00:00.000Z`).getTime()
  // Applied twice so a day beginning on a daylight-saving boundary settles on the offset actually in
  // force at the start of it — the day the clocks change is 23 or 25 hours long, not 24.
  let start = new Date(asUtcMidnight - zoneOffsetMs(new Date(asUtcMidnight), tz))
  start = new Date(asUtcMidnight - zoneOffsetMs(start, tz))
  return start
}

/** The half-open UTC range [start, end) covering one of the store's days, plus the local date it names. */
export function storeDayRange(tz: string, on?: Date | string): { start: Date; end: Date; date: string } {
  const date = typeof on === 'string' ? on : storeDateString(on || new Date(), tz)
  const start = storeDayStart(date, tz)
  const next = new Date(`${date}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1)
  const end = storeDayStart(next.toISOString().slice(0, 10), tz)
  return { start, end, date }
}

/**
 * A job's own calendar day, as SQL — see rule 2 above. A booking carries a real instant and is read in
 * the store's zone; everything else carries a midnight marker and is taken at face value.
 *
 * With tz = 'UTC' this reduces to `scheduled_date::date`, which is what `>= midnight AND < next midnight`
 * already meant, so an unconfigured company is unaffected.
 */
export const jobLocalDay = (scheduledDate: any, source: any, tz: string) =>
  sql`(CASE WHEN ${source} = 'online_booking' THEN ((${scheduledDate}) AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date ELSE (${scheduledDate})::date END)`
