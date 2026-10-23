// The company's clock, for every admin screen (2026-10-22, the coordinator's sweep after the live retest).
//
// A stored MOMENT — when a quote was approved, a note written, a truck last seen, a call taken — printed with a bare
// toLocaleString() comes out in the READER's zone: an owner checking from a trip, a tester's cloud browser on UTC,
// read "approved 1:30 AM on the 23rd" for an 8:30 PM approval in Chicago. Every figure the server reports is on the
// company's clock (packages/tenant-backend time/businessDay.ts), so the screens print moments on it too.
//
// The zone arrives with the session (GET /api/auth/me company.timeZone — companyRowTimeZone on the server) and the
// auth provider hands it here as it renders (auth/AuthContext.tsx), before any screen below it. Until then, and on a
// page with no session, the browser's zone is used — exactly what these screens did before.
//
// Two kinds of stored time, never mixed (the server's rule, time/businessDay.ts):
//   · a MOMENT (createdAt, approvedAt, a GPS ping)       → its date and time on the company's clock
//   · a CALENDAR DAY stored as midnight UTC (a due date) → the day it names, in every zone
// whenDate / whenDateTime / whenTime take either and do the right thing for each.

let zone: string | undefined

const valid = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** The auth provider calls this with the company's zone as it renders; anything not a real zone is ignored. */
export function setCompanyTimeZone(tz: unknown): void {
  zone = valid(tz) ? tz : undefined
}

/** The company's zone, or undefined (the browser's) before a session has named it. */
export function companyTimeZone(): string | undefined {
  return zone
}

const asDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v as any)
  return isNaN(d.getTime()) ? null : d
}
/** A calendar-day marker: a bare YYYY-MM-DD, or exactly midnight UTC. */
const isDay = (v: unknown, d: Date) =>
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
  (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0)

/** A moment's date on the company's clock; a calendar day as the day it names. '' for nothing. */
export function whenDate(v: unknown, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = asDate(v)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { ...opts, timeZone: isDay(v, d) ? 'UTC' : zone })
}

/** A moment's date and time on the company's clock. */
export function whenDateTime(v: unknown, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = asDate(v)
  if (!d) return ''
  return d.toLocaleString(undefined, { ...opts, timeZone: zone })
}

/** A moment's time of day on the company's clock. */
export function whenTime(v: unknown, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = asDate(v)
  if (!d) return ''
  return d.toLocaleTimeString(undefined, { ...opts, timeZone: zone })
}

/** Today on the company's clock, YYYY-MM-DD (the browser's day before a session names the zone). */
export function companyTodayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** A value known to be a MOMENT (never a calendar day), its date on the company's clock — even at midnight UTC. */
export function momentDate(v: unknown, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = asDate(v)
  return d ? d.toLocaleDateString(undefined, { ...opts, timeZone: zone }) : ''
}

/** Whole days from the company's today to a calendar day (negative once it has passed) — the server's daysUntilMarker. */
export function daysUntilDay(v: unknown): number {
  const d = asDate(v)
  if (!d) return NaN
  const day = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : d.toISOString().slice(0, 10)
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${companyTodayKey()}T00:00:00Z`)) / 86_400_000)
}

/** A moment's calendar day on the company's clock, YYYY-MM-DD — where a booking or an appointment belongs on a calendar. */
export function companyDayKey(v: unknown): string {
  const d = asDate(v)
  return d ? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : ''
}

/** A moment's minutes after midnight on the company's clock (for laying a day out by the hour). NaN for nothing. */
export function companyMinutes(v: unknown): number {
  const d = asDate(v)
  if (!d) return NaN
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return n('hour') * 60 + n('minute')
}

/** The moment a calendar day (YYYY-MM-DD) begins on the company's clock — its midnight there, as an instant. A day's
 *  bookings and appointments are fetched from this to the next day's start, the same days they are placed on. */
export function companyDayStart(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d)
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t))
    const n = (k: string) => Number(p.find((x) => x.type === k)?.value)
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - t
  }
  let t = wall - offsetAt(wall)
  t = wall - offsetAt(t) // once more, in case a clock change falls between
  return new Date(t)
}
