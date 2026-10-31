/**
 * The week's schedule, pure and tested (tests/bar/bar-schedule.test.ts). The database side is barSchedule.ts.
 *
 * A scheduled shift is a local date + start/end clock times; an end at or before the start runs past midnight
 * ("4 PM to 1 AM"). "open" / "close" are resolved to that day's bar hours when the shift is made. Coverage is
 * checked against the bar's own hours (services/barHours.ts), so the grid can say "nobody on Tuesday 10:30–11 AM"
 * before the week is published.
 *
 * The workweek starts on MONDAY — the same week the CRM's timesheet uses (shared time getWeekStart) — and hours
 * past 40 in it are overtime (federal; Wisconsin DWD 274 has no daily overtime). Ported from website-premium-bar's
 * lib/staff/schedule.ts (Amber Inn, 9/29), keyed by login user instead of a staff PIN.
 */
import { addDays, localParts, localToUtc, rangesFor, type HoursConfig } from './barHours.ts'
import { BUSINESS_DAY_STARTS } from './barLive.ts'

export const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/
export const OVERTIME_AFTER_HOURS = 40
export const WEEK_STARTS = 1   // Monday

export interface Planned { id?: string; userId: string; day: string; start: string; end: string }

export function dayOfWeek(dateStr: string): number { return new Date(dateStr + 'T12:00:00Z').getUTCDay() }

/** The Monday that starts the workweek containing dateStr. */
export function workweekStart(dateStr: string): string {
  return addDays(dateStr, -((dayOfWeek(dateStr) - WEEK_STARTS + 7) % 7))
}

export function shiftSpan(day: string, start: string, end: string, tz: string): { a: Date; b: Date } {
  const a = localToUtc(day, start, tz)
  let b = localToUtc(day, end, tz)
  if (b.getTime() <= a.getTime()) b = localToUtc(addDays(day, 1), end, tz)
  return { a, b }
}

export function hoursOf(p: Planned, tz: string): number {
  const { a, b } = shiftSpan(p.day, p.start, p.end, tz)
  return Math.round(((b.getTime() - a.getTime()) / 3600000) * 100) / 100
}

/** The bar's close on a given day (the last range's close), for "4 PM to close". null when closed. */
export function closeOn(config: HoursConfig, day: string): string | null {
  const r = rangesFor(config, 'bar', day).ranges
  return r.length ? r[r.length - 1].close : null
}
export function openOn(config: HoursConfig, day: string): string | null {
  const r = rangesFor(config, 'bar', day).ranges
  return r.length ? r[0].open : null
}

// The wall-clock hour and minute in the bar's zone, as arithmetic (formatToParts, never shown as it comes).
const hhmm = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  return `${g('hour')}:${g('minute')}`
}

/** Stretches the bar is open with nobody scheduled (a gap is reported on the day its open period started). */
export function coverageGaps(config: HoursConfig, days: string[], shifts: Planned[], tz: string): Array<{ day: string; from: string; to: string; minutes: number }> {
  const spans = shifts.map(s => shiftSpan(s.day, s.start, s.end, tz)).sort((x, y) => x.a.getTime() - y.a.getTime())
  const out: Array<{ day: string; from: string; to: string; minutes: number }> = []
  for (const day of days) {
    for (const r of rangesFor(config, 'bar', day).ranges) {
      const open = shiftSpan(day, r.open, r.close, tz)
      let cursor = open.a.getTime()
      const end = open.b.getTime()
      for (const s of spans) {
        if (s.b.getTime() <= cursor || s.a.getTime() >= end) continue
        if (s.a.getTime() > cursor) out.push({ day, from: hhmm(new Date(cursor), tz), to: hhmm(s.a, tz), minutes: Math.round((s.a.getTime() - cursor) / 60000) })
        cursor = Math.max(cursor, s.b.getTime())
        if (cursor >= end) break
      }
      if (cursor < end) out.push({ day, from: hhmm(new Date(cursor), tz), to: hhmm(new Date(end), tz), minutes: Math.round((end - cursor) / 60000) })
    }
  }
  return out
}

