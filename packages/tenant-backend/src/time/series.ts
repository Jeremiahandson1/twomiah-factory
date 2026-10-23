// The calendar days a repeating series falls on — pure, one rule for every repeat in the app (2026-10-22).
//
// It was the booking engine's (apps/unified/server/booking/recurrence.ts): "every other Tuesday, eight times". A
// repeating JOB (weekly mowing) and a maintenance contract's visits (two a year) are the same question on calendar
// days, so the stepping lives here and each caller puts its own time on the days: a booking its wall-clock time in the
// business's zone, a job the day marker and the time box it already has.
import { addDays } from '../booking/time'

export type SeriesFrequency = 'weekly' | 'monthly'
export interface SeriesDays {
  frequency: SeriesFrequency
  /** Every N weeks or months ("every other week" is weekly × 2). */
  intervalCount: number
  /** YYYY-MM-DD, the first day. */
  firstDate: string
  /** Stops at whichever comes first. With neither, `max`. */
  occurrencesCount?: number | null
  /** YYYY-MM-DD, inclusive. */
  untilDate?: string | null
  /** The most days one series makes. Default MAX_SERIES (a year of weekly visits). */
  max?: number
}

/** The most visits one series makes: a year of weekly visits. */
export const MAX_SERIES = 52

/** The same day of the month n months on, or that month's last day (Jan 31 → Feb 28). */
export function addMonthsClamped(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

/** The series' days in order, each with its place in the series (1-based). */
export function seriesDays(spec: SeriesDays): Array<{ date: string; index: number }> {
  const interval = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const max = Math.max(1, Math.trunc(spec.max ?? MAX_SERIES))
  const cap = Math.min(max, spec.occurrencesCount && spec.occurrencesCount > 0 ? spec.occurrencesCount : max)
  const out: Array<{ date: string; index: number }> = []
  for (let i = 0; out.length < cap; i++) {
    const date = spec.frequency === 'monthly' ? addMonthsClamped(spec.firstDate, i * interval) : addDays(spec.firstDate, i * 7 * interval)
    if (spec.untilDate && date > spec.untilDate) break
    out.push({ date, index: i + 1 })
  }
  return out
}

/** "Every week", "Every 2 weeks", "Every month", "Every 3 months" — then ", 12 times" or " until 1 June 2027". */
export function describeSeriesDays(spec: Pick<SeriesDays, 'frequency' | 'intervalCount' | 'occurrencesCount' | 'untilDate'>): string {
  const n = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const how = spec.frequency === 'monthly' ? (n > 1 ? `Every ${n} months` : 'Every month') : (n > 1 ? `Every ${n} weeks` : 'Every week')
  if (spec.occurrencesCount) return `${how}, ${spec.occurrencesCount} time${spec.occurrencesCount === 1 ? '' : 's'}`
  if (spec.untilDate) {
    const [y, m, d] = spec.untilDate.split('-').map(Number)
    return `${how} until ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))}`
  }
  return how
}
