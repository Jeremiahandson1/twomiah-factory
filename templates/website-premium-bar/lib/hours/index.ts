/**
 * lib/hours — the hours engine. Every consumer (Tonight Board, /api/live,
 * JSON-LD, the voice agent, the console) reads from here. Nothing else in
 * the codebase may decide "is the kitchen open" on its own.
 *
 * Model:
 *   - Two DEPARTMENTS, 'bar' and 'kitchen', each with its own weekly hours.
 *     They differ by hours every day; the site must never conflate them.
 *   - A day's hours are 0..n ranges of local wall-clock times. A range whose
 *     close <= open crosses midnight (bar 11:00–02:00 = closes 2 AM next day).
 *   - HOLIDAY overrides by date (closed, or different hours) per department.
 *   - GAME-DAY overrides, same shape, supplied by the caller (from `games`).
 *   - MANUAL overrides from the console ("kitchen closed", "closing early at
 *     11"), which carry their own expiry so a Friday-night tap can't leave
 *     the board wrong on Saturday morning.
 *   - All math is done in the tenant timezone (America/Chicago by default)
 *     with correct DST handling and NO date library — Intl only.
 */

export type Department = 'bar' | 'kitchen'
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** 'HH:MM' 24h local wall-clock. */
export interface TimeRange { open: string; close: string }
export type WeeklyHours = Partial<Record<DayKey, TimeRange[]>>

export interface DateOverride {
  /** YYYY-MM-DD in the tenant timezone. */
  date: string
  label?: string
  /** null = closed that day; omitted = regular hours; [] also = closed. */
  bar?: TimeRange[] | null
  kitchen?: TimeRange[] | null
}

export interface HoursConfig {
  timezone?: string
  bar: WeeklyHours
  kitchen: WeeklyHours
  holidays?: DateOverride[]
}

export interface ManualOverride {
  /** Force closed until `until` (or until the next scheduled open if absent). */
  closed?: boolean
  /** Close earlier (or later) than scheduled — ISO instant. */
  closesAt?: string | Date | null
  /** Overrides are ignored once this instant passes. */
  until?: string | Date | null
  note?: string | null
}

export interface EvaluationInput {
  now?: Date
  /** Game-day (or any one-off) overrides to layer above holidays. */
  gameDays?: DateOverride[]
  manual?: Partial<Record<Department, ManualOverride | null | undefined>>
}

export type StatusSource = 'regular' | 'holiday' | 'game' | 'manual'

export interface DepartmentStatus {
  department: Department
  isOpen: boolean
  /** When the current open period ends (if open). */
  closesAt: Date | null
  /** When the next open period starts (if closed). */
  opensAt: Date | null
  /** Milliseconds until closesAt / opensAt. */
  msUntilChange: number | null
  source: StatusSource
  label: string | null
  note: string | null
  /** The ranges that applied to "today" (tenant-local), after overrides. */
  today: TimeRange[]
}

export interface HoursStatus {
  now: Date
  timezone: string
  localDate: string
  bar: DepartmentStatus
  kitchen: DepartmentStatus
}

// ── Timezone primitives (Intl only) ──────────────────────────────────────

const DTF_CACHE = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string): Intl.DateTimeFormat {
  let f = DTF_CACHE.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    })
    DTF_CACHE.set(tz, f)
  }
  return f
}

export interface LocalParts { y: number; m: number; d: number; h: number; mi: number; s: number; dow: number }

export function localParts(date: Date, tz: string): LocalParts {
  const parts = dtf(tz).formatToParts(date)
  const get = (t: string) => parts.find(p => p.type === t)?.value || '0'
  const wd = get('weekday').toLowerCase().slice(0, 3)
  return {
    y: Number(get('year')), m: Number(get('month')), d: Number(get('day')),
    h: Number(get('hour')) % 24, mi: Number(get('minute')), s: Number(get('second')),
    dow: Math.max(0, DAY_KEYS.indexOf(wd as DayKey)),
  }
}

/** Offset of `tz` from UTC at `date`, in ms (CDT = -5h → -18000000). */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant for a local wall-clock date + time in `tz`. Handles DST gaps/overlaps. */
export function localToUtc(dateStr: string, time: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let off = tzOffsetMs(new Date(guess), tz)
  let utc = guess - off
  const off2 = tzOffsetMs(new Date(utc), tz)
  if (off2 !== off) utc = guess - off2
  return new Date(utc)
}

