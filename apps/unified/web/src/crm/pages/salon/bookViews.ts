// The Book's spans and slots (salon parity row 1; feature `book_grid`): which days a view shows (a day, three days, a week, a month),
// how a button steps through them, the window each fetches on the company's clock, and how tall a time slot is drawn. A plain module,
// so the rules are tested without a browser (tests/salon-book-views.test.ts).
import { companyDayBounds } from '@twomiah/tenant-ui/src/time/companyClock'
import { addDays, dateWords, weekdayOf } from '../../../booking/days'
import { weekOf, isDayComplete } from './bookWeek'

export type BookSpan = 'day' | 'three' | 'week' | 'month'

/** The time-slot intervals (minutes) the Book offers. The server keeps the same list (server/crm/salon/bookLayout.ts); a test holds the two equal. */
export const SLOT_CHOICES = [5, 10, 15, 30] as const
export type SlotMin = (typeof SLOT_CHOICES)[number]
export const DEFAULT_SLOT_MIN: SlotMin = 15

/** A value from anywhere (a saved preference, a select) as a slot the Book can draw; anything else is the default. */
export function asSlot(v: unknown): SlotMin {
  const n = Number(v)
  return (SLOT_CHOICES as readonly number[]).includes(n) ? (n as SlotMin) : DEFAULT_SLOT_MIN
}

/** How tall a minute is drawn for a slot: a finer slot is zoomed in so each slot stays a row a finger can hit, a coarser one zoomed out. */
const PX_PER_MIN: Record<SlotMin, number> = { 5: 3.2, 10: 2, 15: 1.1, 30: 0.7 }
export const pxPerMinFor = (slot: unknown): number => PX_PER_MIN[asSlot(slot)]

const parts = (day: string) => { const [y, m, d] = day.split('-').map(Number); return { y, m, d } }
const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The first of the month holding `day`. */
export const monthStart = (day: string) => { const { y, m } = parts(day); return `${y}-${pad(m)}-01` }

/** Is `cell` in the same month as `day`. */
export const sameMonth = (day: string, cell: string) => day.slice(0, 7) === cell.slice(0, 7)

/** The month as whole weeks, Sunday first: from the Sunday on or before the 1st to the Saturday on or after the last day. 35 or 42 days (28 when February starts on a Sunday). */
export function monthCells(day: string): string[] {
  const { y, m } = parts(day)
  const first = monthStart(day), last = `${y}-${pad(m)}-${pad(daysIn(y, m))}`
  const from = addDays(first, -weekdayOf(first)), to = addDays(last, 6 - weekdayOf(last))
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** The days a span shows for `day`: the day; it and the next two; its week; or its month's weeks (including the days either side that fill them). */
export function spanDays(span: BookSpan, day: string): string[] {
  if (span === 'day') return [day]
  if (span === 'three') return [day, addDays(day, 1), addDays(day, 2)]
  if (span === 'week') return weekOf(day)
  return monthCells(day)
}

/** `day` moved one step along: a day, three days, seven days, or a month (the same day number, or the month's last day when it is shorter). */
export function shiftSpan(span: BookSpan, day: string, dir: 1 | -1): string {
  if (span === 'day') return addDays(day, dir)
  if (span === 'three') return addDays(day, 3 * dir)
  if (span === 'week') return addDays(day, 7 * dir)
  const { y, m, d } = parts(day)
  const t = new Date(Date.UTC(y, m - 1 + dir, 1)), ty = t.getUTCFullYear(), tm = t.getUTCMonth() + 1
  return `${ty}-${pad(tm)}-${pad(Math.min(d, daysIn(ty, tm)))}`
}

/** The window a span fetches: its first day's midnight to the instant before the day after its last, on the COMPANY's clock. */
export function spanBounds(span: BookSpan, day: string): { from: string; to: string } {
  const days = spanDays(span, day)
  return { from: companyDayBounds(days[0]).from, to: companyDayBounds(days[days.length - 1]).to }
}

/** The heading over a span, or null while the date being typed is not a day yet. */
export function spanHeading(span: BookSpan, day: string): string | null {
  if (!isDayComplete(day)) return null
  if (span === 'three') {
    const d = spanDays('three', day)
    return `${dateWords(d[0], { month: 'short', day: 'numeric' })} – ${dateWords(d[2], { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (span === 'month') return dateWords(monthStart(day), { month: 'long', year: 'numeric' })
  return null
}

/** A list with the item at `from` moved to `to` (both clamped to the list); the list itself is not changed. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list]
  if (from < 0 || from >= out.length) return out
  const [item] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item)
  return out
}
