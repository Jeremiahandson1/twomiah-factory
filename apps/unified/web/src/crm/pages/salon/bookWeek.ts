// The book's days and weeks (AppointmentsPage): which days a view shows, the window it fetches on the company's clock,
// and the week's appointments laid out by day. A plain module, so the rules are tested without a browser
// (tests/salon-book-week.test.ts). Salon live test, 2026-10-25: "The Book shows one day at a time".
import { companyDayBounds, companyDayKey } from '@twomiah/tenant-ui/src/time/companyClock'
import { addDays, dateWords, weekdayOf } from '../../../booking/days'

export type BookView = 'day' | 'week'

/**
 * A day the book can actually be shown for.
 *
 * The date input reports every keystroke, so a half-typed or cleared date reached dayBounds as
 * something like "2026-0" — new Date(...) is Invalid Date and toISOString() throws RangeError. The
 * load failed, the rows from the previous day stayed on screen, and the heading above them rendered
 * "Chairs on Invalid Date": a day that reads as though it has those appointments. (Salon T20 M5)
 */
export function isDayComplete(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false
  return !Number.isNaN(new Date(`${day}T12:00:00`).getTime())
}

/** The seven days (YYYY-MM-DD) of the week holding `day`, Sunday first as the booking calendar — no clock involved. */
export function weekOf(day: string): string[] {
  const start = addDays(day, -weekdayOf(day))
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** The heading for the week holding `day`, or null while the one being typed is not a day yet. */
export function weekHeading(day: string): string | null {
  if (!isDayComplete(day)) return null
  const days = weekOf(day)
  return `Week of ${dateWords(days[0], { month: 'short', day: 'numeric' })} – ${dateWords(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`
}

/**
 * The window a view fetches: the day, or its whole week, from the first midnight to the instant before the next on the
 * COMPANY's clock, as the book's times are — the browser's day fetched the wrong evening's appointments for a viewer in
 * another zone (2026-10-23). The week is the day's request made wider: the same route, the same permission.
 */
export function viewBounds(view: BookView, day: string): { from: string; to: string } {
  if (view === 'day') return companyDayBounds(day)
  const days = weekOf(day)
  return { from: companyDayBounds(days[0]).from, to: companyDayBounds(days[6]).to }
}

/** The week's appointments by the company's day each starts on: every day present, each in time order. */
export function byDay<T extends { startTime?: string }>(rows: T[], days: string[]): Record<string, T[]> {
  const out: Record<string, T[]> = Object.fromEntries(days.map((d) => [d, [] as T[]]))
  for (const r of rows) {
    const key = companyDayKey(r.startTime)
    if (out[key]) out[key].push(r)
  }
  for (const d of days) out[d].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
  return out
}
