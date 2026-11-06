// The calendar days a repeating series falls on — pure, one rule for every repeat in the app (2026-10-22).
//
// It was the booking engine's (apps/unified/server/booking/recurrence.ts): "every other Tuesday, eight times". A
// repeating JOB (weekly mowing) and a maintenance contract's visits (two a year) are the same question on calendar
// days, so the stepping lives here and each caller puts its own time on the days: a booking its wall-clock time in the
// business's zone, a job the day marker and the time box it already has.
import { addDays } from '../booking/time'

/**
 * 'daily' (every N days), 'monthly_nth' (the 1st and 3rd Friday of every N months) and 'yearly' are landscaping parity row 18
 * (Service Autopilot's custom schedule, Jobber's custom repeat) — offered where the app turns on more repeat patterns.
 */
export type SeriesFrequency = 'weekly' | 'monthly' | 'daily' | 'monthly_nth' | 'yearly'
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
  /** 'daily' only: days the series never falls on (holidays, a week away) — that occurrence is skipped, not moved. */
  excludeDates?: string[] | null
  /** 'daily' only: weekdays it never falls on (0 = Sunday … 6 = Saturday): "every 3 days, never on a weekend". */
  skipWeekdays?: number[] | null
  /** 'monthly_nth' only: which of the month's weekdays — 1 to 4, or -1 for the last ("1st and 3rd" is [1, 3]). */
  nthPositions?: number[] | null
  /** 'monthly_nth' only: the weekday, 0 = Sunday … 6 = Saturday. */
  nthWeekday?: number | null
}

/** The most visits one series makes: a year of weekly visits. */
export const MAX_SERIES = 52
/**
 * With more repeat patterns on (row 18), a series may run up to a year of visits however often it falls — a twice-weekly year is
 * 104, an every-other-day year 183 — so the cap becomes a YEAR (SERIES_SPAN_DAYS from the first visit) and at most 366 visits.
 */
export const MAX_SERIES_PATTERNS = 366
export const SERIES_SPAN_DAYS = 366

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

/** The day of the month that is the `pos`-th (1–4, or -1 = last) `weekday` of the month starting at `monthFirst` (YYYY-MM-01). */
export function nthWeekdayOf(monthFirst: string, weekday: number, pos: number): string | null {
  const [y, m] = monthFirst.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (pos === -1) {
    for (let d = days; d > days - 7; d--) { const iso = `${monthFirst.slice(0, 8)}${String(d).padStart(2, '0')}`; if (dayOfWeek(iso) === weekday) return iso }
    return null
  }
  const first = (weekday - dayOfWeek(monthFirst) + 7) % 7 + 1 + (pos - 1) * 7
  return first <= days ? `${monthFirst.slice(0, 8)}${String(first).padStart(2, '0')}` : null
}

/** The same day n years on (Feb 29 becomes Feb 28). */
const addYearsClamped = (dateIso: string, n: number) => addMonthsClamped(dateIso, n * 12)

/** The series' days in order, each with its place in the series (1-based). */
export function seriesDays(spec: SeriesDays): Array<{ date: string; index: number }> {
  const interval = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const max = Math.max(1, Math.trunc(spec.max ?? MAX_SERIES))
  const cap = Math.min(max, spec.occurrencesCount && spec.occurrencesCount > 0 ? spec.occurrencesCount : max)
  const out: Array<{ date: string; index: number }> = []
  const push = (date: string) => { out.push({ date, index: out.length + 1 }) }
  const past = (date: string) => !!spec.untilDate && date > spec.untilDate
  if (spec.frequency === 'daily') {
    const skip = new Set(cleanWeekdays(spec.skipWeekdays)), off = new Set((spec.excludeDates || []).map(String))
    for (let i = 0; i < 4000 && out.length < cap; i++) {
      const date = addDays(spec.firstDate, i * interval)
      if (past(date)) break
      if (skip.has(dayOfWeek(date)) || off.has(date)) continue
      push(date)
    }
    return out
  }
  if (spec.frequency === 'monthly_nth') {
    const positions = [...new Set((spec.nthPositions || []).map(Number).filter((n) => n === -1 || (Number.isInteger(n) && n >= 1 && n <= 4)))]
    const wd = Number(spec.nthWeekday)
    if (!positions.length || !Number.isInteger(wd) || wd < 0 || wd > 6) return out
    const month0 = `${spec.firstDate.slice(0, 7)}-01`
    for (let i = 0; i < 400 && out.length < cap; i++) {
      const month = addMonthsClamped(month0, i * interval)
      const dates = positions.map((p) => nthWeekdayOf(month, wd, p)).filter((d): d is string => !!d).sort()
      for (const date of [...new Set(dates)]) {
        if (date < spec.firstDate) continue
        if (past(date)) return out
        if (out.length >= cap) return out
        push(date)
      }
    }
    return out
  }
  if (spec.frequency === 'yearly') {
    for (let i = 0; out.length < cap && i < 100; i++) {
      const date = addYearsClamped(spec.firstDate, i * interval)
      if (past(date)) break
      push(date)
    }
    return out
  }
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
const ORDINAL: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' }
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
/** A list kept as text ("1,3" / "2026-12-25,2027-01-01"), or an array, as an array. */
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])

export function describeSeriesDays(spec: Pick<SeriesDays, 'frequency' | 'intervalCount' | 'occurrencesCount' | 'untilDate'> & { weekdays?: number[] | string | null; skipWeekdays?: number[] | string | null; excludeDates?: string[] | string | null; nthPositions?: number[] | string | null; nthWeekday?: number | null }): string {
  const n = Math.max(1, Math.trunc(spec.intervalCount || 1))
  const picked = spec.frequency === 'weekly' ? cleanWeekdays(typeof spec.weekdays === 'string' ? spec.weekdays.split(',') : spec.weekdays) : []
  const on = picked.length ? ` on ${picked.length === 1 ? WEEKDAY_WORDS[picked[0]] : `${picked.slice(0, -1).map((d) => WEEKDAY_WORDS[d]).join(', ')} and ${WEEKDAY_WORDS[picked[picked.length - 1]]}`}` : ''
  let how: string
  if (spec.frequency === 'daily') {
    const skip = cleanWeekdays(listOf(spec.skipWeekdays)), off = listOf(spec.excludeDates)
    how = (n > 1 ? `Every ${n} days` : 'Every day') + (skip.length ? `, never on ${listWords(skip.map((d) => WEEKDAY_WORDS[d]))}` : '') + (off.length ? `, skipping ${off.length} day${off.length === 1 ? '' : 's'}` : '')
  } else if (spec.frequency === 'monthly_nth') {
    const pos = listOf(spec.nthPositions).map((p) => ORDINAL[p]).filter(Boolean)
    how = `The ${listWords(pos)} ${DAY_NAMES[Number(spec.nthWeekday)] ?? ''} of ${n > 1 ? `every ${n} months` : 'every month'}`
  } else if (spec.frequency === 'yearly') {
    how = n > 1 ? `Every ${n} years` : 'Every year'
  } else {
    how = (spec.frequency === 'monthly' ? (n > 1 ? `Every ${n} months` : 'Every month') : (n > 1 ? `Every ${n} weeks` : 'Every week')) + on
  }
  if (spec.occurrencesCount) return `${how}, ${spec.occurrencesCount} time${spec.occurrencesCount === 1 ? '' : 's'}`
  if (spec.untilDate) {
    const [y, m, d] = spec.untilDate.split('-').map(Number)
    return `${how} until ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))}`
  }
  return how
}