export function localDateString(date: Date, tz: string): string {
  const p = localParts(date, tz)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** Add whole days to a YYYY-MM-DD string (calendar arithmetic, tz-independent). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + days * 86400000
  const n = new Date(t)
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`
}

export function dayKeyOf(dateStr: string): DayKey {
  const [y, m, d] = dateStr.split('-').map(Number)
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// ── Resolution ───────────────────────────────────────────────────────────

interface Resolved { ranges: TimeRange[]; source: StatusSource; label: string | null }

/** The ranges that apply to a given local date for a department, honoring overrides. */
export function rangesFor(config: HoursConfig, dept: Department, dateStr: string, gameDays?: DateOverride[]): Resolved {
  const game = (gameDays || []).find(g => g.date === dateStr)
  if (game && dept in game) return { ranges: norm(game[dept]), source: 'game', label: game.label || null }
  const hol = (config.holidays || []).find(h => h.date === dateStr)
  if (hol && dept in hol) return { ranges: norm(hol[dept]), source: 'holiday', label: hol.label || null }
  return { ranges: norm(config[dept]?.[dayKeyOf(dateStr)]), source: 'regular', label: null }
}

function norm(r: TimeRange[] | null | undefined): TimeRange[] {
  if (!Array.isArray(r)) return []
  return r.filter(x => x && /^\d{1,2}:\d{2}$/.test(x.open) && /^\d{1,2}:\d{2}$/.test(x.close))
}

interface Period { start: Date; end: Date; source: StatusSource; label: string | null }

/** Concrete open periods (instants) seeded on a local date, midnight-crossing aware. */
function periodsOn(config: HoursConfig, dept: Department, dateStr: string, tz: string, gameDays?: DateOverride[]): Period[] {
  const r = rangesFor(config, dept, dateStr, gameDays)
  return r.ranges.map(({ open, close }) => {
    const start = localToUtc(dateStr, open, tz)
    let end = localToUtc(dateStr, close, tz)
    if (end.getTime() <= start.getTime()) end = localToUtc(addDays(dateStr, 1), close, tz)
    return { start, end, source: r.source, label: r.label }
  })
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function evaluateDepartment(config: HoursConfig, dept: Department, now: Date, tz: string, input: EvaluationInput): DepartmentStatus {
  const today = localDateString(now, tz)
  // Yesterday's periods can run past midnight into today; look back one day
  // and forward up to 8 days for the next opening.
  const candidates: Period[] = []
  for (let i = -1; i <= 8; i++) candidates.push(...periodsOn(config, dept, addDays(today, i), tz, input.gameDays))
  candidates.sort((a, b) => a.start.getTime() - b.start.getTime())

  const t = now.getTime()
  let current = candidates.find(p => p.start.getTime() <= t && t < p.end.getTime()) || null
  let next = candidates.find(p => p.start.getTime() > t) || null
  const todayRes = rangesFor(config, dept, today, input.gameDays)
  const todayRanges = todayRes.ranges

  // Attribution: an open period owns its source. When closed, a dated
  // override that closed TODAY (holiday / game day) is the reason, and is
  // reported as such; otherwise the next period's source.
  let source: StatusSource = current ? current.source : (todayRes.source !== 'regular' ? todayRes.source : (next ? next.source : 'regular'))
  let label = current ? current.label : (todayRes.source !== 'regular' ? todayRes.label : (next ? next.label : null))
  let note: string | null = null

  // Manual override from the console, only while it is still in force.
  const manual = input.manual?.[dept]
  const until = toDate(manual?.until)
  const manualActive = !!manual && (!until || until.getTime() > t)
  if (manualActive && manual) {
    note = manual.note || null
    if (manual.closed) {
      source = 'manual'
      // Closed until the override lapses or the next scheduled period after that.
      const resumeAt = until || (current ? current.end : (next ? next.start : null))
      const nextAfter = resumeAt ? candidates.find(p => p.end.getTime() > resumeAt.getTime() && p.start.getTime() > t) || null : next
      const opensAt = nextAfter ? (until && until.getTime() > nextAfter.start.getTime() ? until : nextAfter.start) : (until || null)
      return { department: dept, isOpen: false, closesAt: null, opensAt, msUntilChange: opensAt ? opensAt.getTime() - t : null, source, label, note, today: todayRanges }
    }
    const closesAt = toDate(manual.closesAt)
    if (closesAt && current) {
      source = 'manual'
      if (closesAt.getTime() <= t) {
        // Already past the early close: closed until next period.
        return { department: dept, isOpen: false, closesAt: null, opensAt: next ? next.start : null, msUntilChange: next ? next.start.getTime() - t : null, source, label, note, today: todayRanges }
      }
      current = { ...current, end: closesAt }
    }
  }

  if (current) {
    return { department: dept, isOpen: true, closesAt: current.end, opensAt: null, msUntilChange: current.end.getTime() - t, source, label, note, today: todayRanges }
  }
  return { department: dept, isOpen: false, closesAt: null, opensAt: next ? next.start : null, msUntilChange: next ? next.start.getTime() - t : null, source, label, note, today: todayRanges }
}

export function evaluate(config: HoursConfig, input: EvaluationInput = {}): HoursStatus {
  const now = input.now || new Date()
  const tz = config.timezone || 'America/Chicago'
  return {
    now, timezone: tz, localDate: localDateString(now, tz),
    bar: evaluateDepartment(config, 'bar', now, tz, input),
    kitchen: evaluateDepartment(config, 'kitchen', now, tz, input),
  }
}

// ── Formatting ───────────────────────────────────────────────────────────

/** "9:00 PM" / "2:00 AM" in the tenant timezone. */
export function formatTime(date: Date, tz: string): string {
  const p = localParts(date, tz)
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  const ampm = p.h < 12 ? 'AM' : 'PM'
  return p.mi === 0 ? `${h12} ${ampm}` : `${h12}:${String(p.mi).padStart(2, '0')} ${ampm}`
}

/** "2h 14m", "45m", "under a minute". */
export function formatCountdown(ms: number): string {
  if (ms < 60000) return 'under a minute'
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60), m = mins % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "11 AM – 2 AM" for a range on a date. */
export function formatRange(r: TimeRange): string {
  const f = (t: string) => {
    const [h, mi] = t.split(':').map(Number)
    const h12 = h % 12 === 0 ? 12 : h % 12
    const ap = h < 12 ? 'AM' : 'PM'
    return mi === 0 ? `${h12} ${ap}` : `${h12}:${String(mi).padStart(2, '0')} ${ap}`
  }
  return `${f(r.open)} – ${f(r.close)}`
}

/** Day-name label for a date relative to now: "today" | "tomorrow" | "Friday". */
export function relativeDayLabel(date: Date, now: Date, tz: string): string {
  const a = localDateString(date, tz), b = localDateString(now, tz)
  if (a === b) return 'today'
  if (a === addDays(b, 1)) return 'tomorrow'
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return names[localParts(date, tz).dow]
}

/** One human line per department, the way the board and the phone agent say it. */
export function describe(status: DepartmentStatus, now: Date, tz: string, noun: string = status.department): string {
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1)
  if (status.isOpen && status.closesAt) {
    return `${cap} open — closes ${formatTime(status.closesAt, tz)} (${formatCountdown(status.closesAt.getTime() - now.getTime())})`
  }
  if (status.opensAt) {
    return `${cap} closed — opens ${relativeDayLabel(status.opensAt, now, tz)} at ${formatTime(status.opensAt, tz)}`
  }
  return `${cap} closed`
}

// ── Schema.org ───────────────────────────────────────────────────────────

const SCHEMA_DAYS: Record<DayKey, string> = {
  sun: 'https://schema.org/Sunday', mon: 'https://schema.org/Monday', tue: 'https://schema.org/Tuesday',
  wed: 'https://schema.org/Wednesday', thu: 'https://schema.org/Thursday', fri: 'https://schema.org/Friday', sat: 'https://schema.org/Saturday',
}

/** OpeningHoursSpecification[] for one department — identical days are grouped. */
export function openingHoursSpecification(weekly: WeeklyHours): object[] {
  const groups = new Map<string, { days: DayKey[]; range: TimeRange }>()
  for (const day of DAY_KEYS) {
    for (const r of norm(weekly[day])) {
      const key = r.open + '|' + r.close
      const g = groups.get(key) || { days: [], range: r }
      g.days.push(day)
      groups.set(key, g)
    }
  }
  const out: object[] = []
  for (const g of groups.values()) {
    out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: g.days.map(d => SCHEMA_DAYS[d]), opens: pad(g.range.open), closes: pad(g.range.close) })
  }
  // Closed days are stated explicitly so Google does not assume "unknown".
  const closed = DAY_KEYS.filter(d => norm(weekly[d]).length === 0)
  if (closed.length) out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: closed.map(d => SCHEMA_DAYS[d]), opens: '00:00', closes: '00:00' })
  return out
}

/** specialOpeningHoursSpecification[] for dated overrides (holidays + game days). */
export function specialOpeningHours(overrides: DateOverride[], dept: Department): object[] {
  return overrides.filter(o => dept in o).map(o => {
    const ranges = norm(o[dept])
    if (ranges.length === 0) return { '@type': 'OpeningHoursSpecification', validFrom: o.date, validThrough: o.date, opens: '00:00', closes: '00:00' }
    return { '@type': 'OpeningHoursSpecification', validFrom: o.date, validThrough: o.date, opens: pad(ranges[0].open), closes: pad(ranges[ranges.length - 1].close) }
  })
}

function pad(t: string): string {
  const [h, m] = t.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/** Type guard for a config coming out of a jsonb column. */
export function isHoursConfig(v: unknown): v is HoursConfig {
  return !!v && typeof v === 'object' && 'bar' in (v as any) && 'kitchen' in (v as any)
}

export const EMPTY_HOURS: HoursConfig = { timezone: 'America/Chicago', bar: {}, kitchen: {}, holidays: [] }
