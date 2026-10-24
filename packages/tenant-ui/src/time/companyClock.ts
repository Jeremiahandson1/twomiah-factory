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

/**
 * A CLOCK TIME ON ANOTHER ZONE'S CLOCK SAYS WHICH ONE (scripts/check-converted-time-names-its-zone.ts). Once a session
 * has named the company's zone, a time printed on it carries the zone's short name — "8:30 PM CDT" — so an owner
 * reading from another state, or a tester's UTC browser, can tell whose clock it is: the reason the time was converted
 * at all. Before a zone is named nothing is converted (the browser's own clock) and nothing is added. A caller's own
 * timeZoneName wins.
 *
 * dateStyle / timeStyle cannot be combined with timeZoneName (Intl throws), so they are spelled out as the component
 * options they stand for.
 */
const DATE_STYLE: Record<string, Intl.DateTimeFormatOptions> = {
  full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  short: { year: '2-digit', month: 'numeric', day: 'numeric' },
}
const TIME_STYLE: Record<string, Intl.DateTimeFormatOptions> = {
  full: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  long: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  medium: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  short: { hour: 'numeric', minute: '2-digit' },
}
const spelledOut = (opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => {
  const { dateStyle, timeStyle, ...rest } = opts
  if (!dateStyle && !timeStyle) return opts
  return { ...(dateStyle ? DATE_STYLE[dateStyle] : {}), ...(timeStyle ? TIME_STYLE[timeStyle] : {}), ...rest }
}

/** A moment's date and time on the company's clock, naming the zone once one is set. */
export function whenDateTime(v: unknown, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = asDate(v)
  if (!d) return ''
  return d.toLocaleString(undefined, zone ? { timeZoneName: 'short', ...spelledOut(opts), timeZone: zone } : opts)
}

/**
 * A log's "[2026-10-24T16:54:29.885Z] Tech arrived on site" lines, with each ISO stamp read on the company's clock. Old
 * job notes were written that way (landscaping live retest, 2026-10-24); new ones are written readable by the server.
 */
export function stampsOnClock(text: string): string {
  return String(text || '').replace(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)\]/g, (whole, iso) => {
    const shown = whenDateTime(iso, { dateStyle: 'medium', timeStyle: 'short' } as any)
    return shown ? `[${shown}]` : whole
  })
}

/** A moment's time of day on the company's clock, naming the zone once one is set. */
export function whenTime(v: unknown, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = asDate(v)
  if (!d) return ''
  return d.toLocaleTimeString(undefined, zone ? { timeZoneName: 'short', ...spelledOut(opts), timeZone: zone } : opts)
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

/**
 * The instant a zone's wall clock reads `hhmm` (HH:MM) on calendar day `dayKey` (YYYY-MM-DD) — what a typed date and
 * time on a form mean. `new Date('2026-10-22T20:00')` read them on the BROWSER's clock instead. No zone: the browser's.
 * The one implementation; the company's and the home care agency's clocks are both built on it.
 */
export function zoneMoment(dayKey: string, hhmm: string, tz: string | undefined): Date {
  const [y, m, d] = String(dayKey).slice(0, 10).split('-').map(Number)
  const [h, mi] = String(hhmm || '00:00').split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h || 0, mi || 0)
  if (Number.isNaN(wall)) return new Date(NaN)
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t))
    const n = (k: string) => Number(p.find((x) => x.type === k)?.value)
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - t
  }
  let t = wall - offsetAt(wall)
  t = wall - offsetAt(t) // once more, in case a clock change falls between
  return new Date(t)
}

/** A moment's wall date and time on a zone's clock: { date: YYYY-MM-DD, time: HH:MM } — what date/time inputs show for it. */
export function zoneWall(v: unknown, tz: string | undefined): { date: string; time: string } {
  const d = asDate(v)
  if (!d) return { date: '', time: '' }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** The instant the company's wall clock reads `hhmm` on `dayKey`. */
export function companyMoment(dayKey: string, hhmm = '00:00'): Date {
  return zoneMoment(dayKey, hhmm, zone)
}

/** The moment a calendar day (YYYY-MM-DD) begins on the company's clock — its midnight there, as an instant. A day's
 *  bookings and appointments are fetched from this to the next day's start, the same days they are placed on. */
export function companyDayStart(dayKey: string): Date {
  return companyMoment(dayKey, '00:00')
}

/** A moment's wall time on the company's clock, HH:MM (24-hour) — what a time input shows for it. */
export function companyHHMM(v: unknown): string {
  return zoneWall(v, zone).time
}

/** A moment as a datetime-local input's value (YYYY-MM-DDTHH:MM) on the company's clock; and back again. */
export function companyLocalInput(v: unknown): string {
  const w = zoneWall(v, zone)
  return w.date ? `${w.date}T${w.time}` : ''
}
export function companyFromLocalInput(value: string): Date {
  const [day, time] = String(value || '').split('T')
  return zoneMoment(day, (time || '').slice(0, 5), zone)
}

/** A calendar day's window on the company's clock, as ISO instants: from its midnight to the instant before the next. */
export function companyDayBounds(dayKey: string): { from: string; to: string } {
  const [y, m, d] = String(dayKey).slice(0, 10).split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return { from: companyDayStart(dayKey).toISOString(), to: new Date(companyDayStart(next).getTime() - 1).toISOString() }
}

/** A moment's wall date and time on the company's clock ({ date, time }); now, if none is given. */
export function companyWall(v: unknown = new Date()): { date: string; time: string } {
  return zoneWall(v, zone)
}

/** The company's today as a Date at local midnight — for calendar arithmetic (week starts, month starts, "30 days back")
 *  whose keys are read back with the browser-local getters. `new Date()` there was the browser's today. */
export function companyTodayDate(): Date {
  const [y, m, d] = companyTodayKey().split('-').map(Number)
  return new Date(y, m - 1, d)
}