/** Scheduled hours per person for the week, what would be overtime, and projected wages (cents; null without a rate). */
export function weekPlan(shifts: Planned[], tz: string, ratesCents: Map<string, number | null>) {
  const byUser = new Map<string, number>()
  for (const s of shifts) byUser.set(s.userId, (byUser.get(s.userId) || 0) + hoursOf(s, tz))
  let wages: number | null = 0
  const people = [...byUser].map(([userId, h]) => {
    const total = Math.round(h * 100) / 100
    const overtime = Math.max(0, Math.round((total - OVERTIME_AFTER_HOURS) * 100) / 100)
    const rate = ratesCents.get(userId) ?? null
    const w = rate === null ? null : Math.round((total - overtime) * rate + overtime * rate * 1.5)
    wages = w === null || wages === null ? null : wages + w
    return { userId, hours: total, overtime, wagesCents: w }
  })
  return { people, wagesCents: shifts.length ? wages : 0 }
}

/** Two shifts for the same person that overlap (a double-booking). */
export function overlaps(shifts: Planned[], tz: string): Array<[Planned, Planned]> {
  const out: Array<[Planned, Planned]> = []
  const sorted = [...shifts].sort((x, y) => x.userId.localeCompare(y.userId) || shiftSpan(x.day, x.start, x.end, tz).a.getTime() - shiftSpan(y.day, y.start, y.end, tz).a.getTime())
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i - 1], q = sorted[i]
    if (p.userId !== q.userId) continue
    if (shiftSpan(q.day, q.start, q.end, tz).a.getTime() < shiftSpan(p.day, p.start, p.end, tz).b.getTime()) out.push([p, q])
  }
  return out
}

