// Which visits a care task belongs to (row 5, docs/parity/homecare-required-tasks-repeats.md).
//
// A task has "days of the week" (free text the office types: "Mon,Wed,Fri", "Tuesdays", "Mon-Fri", "weekends", "Daily") and a "time
// of day" (AM / PM / any). Until now both were only labels: a task meant for Tuesdays held every visit. With the agency's
// care_required_tasks feature on they are READ: a Tuesday task belongs only to visits on a Tuesday, an AM task only to a visit that
// starts before noon, a PM task only to a visit that is still going (or starts) at or after noon. Days are the visit's own
// date on the AGENCY's clock (companyTimeZone), never the server's.
//
// Pure — no database — so the screens, the clock-out gate and the report all use one rule.
import { hmsIn, ymdIn } from './agencyTime.ts'

const NAMES: Record<string, number> = {
  sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6,
}
const EVERY = new Set(['', 'daily', 'everyday', 'every day', 'all', 'any', 'anyday', 'any day', 'all days', 'alldays', 'each day', 'every'])
export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface TaskDays { ok: boolean; /** weekday numbers 0 (Sunday) to 6, sorted; null = every day */ days: number[] | null }

/**
 * Read the days a task is for. `ok` is false when the text is something we cannot read ("whenever"): the task then behaves as it
 * always did (every day), and the screens say so rather than guess. "Mon-Fri" is a range, "weekdays" is Monday to Friday and
 * "weekends" Saturday and Sunday; commas, slashes, "and" and spaces separate days.
 */
export function parseTaskDays(text: unknown): TaskDays {
  const raw = String(text ?? '').trim().toLowerCase().replace(/\./g, '')
  if (EVERY.has(raw)) return { ok: true, days: null }
  const days = new Set<number>()
  let ok = true
  const parts = raw.split(/[,/;&+]|\band\b/).map((p) => p.trim()).filter(Boolean)
  for (const part of parts) {
    if (part === 'weekdays' || part === 'weekday') { for (let i = 1; i <= 5; i++) days.add(i); continue }
    if (part === 'weekends' || part === 'weekend') { days.add(0); days.add(6); continue }
    if (part in NAMES) { days.add(NAMES[part]); continue }
    const range = part.match(/^([a-z]+)\s*(?:-|to|through|thru)\s*([a-z]+)$/)
    if (range && range[1] in NAMES && range[2] in NAMES) {
      const from = NAMES[range[1]], to = NAMES[range[2]]
      for (let i = from; ; i = (i + 1) % 7) { days.add(i); if (i === to) break }
      continue
    }
    // "Mon Wed Fri" typed with spaces only
    const words = part.split(/\s+/)
    if (words.length > 1 && words.every((w) => w in NAMES)) { for (const w of words) days.add(NAMES[w]); continue }
    ok = false
  }
  if (!ok || !days.size) return { ok: false, days: null }
  return { ok: true, days: days.size === 7 ? null : [...days].sort((a, b) => a - b) }
}

/** "Tuesday", "Monday, Wednesday and Friday", "every day". */
export function describeDays(days: number[] | null): string {
  if (!days) return 'every day'
  const n = days.map((d) => DAY_LABELS[d])
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

export interface VisitWhen {
  /** weekday of the visit's start on the agency's calendar, 0 = Sunday */
  dow: number
  /** minutes after midnight the visit started / is ending (or ended) on the agency's clock */
  startMin: number
  endMin: number
  /** the visit ran past midnight */
  spansDays: boolean
}

const minutes = (hms: string) => Number(hms.slice(0, 2)) * 60 + Number(hms.slice(3, 5))

/** When a visit happens, on the agency's clock. `end` is the clock-out (or now, for a visit still open). */
export function visitWhen(start: Date, end: Date | null | undefined, tz: string): VisitWhen {
  const s = new Date(start)
  const e = end ? new Date(end) : new Date()
  const day = ymdIn(s, tz)
  const [y, m, d] = day.split('-').map(Number)
  return {
    dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
    startMin: minutes(hmsIn(s, tz)),
    endMin: minutes(hmsIn(e, tz)),
    spansDays: ymdIn(e, tz) > day,
  }
}

/** Does this task belong to a visit at this time? A task whose days we cannot read belongs to every visit (as it always did). */
export function taskBelongsTo(task: { daysOfWeek?: string | null; timeOfDay?: string | null }, when: VisitWhen): boolean {
  const { days } = parseTaskDays(task.daysOfWeek)
  if (days && !days.includes(when.dow)) return false
  const t = String(task.timeOfDay || 'any').toUpperCase()
  if (t === 'AM') return when.startMin < 12 * 60
  if (t === 'PM') return when.startMin >= 12 * 60 || when.endMin >= 12 * 60 || when.spansDays
  return true
}
