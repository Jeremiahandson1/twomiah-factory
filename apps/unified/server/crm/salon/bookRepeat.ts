// Repeat rules for blocked time (salon parity row 2; Square "Set repetition", Fresha blocked time). Pure arithmetic, no database:
// daily or every N weeks, on chosen weekdays, until a date or for N times. Every occurrence is made on the company's own wall clock,
// so a 12:00 lunch is still 12:00 after the clocks change (a week is 7 calendar days, never 168 hours).
import { addDays, isRealDate, zonedWallTimeToUtc } from '@twomiah/tenant-backend'

export const MAX_OCCURRENCES = 120
/** A repeat may reach this far ahead of its first block. */
export const MAX_HORIZON_DAYS = 731
export const MAX_INTERVAL = 52

export type RepeatRule = {
  every: 'day' | 'week'
  /** Every N days or N weeks (1 = every). */
  interval: number
  /** Weekly only: 0 (Sunday) to 6 (Saturday). None means the weekday of the first block. */
  weekdays?: number[]
  /** The last day a block may fall on (inclusive) — or `count`, never both. */
  until?: string
  /** The total number of blocks, the first one counted. */
  count?: number
}

export type FirstBlock = {
  /** The first block's day on the company's calendar. */
  date: string
  startHm: string
  endHm: string
  /** The day it ends, when it runs past midnight or over several days; defaults to `date`. */
  endDate?: string
}

const dayOfWeek = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay()
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000)
/** The Monday on or before a day: salons count their week Monday to Sunday. */
const mondayOf = (ymd: string) => addDays(ymd, -((dayOfWeek(ymd) + 6) % 7))

/** The days a rule lands on, the first included, never more than `cap`. */
function occurrenceDates(firstDate: string, rule: RepeatRule, cap: number): string[] {
  const out: string[] = []
  const stop = (d: string) => (rule.until ? d > rule.until : false)
  const full = () => out.length >= cap || (rule.count != null && out.length >= rule.count)
  if (rule.every === 'day') {
    for (let k = 0; !full(); k++) {
      const d = addDays(firstDate, k * rule.interval)
      if (stop(d) || dayDiff(firstDate, d) > MAX_HORIZON_DAYS) break
      out.push(d)
    }
    return out
  }
  const days = rule.weekdays && rule.weekdays.length ? [...new Set(rule.weekdays)].sort((a, b) => a - b) : [dayOfWeek(firstDate)]
  const week0 = mondayOf(firstDate)
  for (let w = 0; !full(); w += rule.interval) {
    const weekStart = addDays(week0, 7 * w)
    if (stop(weekStart) || dayDiff(firstDate, weekStart) > MAX_HORIZON_DAYS) break
    // Monday first: Sunday (0) is the last day of the week.
    for (const dow of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
      const d = addDays(weekStart, (dow + 6) % 7)
      if (d < firstDate) continue
      if (stop(d) || full()) break
      out.push(d)
    }
  }
  return out
}

/** Why a rule cannot be used, in a sentence for the screen, or null when it is fine. */
export function repeatRefusal(rule: RepeatRule, firstDate: string): string | null {
  if (rule.every !== 'day' && rule.every !== 'week') return 'Repeat every day or every week.'
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL) return `The repeat interval must be a whole number from 1 to ${MAX_INTERVAL}.`
  if (rule.weekdays != null) {
    if (rule.every !== 'week') return 'Chosen weekdays only go with a weekly repeat.'
    if (!Array.isArray(rule.weekdays) || rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Weekdays must be from Sunday (0) to Saturday (6).'
  }
  const hasUntil = rule.until != null && rule.until !== '', hasCount = rule.count != null
  if (hasUntil && hasCount) return 'Choose either an end date or a number of times, not both.'
  if (!hasUntil && !hasCount) return 'Say when the repeat ends: until a date, or a number of times.'
  if (hasCount) {
    if (!Number.isInteger(rule.count) || (rule.count as number) < 1) return 'The number of times must be a whole number, 1 or more.'
    if ((rule.count as number) > MAX_OCCURRENCES) return `A repeat can make at most ${MAX_OCCURRENCES} blocks.`
  }
  if (hasUntil) {
    if (!isRealDate(rule.until)) return `${String(rule.until).slice(0, 10)} is not a real calendar date.`
    if ((rule.until as string) < firstDate) return 'The repeat must end after the first block.'
    if (dayDiff(firstDate, rule.until as string) > MAX_HORIZON_DAYS) return 'A repeat can reach at most two years ahead.'
    if (occurrenceDates(firstDate, rule, MAX_OCCURRENCES + 1).length > MAX_OCCURRENCES) return `That makes more than ${MAX_OCCURRENCES} blocks; a repeat can make at most ${MAX_OCCURRENCES}. Pick an earlier end date.`
  }
  return null
}

/** Every block a first block and a rule make, on the company's clock. No rule means the first block alone. */
export function expandRepeat(first: FirstBlock, rule: RepeatRule | null, timeZone: string): Array<{ start: Date; end: Date }> {
  const span = first.endDate ? dayDiff(first.date, first.endDate) : first.endHm <= first.startHm ? 1 : 0
  const make = (d: string) => ({ start: zonedWallTimeToUtc(d, first.startHm, timeZone), end: zonedWallTimeToUtc(addDays(d, span), first.endHm, timeZone) })
  if (!rule) return [make(first.date)]
  const bad = repeatRefusal(rule, first.date)
  if (bad) throw new Error(bad)
  return occurrenceDates(first.date, rule, MAX_OCCURRENCES).map(make)
}
