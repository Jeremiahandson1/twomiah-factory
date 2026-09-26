/**
 * lib/staff/hours.ts — hours worked, split for payroll. Pure and tested.
 *
 * Wisconsin (DWD 274) and federal law: time and a half for hours over 40 in
 * the WORKWEEK — the employer's fixed, recurring 7 consecutive days. No daily
 * overtime. So hours are totalled per person per workweek, in order, and
 * whatever passes 40 is overtime. A shift that runs past the workweek's
 * midnight boundary is split there. Pay periods are whole workweeks, so a
 * week's overtime never straddles two pay periods.
 *
 * We report hours and tips; the payroll service computes pay and taxes.
 */
import { addDays, localToUtc } from '../hours'

export interface PayrollConfig { weekStart: number; periodDays: 7 | 14; anchor: string }   // anchor: a date that starts a pay period
export const OVERTIME_AFTER_HOURS = 40

export function payrollConfig(raw: unknown): PayrollConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const weekStart = Number.isInteger(r.weekStart) && (r.weekStart as number) >= 0 && (r.weekStart as number) <= 6 ? (r.weekStart as number) : 1   // Monday
  const periodDays = r.periodDays === 14 ? 14 : 7
  const anchor = typeof r.anchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.anchor) && dayOfWeek(r.anchor) === weekStart ? r.anchor : workweekStart('2026-01-05', weekStart)
  return { weekStart, periodDays, anchor }
}

export function dayOfWeek(dateStr: string): number { return new Date(dateStr + 'T12:00:00Z').getUTCDay() }

/** The date (local) that starts the workweek containing dateStr. */
export function workweekStart(dateStr: string, weekStart: number): string {
  return addDays(dateStr, -((dayOfWeek(dateStr) - weekStart + 7) % 7))
}

const dayNumber = (d: string) => Math.round(new Date(d + 'T12:00:00Z').getTime() / 86400000)

/** The pay period containing dateStr: [start, end) as local dates. */
export function periodFor(dateStr: string, cfg: PayrollConfig): { start: string; end: string } {
  const diff = dayNumber(dateStr) - dayNumber(cfg.anchor)
  const start = addDays(cfg.anchor, Math.floor(diff / cfg.periodDays) * cfg.periodDays)
  return { start, end: addDays(start, cfg.periodDays) }
}

export interface Shift { id: string; pinId: string; startAt: Date; endAt: Date | null }
export interface PersonHours { pinId: string; regular: number; overtime: number; total: number; shifts: number; openShifts: number; weeks: Array<{ week: string; regular: number; overtime: number }> }

const r2 = (h: number) => Math.round(h * 100) / 100

/**
 * Hours in [start, end) (local dates, whole workweeks). Open shifts count up
 * to `now` and are flagged, so the owner sees them before exporting.
 */
export function summarizeHours(shifts: Shift[], tz: string, cfg: PayrollConfig, start: string, end: string, now: Date): PersonHours[] {
  const from = localToUtc(start, '00:00', tz).getTime(), to = localToUtc(end, '00:00', tz).getTime()
  // Workweek boundaries (UTC instants of local midnight) inside the period.
  const bounds: Array<{ key: string; at: number }> = []
  for (let d = workweekStart(start, cfg.weekStart); dayNumber(d) < dayNumber(end); d = addDays(d, 7)) bounds.push({ key: d, at: localToUtc(d, '00:00', tz).getTime() })
  const weekOf = (t: number) => { let k = bounds[0].key; for (const b of bounds) if (t >= b.at) k = b.key; return k }

  type Seg = { pinId: string; week: string; a: number; b: number }
  const segs: Seg[] = []
  const people = new Map<string, PersonHours>()
  const person = (pinId: string) => { let p = people.get(pinId); if (!p) { p = { pinId, regular: 0, overtime: 0, total: 0, shifts: 0, openShifts: 0, weeks: [] }; people.set(pinId, p) } return p }
  for (const s of shifts) {
    const a0 = s.startAt.getTime(), b0 = (s.endAt ? s.endAt.getTime() : now.getTime())
    let a = Math.max(a0, from); const b = Math.min(b0, to)
    if (b <= a) continue
    const p = person(s.pinId); p.shifts++; if (!s.endAt) p.openShifts++
    // Cut at every workweek boundary inside the shift.
    for (const bd of bounds) if (bd.at > a && bd.at < b) { segs.push({ pinId: s.pinId, week: weekOf(a), a, b: bd.at }); a = bd.at }
    segs.push({ pinId: s.pinId, week: weekOf(a), a, b })
  }
  segs.sort((x, y) => x.a - y.a)
  const running = new Map<string, number>()
  const weekTotals = new Map<string, { regular: number; overtime: number }>()
  for (const sg of segs) {
    const key = sg.pinId + '|' + sg.week
    const h = (sg.b - sg.a) / 3600000
    const before = running.get(key) || 0
    const reg = Math.max(0, Math.min(h, OVERTIME_AFTER_HOURS - before))
    running.set(key, before + h)
    const w = weekTotals.get(key) || { regular: 0, overtime: 0 }
    w.regular += reg; w.overtime += h - reg
    weekTotals.set(key, w)
  }
  for (const [key, w] of weekTotals) {
    const [pinId, week] = key.split('|')
    const p = person(pinId)
    p.weeks.push({ week, regular: r2(w.regular), overtime: r2(w.overtime) })
    p.regular += w.regular; p.overtime += w.overtime
  }
  return [...people.values()].map(p => ({ ...p, regular: r2(p.regular), overtime: r2(p.overtime), total: r2(p.regular + p.overtime), weeks: p.weeks.sort((a, b) => a.week.localeCompare(b.week)) }))
}

/** Estimated wages (before tax), cents: regular × rate + overtime × 1.5 × rate. null without a rate. */
export function estimatedWagesCents(p: { regular: number; overtime: number }, hourlyCents: number | null): number | null {
  if (hourlyCents === null || hourlyCents === undefined) return null
  return Math.round(p.regular * hourlyCents + p.overtime * hourlyCents * 1.5)
}

/** CSV for the payroll service: one row per person. */
export function payrollCsv(rows: Array<{ name: string; regular: number; overtime: number; total: number; cashTipsCents: number; cardTipsCents: number; hourlyCents: number | null }>, period: { start: string; end: string }): string {
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s }
  const d = (c: number) => (c / 100).toFixed(2)
  const lines = [['name', 'period_start', 'period_end', 'regular_hours', 'overtime_hours', 'total_hours', 'cash_tips', 'card_tips', 'hourly_rate'].join(',')]
  for (const r of rows) lines.push([q(r.name), period.start, addDays(period.end, -1), r.regular.toFixed(2), r.overtime.toFixed(2), r.total.toFixed(2), d(r.cashTipsCents), d(r.cardTipsCents), r.hourlyCents === null ? '' : d(r.hourlyCents)].join(','))
  return lines.join('\n') + '\n'
}
