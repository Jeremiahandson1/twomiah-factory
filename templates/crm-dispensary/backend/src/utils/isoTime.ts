// One rule for what a time looks like leaving this API, and one rule for which clock the store runs on.
//
// Dispensary T21 M3. A `timestamp` column read through a TYPED drizzle select becomes a JS Date and
// serialises as "2026-09-19T06:14:42.188Z" — an instant, which the browser renders in the reader's own
// zone. The same column read through RAW SQL comes back as the driver's text, "2026-09-19 06:14:42.188302",
// with no zone marker at all. new Date() on that is read as LOCAL time, so a drawer opened at 01:14
// Chicago displayed as 6:14 AM. Orders were right and cash was wrong for exactly this reason, and the
// audit log joined them the moment it started working — it is raw SQL too. Any route that reaches for
// db.execute inherits the bug, which is why this is fixed once, at the edge, rather than per route.
//
// The values are already UTC; only the marker is missing. Stamping the Z is not a conversion.

import { sql } from 'drizzle-orm'

// "2026-09-19 06:14:42.188302" or "2026-09-19T06:14:42" — no Z, no ±hh:mm offset.
const NAIVE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,6})?$/

export function isNaiveTimestamp(v: unknown): v is string {
  return typeof v === 'string' && NAIVE_TIMESTAMP.test(v)
}

// Postgres keeps microseconds; JSON/JS time is milliseconds. Truncate rather than round, so a time
// never moves forward into the next millisecond.
export function toIsoUtc(v: string): string {
  const m = NAIVE_TIMESTAMP.exec(v)
  if (!m) return v
  const millis = m[3] ? (m[3] + '000').slice(1, 4) : '000'
  return `${m[1]}T${m[2]}.${millis}Z`
}

// Walk a response body and stamp every naive timestamp. Depth-limited so a pathological structure
// cannot spin, and it never touches a string that already carries a zone.
export function normalizeTimestamps<T>(value: T, depth = 0): T {
  if (depth > 12 || value == null) return value
  if (isNaiveTimestamp(value)) return toIsoUtc(value) as unknown as T
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizeTimestamps(value[i], depth + 1)
    return value
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const k of Object.keys(value as any)) (value as any)[k] = normalizeTimestamps((value as any)[k], depth + 1)
  }
  return value
}

// ── which clock the shop runs on ───────────────────────────────────────────────────────────────────
// Peak Hours bucketed EXTRACT(HOUR FROM created_at), which is UTC: a 7pm Friday rush showed up in the
// small hours of Saturday. Bucketing has to happen on the store's own clock, so the store has to have
// one. Settings wins; otherwise the licensed state the company already records decides it; otherwise
// UTC, which at least does not invent an offset.
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

export const DEFAULT_TIME_ZONE = 'UTC'

// A zone name only counts if this runtime actually knows it — an unknown name would make Postgres
// throw on AT TIME ZONE and take the whole chart down with it.
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export function storeTimeZone(co: any): string {
  const configured = (co?.settings as any)?.timezone
  if (isValidTimeZone(configured)) return configured
  const byState = STATE_TIME_ZONES[String(co?.state || '').trim().toUpperCase()]
  if (byState) return byState
  return DEFAULT_TIME_ZONE
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHICH DAY a sale belongs to.
//
// T21 M3 fixed the hour: the peak-hours chart read EXTRACT(HOUR FROM created_at), which is UTC, so a
// 7pm Friday rush charted in the small hours of Saturday. The DAY was left on the same broken footing,
// and it is worse, because it moves money between reporting periods rather than between bars on a
// chart. A sale rung up at 20:06 on Saturday in Ohio is stored 2026-09-20T01:06Z and every daily
// figure — the dashboard's Today tile, the analytics day series, cash reconciliation, the state sales
// report — filed it under Sunday. That is the last two hours of trade every day for a Central store,
// three for Mountain, four for Pacific. The order detail page has shown local time since T22, so the
// app displayed one day and filed another. (Dispensary T24 N1)
//
// created_at is a naive UTC timestamp, so the conversion is the same two steps as the hour fix: label
// it UTC, then read it in the store's zone.

/** A naive-UTC timestamp expression as the STORE's wall clock. Pass a column as sql`created_at`. */
export const inStoreZone = (col: any, tz: string) => sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE ${tz})`

/** …and as the store's calendar day, which is what a daily report groups by. */
export const storeDay = (col: any, tz: string) => sql`(((${col}) AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date)`

/** What the store's wall clock calls this instant's date, as YYYY-MM-DD. */
export function storeDateString(at: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  return p // en-CA formats as YYYY-MM-DD
}

/** How far the store's clock is from UTC at this instant, in ms. */
function zoneOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  // the wall clock read as if it were UTC, minus the real instant
  return Date.UTC(g('year'), g('month') - 1, g('day') % 32, g('hour') % 24, g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000
}

/** The UTC instant at which a given local date begins in this zone. */
export function storeDayStart(dateStr: string, tz: string): Date {
  const asUtcMidnight = new Date(`${dateStr}T00:00:00.000Z`).getTime()
  // Subtracting the offset lands on the right instant; do it twice so a day that begins on a DST
  // boundary settles on the offset that is actually in force at the start of it.
  let start = new Date(asUtcMidnight - zoneOffsetMs(new Date(asUtcMidnight), tz))
  start = new Date(asUtcMidnight - zoneOffsetMs(start, tz))
  return start
}

/**
 * The half-open UTC range [start, end) covering one of the STORE's days — the range a query should use
 * for "today", so the timestamp column stays untouched and its index still applies.
 */
export function storeDayRange(tz: string, on?: Date | string): { start: Date; end: Date; date: string } {
  const date = typeof on === 'string' ? on : storeDateString(on || new Date(), tz)
  const start = storeDayStart(date, tz)
  const next = new Date(`${date}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1)
  const end = storeDayStart(next.toISOString().slice(0, 10), tz)
  return { start, end, date }
}
