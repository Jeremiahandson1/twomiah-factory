// A repeating booking's visits — pure. Every visit keeps the first one's wall-clock time in the business's zone.
// The premium site (lib/booking-recurrence.ts) stepped weekly visits by a fixed 7×24 hours, so a 10:00 visit became
// 9:00 or 11:00 after a clock change, and stepped months in the SERVER's zone; here the calendar date is stepped and
// the time is put back on it in the business's zone. "Every other week" is weekly × 2 (the site also had 'biweekly').
import { addDays, tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'

export type Frequency = 'weekly' | 'monthly'
export interface SeriesSpec {
  frequency: Frequency
  intervalCount: number
  firstStartAt: Date
  durationMinutes: number
  timezone: string
  /** Stops at whichever comes first. With neither, MAX_VISITS. */
  occurrencesCount?: number | null
  /** YYYY-MM-DD in the business's zone, inclusive. */
  untilDate?: string | null
}

/** The most visits one series makes: a year of weekly visits. */
export const MAX_VISITS = 52

const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** The same day of the month n months on, or that month's last day (Jan 31 → Feb 28). */
function addMonths(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

export function expandSeries(spec: SeriesSpec): Array<{ startAt: Date; endAt: Date; index: number; date: string }> {
  const { date: firstDate, minutes } = tzParts(spec.firstStartAt, spec.timezone)
  const interval = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const cap = Math.min(MAX_VISITS, spec.occurrencesCount && spec.occurrencesCount > 0 ? spec.occurrencesCount : MAX_VISITS)
  const out: Array<{ startAt: Date; endAt: Date; index: number; date: string }> = []
  for (let i = 0; out.length < cap; i++) {
    const date = spec.frequency === 'monthly' ? addMonths(firstDate, i * interval) : addDays(firstDate, i * 7 * interval)
    if (spec.untilDate && date > spec.untilDate) break
    const startAt = zonedWallTimeToUtc(date, hm(minutes), spec.timezone)
    out.push({ startAt, endAt: new Date(startAt.getTime() + spec.durationMinutes * 60_000), index: i + 1, date })
  }
  return out
}

/** "Every other Tuesday, 8 times" — in the business's zone. */
export function describeSeries(spec: SeriesSpec): string {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: spec.timezone }).format(spec.firstStartAt)
  const n = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const how = spec.frequency === 'monthly'
    ? (n > 1 ? `Every ${n} months` : 'Every month')
    : n === 1 ? `Every ${day}` : n === 2 ? `Every other ${day}` : `Every ${n} weeks on ${day}`
  if (spec.occurrencesCount) return `${how}, ${spec.occurrencesCount} time${spec.occurrencesCount === 1 ? '' : 's'}`
  if (spec.untilDate) {
    const [y, m, d] = spec.untilDate.split('-').map(Number)
    return `${how} until ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))}`
  }
  return how
}