/** "16:00" → "4 PM", "16:30" → "4:30 PM". */
export function formatClock(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const hr = h % 12 === 0 ? 12 : h % 12
  return m ? `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : `${hr} ${h < 12 ? 'AM' : 'PM'}`
}

// ─── Sales-driven labor forecast (restaurant-bar parity #9, bar_labor_forecast; tests/bar-labor-forecast.test.ts) ─────────────────────
//
// SALES by day and hour: for the day being planned, the mean of the same weekday's sales in the same clock hour over the last `weeks`
// weeks. A past day counts as a sample only when the register took sales that business day (a day it was shut is not a day of zero
// sales); inside a sample day, an hour with no sales is a real zero. The look-back is the last `weeks` same weekdays that are OVER: the day
// being planned and today (not over) are never samples, and are not counted against the weeks.
// With fewer than MIN_FORECAST_WEEKS samples there is NO number: the answer says "not enough history" and how many days it had.
// Hours are the company's clock (before 4 AM belongs to the night before, as everywhere in the bar). Money is whole cents.
export const MIN_FORECAST_WEEKS = 2
export const DEFAULT_FORECAST_WEEKS = 4
export const MAX_FORECAST_WEEKS = 8
export const DEFAULT_TARGET_LABOR_PCT = 30

/** Net sales (food and drink, gift cards sold left out) of one paid check, and when it closed. */
export interface SaleAt { at: Date; cents: number }
/** Business day → clock hour (0-23) → cents. */
export type SalesGrid = Map<string, Map<number, number>>

export function salesGrid(sales: SaleAt[], tz: string, dayOf: (at: Date) => string): SalesGrid {
  const grid: SalesGrid = new Map()
  for (const s of sales) {
    const day = dayOf(s.at), hour = localParts(s.at, tz).h
    const hours = grid.get(day) ?? grid.set(day, new Map()).get(day)!
    hours.set(hour, (hours.get(hour) || 0) + s.cents)
  }
  return grid
}

export interface HourForecast { hour: number; cents: number }
export interface DayForecast {
  day: string
  /** The past dates that were averaged. */
  sampleDays: string[]
  samples: number
  /** The weeks looked back over (the venue's setting), so "2 of 4" can be said. */
  weeksLookedBack: number
  /** The whole day, mean of the sample days' totals (hours are rounded one by one, so they can differ by a few cents). null: not enough history. */
  totalCents: number | null
  hours: HourForecast[]
  notEnoughHistory: boolean
  reason: string | null
}

/** The order the bar's hours run in a business day: 4 AM first, 3 AM last. */
const dayHourOrder = (h: number) => (h < Number(BUSINESS_DAY_STARTS.slice(0, 2)) ? h + 24 : h)

export function forecastDay(grid: SalesGrid, day: string, asOfDay: string, weeks = DEFAULT_FORECAST_WEEKS): DayForecast {
  // The last `weeks` same weekdays that are over (so planning a week ahead does not use up a week of the look-back on days that have not happened);
  // of those, the ones the register took sales on.
  const over: string[] = []
  for (let k = 1; over.length < weeks && k <= weeks + 60; k++) { const d = addDays(day, -7 * k); if (d < asOfDay) over.push(d) }
  const sampleDays = over.filter((d) => grid.has(d))
  const n = sampleDays.length
  if (n < MIN_FORECAST_WEEKS) {
    return {
      day, sampleDays, samples: n, weeksLookedBack: weeks, totalCents: null, hours: [], notEnoughHistory: true,
      reason: `Not enough history: ${n} of the last ${weeks} same weekdays had sales, and at least ${MIN_FORECAST_WEEKS} are needed.`,
    }
  }
  const seen = new Set<number>()
  for (const d of sampleDays) for (const h of grid.get(d)!.keys()) seen.add(h)
  const ordered = [...seen].sort((a, b) => dayHourOrder(a) - dayHourOrder(b))
  // Every hour between the first and the last that sold anything, so a quiet hour in the middle reads as a low number, not as a gap.
  const first = dayHourOrder(ordered[0]), last = dayHourOrder(ordered[ordered.length - 1])
  const hours: HourForecast[] = []
  for (let o = first; o <= last; o++) {
    const h = o % 24
    hours.push({ hour: h, cents: Math.round(sampleDays.reduce((s, d) => s + (grid.get(d)!.get(h) || 0), 0) / n) })
  }
  const totals = sampleDays.map((d) => [...grid.get(d)!.values()].reduce((s, c) => s + c, 0))
  return { day, sampleDays, samples: n, weeksLookedBack: weeks, totalCents: Math.round(totals.reduce((s, c) => s + c, 0) / n), hours, notEnoughHistory: false, reason: null }
}

/** What a position has been scheduled for lately: hours, and the hourly pay of the people who worked it (cents; null where no rate is on file). */
export interface PositionHistory { position: string; hours: number; avgWageCents: number | null }
export interface PositionSuggestion { position: string; hours: number }
export interface StaffingSuggestion {
  /** Sales × target labor percent, in cents. */
  budgetCents: number
  /** The hourly pay of the positions together, weighted by the hours each has been scheduled, in cents. */
  blendedWageCents: number
  totalHours: number
  positions: PositionSuggestion[]
}

/**
 * Hours per position that fit the labor budget (forecast sales × the target percent) at the pay of the people who work each position,
 * split the way the hours have been split lately. A guide to a budget, not a minimum crew: the schedule's coverage warnings stand.
 * `null` when there is nothing to base it on (no sales number, no position with hours and a rate).
 */
export function staffingFor(salesCents: number | null, targetPct: number, history: PositionHistory[]): StaffingSuggestion | null {
  if (salesCents === null) return null
  const usable = history.filter((p) => p.hours > 0 && p.avgWageCents !== null && p.avgWageCents > 0)
  const hoursAll = usable.reduce((s, p) => s + p.hours, 0)
  if (!usable.length || hoursAll <= 0) return null
  const budgetCents = Math.round((salesCents * targetPct) / 100)
  const blended = usable.reduce((s, p) => s + p.hours * (p.avgWageCents as number), 0) / hoursAll
  const totalHours = budgetCents / blended
  const quarter = (h: number) => Math.round(h * 4) / 4
  return {
    budgetCents, blendedWageCents: Math.round(blended), totalHours: quarter(totalHours),
    positions: usable.map((p) => ({ position: p.position, hours: quarter((totalHours * p.hours) / hoursAll) })).sort((a, b) => a.position.localeCompare(b.position)),
  }
}

/** Is `v` a target labor percent a venue may set (5 to 80, to the half percent)? */
export function targetPctRefusal(v: unknown): string | null {
  const n = Number(v)
  if (typeof v === 'boolean' || v === '' || v === null || !Number.isFinite(n)) return 'The target labor percent is a number, like 30.'
  if (n < 5 || n > 80) return 'The target labor percent is between 5 and 80.'
  if (Math.round(n * 2) !== n * 2) return 'The target labor percent is in whole or half percents, like 30 or 27.5.'
  return null
}
