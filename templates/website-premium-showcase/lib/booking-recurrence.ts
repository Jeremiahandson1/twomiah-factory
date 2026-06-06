/**
 * Recurring booking helpers.
 *
 * Given a series spec (frequency, interval, first occurrence, cap),
 * compute the list of occurrence dates. Pure function — no DB, no I/O —
 * so the slot generator can use it for previewing and the admin /
 * series creation can use it for materializing.
 */

export type Frequency = 'weekly' | 'biweekly' | 'monthly'

export interface SeriesSpec {
  frequency: Frequency
  intervalCount?: number  // default 1
  firstStartAt: Date
  durationMinutes: number
  occurrencesCount?: number | null
  untilDate?: Date | null
}

export function expandSeries(spec: SeriesSpec): Array<{ startAt: Date; endAt: Date; index: number }> {
  const out: Array<{ startAt: Date; endAt: Date; index: number }> = []
  const interval = spec.intervalCount ?? 1
  const cap = spec.occurrencesCount ?? 52  // hard cap at 1 year of weekly = 52
  const until = spec.untilDate ? spec.untilDate.getTime() : Number.POSITIVE_INFINITY
  let current = new Date(spec.firstStartAt)
  let i = 0
  while (i < cap && current.getTime() <= until) {
    const start = new Date(current)
    const end = new Date(start.getTime() + spec.durationMinutes * 60_000)
    out.push({ startAt: start, endAt: end, index: i + 1 })
    // Step forward
    if (spec.frequency === 'weekly' || spec.frequency === 'biweekly') {
      const step = spec.frequency === 'weekly' ? 7 : 14
      current = new Date(current.getTime() + step * interval * 86_400_000)
    } else if (spec.frequency === 'monthly') {
      // Calendar month — same day-of-month. Falls back to last day if
      // target month is shorter (Jan 31 → Feb 28).
      const d = new Date(current)
      const targetMonth = d.getMonth() + interval
      const newDate = new Date(d.getFullYear(), targetMonth, 1, d.getHours(), d.getMinutes(), 0, 0)
      const daysInTarget = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate()
      newDate.setDate(Math.min(d.getDate(), daysInTarget))
      current = newDate
    }
    i++
  }
  return out
}

/**
 * Human-readable summary like "Every other Tuesday, 8 times" for emails
 * and confirmation pages.
 */
export function summarizeSeries(spec: SeriesSpec): string {
  const day = spec.firstStartAt.toLocaleDateString('en-US', { weekday: 'long' })
  const everyOther = spec.frequency === 'biweekly' || (spec.frequency === 'weekly' && spec.intervalCount === 2)
  const freqLabel = spec.frequency === 'monthly'
    ? (spec.intervalCount && spec.intervalCount > 1 ? 'Every ' + spec.intervalCount + ' months' : 'Every month')
    : everyOther ? 'Every other ' + day
    : spec.frequency === 'weekly' && (spec.intervalCount ?? 1) > 1 ? 'Every ' + spec.intervalCount + ' weeks on ' + day
    : 'Every ' + day
  let tail = ''
  if (spec.occurrencesCount) tail = ', ' + spec.occurrencesCount + ' time' + (spec.occurrencesCount === 1 ? '' : 's')
  else if (spec.untilDate) tail = ' until ' + spec.untilDate.toLocaleDateString('en-US', { dateStyle: 'long' })
  return freqLabel + tail
}
