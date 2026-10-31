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
  /**
   * Weekly only: the days of the week the series runs on, 0 = Sunday … 6 = Saturday ("Monday and Thursday" is [1, 4]).
   * Every N weeks, from the week of `firstDate`, one day for each listed weekday; a listed day before `firstDate` in that
   * first week is not made. Absent or empty: the one weekday `firstDate` falls on, as before.
   */
  weekdays?: number[] | null
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

const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`).getUTCDay()
/** The listed weekdays as 0–6, each once, in week order. Anything else is dropped. */
export function cleanWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
}
const WEEKDAY_WORDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The series' days in order, each with its place in the series (1-based). */
export function seriesDays(spec: SeriesDays): Array<{ date: string; index: number }> {
  const interval = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const max = Math.max(1, Math.trunc(spec.max ?? MAX_SERIES))
  const cap = Math.min(max, spec.occurrencesCount && spec.occurrencesCount > 0 ? spec.occurrencesCount : max)
  const out: Array<{ date: string; index: number }> = []
  const days = spec.frequency === 'weekly' ? cleanWeekdays(spec.weekdays) : []
  if (days.length) {
    const weekStart = addDays(spec.firstDate, -dayOfWeek(spec.firstDate))
    // Bounded: a series reaches its end (`cap`, or `untilDate`) well inside 400 weeks.
    for (let w = 0; w < 400 && out.length < cap; w++) {
      for (const d of days) {
        const date = addDays(weekStart, w * 7 * interval + d)
        if (date < spec.firstDate) continue
        if (spec.untilDate && date > spec.untilDate) return out
        if (out.length >= cap) return out
        out.push({ date, index: out.length + 1 })
      }
    }
    return out
  }
  for (let i = 0; out.length < cap; i++) {
    const date = spec.frequency === 'monthly' ? addMonthsClamped(spec.firstDate, i * interval) : addDays(spec.firstDate, i * 7 * interval)
    if (spec.untilDate && date > spec.untilDate) break
    out.push({ date, index: i + 1 })
  }
  return out
}

/** "Every week", "Every 2 weeks", "Every month", "Every 3 months" — then ", 12 times" or " until 1 June 2027". */
export function describeSeriesDays(spec: Pick<SeriesDays, 'frequency' | 'intervalCount' | 'occurrencesCount' | 'untilDate'> & { weekdays?: number[] | string | null }): string {
  const n = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const picked = spec.frequency === 'weekly' ? cleanWeekdays(typeof spec.weekdays === 'string' ? spec.weekdays.split(',') : spec.weekdays) : []
  const on = picked.length ? ` on ${picked.length === 1 ? WEEKDAY_WORDS[picked[0]] : `${picked.slice(0, -1).map((d) => WEEKDAY_WORDS[d]).join(', ')} and ${WEEKDAY_WORDS[picked[picked.length - 1]]}`}` : ''
  const how = (spec.frequency === 'monthly' ? (n > 1 ? `Every ${n} months` : 'Every month') : (n > 1 ? `Every ${n} weeks` : 'Every week')) + on
  if (spec.occurrencesCount) return `${how}, ${spec.occurrencesCount} time${spec.occurrencesCount === 1 ? '' : 's'}`
  if (spec.untilDate) {
    const [y, m, d] = spec.untilDate.split('-').map(Number)
    return `${how} until ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))}`
  }
  return how
}
