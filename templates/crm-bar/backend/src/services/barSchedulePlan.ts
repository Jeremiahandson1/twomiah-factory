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
import { addDays, localToUtc, rangesFor, type HoursConfig } from './barHours.ts'

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
