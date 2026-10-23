// The company's calendar days, without a database: pure date arithmetic on a zone. Split out of ./businessDay.ts (which
// re-exports all of it) so the pure money helpers (invoicing/money.ts) can keep a quote's "valid until" day and an
// invoice's due day on the company's clock without importing drizzle-orm (2026-10-22).

/**
 * The value a CALENDAR-DAY column should hold for a given local date: midnight UTC, standing in for
 * that day rather than naming an instant in it.
 *
 * A timesheet day is a calendar day — "the hours I worked on Friday" — not a moment. Storing `new Date()`
 * in such a column is what made a 20:00 Friday clock-in land on Saturday's sheet. Write the day.
 */
export const dayMarker = (dateStr: string) => new Date(`${String(dateStr).slice(0, 10)}T00:00:00.000Z`)

/**
 * Read a CALENDAR-DAY column back — the counterpart to `dayMarker`, taken at face value. (T33)
 *
 * The rule `jobLocalDay` states in SQL, in TypeScript: a midnight marker is taken as the day it
 * names and is NEVER converted into a zone. Converting one walks it backwards — a log filed for
 * 30 September is stored `2026-09-30T00:00:00Z`, and `storeDateString(…, 'America/Chicago')` reads
 * that instant as 7pm on the 29th and reports the log as 2026-09-29. The tester saw exactly that.
 *
 * Use this for a column that holds a DAY (a log's date, an inspection's scheduled date, an invoice's
 * issue date). Use `storeDateString` for a column that holds an INSTANT (resulted_at, created_at,
 * sent_at) — there the conversion is the whole point, and skipping it is what makes an evening
 * action report as tomorrow.
 *
 * Getting these two the wrong way round is the same bug in opposite directions, which is why they
 * now sit next to each other with the distinction written down.
 */
export const markerDay = (v: Date | string | null | undefined): string => {
  if (!v) return ''
  if (typeof v === 'string') return v.slice(0, 10)
  return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
}

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
 * Is a CALENDAR-DAY marker's day over, on this zone's clock? The whole of the day is the customer's: a quote valid
 * until 22 October lapses at the company's midnight going into the 23rd — not at UTC's, which is 7pm in Chicago and
 * read an evening customer an expired quote on its own last day (live test 2026-10-22).
 */
export function markerDayIsOver(marker: Date | string, tz: string, now: number = Date.now()): boolean {
  const day = markerDay(marker instanceof Date ? marker : new Date(marker))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  return storeDayRange(tz, day).end.getTime() <= now
}

/** Whole days from the company's today to a marker's day (negative once it has passed), on the company's clock. */
export function daysUntilMarker(marker: Date | string, tz: string, now: Date = new Date()): number {
  const day = markerDay(marker instanceof Date ? marker : new Date(marker))
  const today = storeDateString(now, tz)
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}
