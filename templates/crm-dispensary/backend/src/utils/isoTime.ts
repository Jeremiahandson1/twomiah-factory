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
