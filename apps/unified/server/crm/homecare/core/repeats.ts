// Home care depth, item 12: shifts that repeat monthly or every N weeks (docs/parity/homecare-required-tasks-repeats.md).
//
// A repeating shift is still ONE row in `schedules` with a weekday (day_of_week) and an anchor_date. What changes is
// `frequency`, which was 'weekly' or 'biweekly':
//   'weekly'         every week                              (unchanged)
//   'biweekly'       every other week                        (unchanged — also what "every 2 weeks" is stored as)
//   'every_N_weeks'  every N weeks, 3..12, from the anchor   (new, e.g. 'every_3_weeks')
//   'monthly'        the same weekday-of-the-month as the anchor: anchored on a 2nd Tuesday means every 2nd Tuesday;
//                    anchored on a 5th Friday means the LAST Friday of every month (new)
//
// The occurrence engine (data/homecareCore.ts occurrencesCte) is the one place that expands them for payroll, billing,
// the calendar and the phone; web/src/crm/pages/homecare/lib/repeats.ts mirrors the rule for the screens. Pure.
import { addDays, dayDiff, dowOf, toYMD, alignBiweeklyAnchor } from './biweekly.ts'

export const MAX_EVERY_N_WEEKS = 12

export type Repeat =
  | { kind: 'weekly' }
  | { kind: 'every_n'; n: number }   // n >= 2 (2 is stored as 'biweekly')
  | { kind: 'monthly' }

/** The repeat a stored `frequency` means. Anything unknown is weekly (what the engine does for it too). */
export function parseFrequency(frequency: unknown): Repeat {
  const f = String(frequency ?? 'weekly').trim().toLowerCase()
  if (f === 'biweekly' || f === 'bi-weekly') return { kind: 'every_n', n: 2 }
  if (f === 'monthly') return { kind: 'monthly' }
  const m = f.match(/^every_(\d{1,2})_weeks$/)
  if (m) {
    const n = Number(m[1])
    if (n >= 2 && n <= MAX_EVERY_N_WEEKS) return { kind: 'every_n', n }
  }
  return { kind: 'weekly' }
}

/** True for the two repeats added by item 12 (the ones that are held back until the agency has the feature). */
export function isNewRepeat(frequency: unknown): boolean {
  const f = String(frequency ?? '').trim().toLowerCase()
  return f === 'monthly' || /^every_\d{1,2}_weeks$/.test(f)
}

/**
 * The `frequency` to store for "every N weeks": 1 → 'weekly', 2 → 'biweekly' (so all the old code keeps working),
 * 3..12 → 'every_N_weeks'. null when N is not a whole number from 1 to 12.
 */
export function everyNWeeks(n: unknown): string | null {
  const k = Number(n)
  if (!Number.isInteger(k) || k < 1 || k > MAX_EVERY_N_WEEKS) return null
  return k === 1 ? 'weekly' : k === 2 ? 'biweekly' : `every_${k}_weeks`
}

/** Is a stored frequency one we can run? (the create / edit routes refuse anything else rather than run it as weekly) */
export function isKnownFrequency(frequency: unknown): boolean {
  const f = String(frequency ?? '').trim().toLowerCase()
  if (f === 'weekly' || f === 'biweekly' || f === 'bi-weekly' || f === 'monthly') return true
  const m = f.match(/^every_(\d{1,2})_weeks$/)
  return !!m && Number(m[1]) >= 3 && Number(m[1]) <= MAX_EVERY_N_WEEKS
}

/** Which weekday of the month a date is: 1..5 (the 5th is "the last one" for a pattern anchored on it). */
export function weekdayOrdinal(ymd: string): number {
  return Math.ceil(Number(ymd.slice(8, 10)) / 7)
}

function daysInMonth(ymd: string): number {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate()
}

/** Does a repeating pattern happen on this date? (weekday, effective / end dates and exceptions are checked elsewhere.) */
export function isRepeatOn(date: unknown, frequency: unknown, anchor: unknown): boolean {
  const day = toYMD(date)
  const a = toYMD(anchor)
  if (!day) return false
  const r = parseFrequency(frequency)
  if (r.kind === 'weekly' || !a) return true
  if (r.kind === 'every_n') {
    const weeks = Math.floor(dayDiff(a, day) / 7)
    return ((weeks % r.n) + r.n) % r.n === 0
  }
  const want = weekdayOrdinal(a)
  const dayOfMonth = Number(day.slice(8, 10))
  if (weekdayOrdinal(day) === want) return true
  return want === 5 && dayOfMonth + 7 > daysInMonth(day)
}

/**
 * The anchor to store for a repeating row: the first date on/after max(anchor, effective date) that falls on the
 * row's weekday. 'biweekly' keeps its own rule (core/biweekly.ts, which also protects an edited row's fortnight).
 */
export function alignRepeatAnchor({ frequency, anchorDate, effectiveDate, dayOfWeek, previous }: {
  frequency?: unknown; anchorDate?: unknown; effectiveDate?: unknown; dayOfWeek?: unknown
  previous?: { anchorDate?: unknown; dayOfWeek?: unknown } | null
}): string | null {
  const r = parseFrequency(frequency)
  if (r.kind === 'weekly') return toYMD(anchorDate)
  if (String(frequency).toLowerCase().replace('-', '') === 'biweekly') {
    return alignBiweeklyAnchor({ anchorDate, effectiveDate, dayOfWeek, previous })
  }
  const dow = Number(dayOfWeek)
  if (dayOfWeek === null || dayOfWeek === undefined || !Number.isInteger(dow) || dow < 0 || dow > 6) return toYMD(anchorDate)
  const base = [toYMD(anchorDate), toYMD(effectiveDate)].filter(Boolean).sort().pop()
  if (!base) return null
  return addDays(base, (dow - dowOf(base) + 7) % 7)
}

/** Plain-English label for a screen or a message: "every 3 weeks", "monthly (2nd Tuesday)". */
export function describeRepeat(frequency: unknown, dayOfWeek?: unknown, anchor?: unknown): string {
  const r = parseFrequency(frequency)
  if (r.kind === 'weekly') return 'every week'
  if (r.kind === 'every_n') return r.n === 2 ? 'every other week' : `every ${r.n} weeks`
  const a = toYMD(anchor)
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const ord = a ? weekdayOrdinal(a) : null
  const nth = ord === 5 ? 'last' : ord === 1 ? '1st' : ord === 2 ? '2nd' : ord === 3 ? '3rd' : ord === 4 ? '4th' : null
  const dow = Number.isInteger(Number(dayOfWeek)) && dayOfWeek !== null && dayOfWeek !== undefined ? names[Number(dayOfWeek)] : null
  return nth && dow ? `monthly (${nth} ${dow})` : 'monthly'
}
