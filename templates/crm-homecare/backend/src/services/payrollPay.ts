// What payroll pays — ONE rule for every screen and export that turns shift reviews into pay:
// Payroll → Calculate, a caregiver's payroll approval, the Gusto preview and the Gusto hours CSV.
//
//   · Hours: the PAYABLE minutes of payroll shift reviews (Payroll → Shift Reviews) whose shift date
//     falls in the range and whose status is verified, approved or manual_entry. A pending, flagged,
//     missing-punch or excused review is not paid.
//   · Overtime (FLSA): payable hours over 40 in each SUNDAY–SATURDAY workweek, never over 40 in a
//     two-week period. A week that straddles the range counts only its days inside the range.
//   · Rates: the caregiver's caregiver_rates row in force on the range's last day ('base', and
//     'overtime' when one is set), else users.default_pay_rate, else $15. Overtime with no overtime
//     row is the base rate × 1.5.
//   · Money in whole cents: pay = round(minutes × rate-in-cents / 60), per caregiver.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'

export const PAYABLE_REVIEW_STATUSES = ['verified', 'approved', 'manual_entry'] as const
export const UNRESOLVED_REVIEW_STATUSES = ['pending', 'flagged', 'missing_punch'] as const
export const OT_WEEKLY_HOURS = 40
export const OT_MULTIPLIER = 1.5
export const FALLBACK_PAY_RATE = 15

const rowsOf = (r: any) => (r?.rows ?? r ?? []) as any[]
const payableList = sql.raw(PAYABLE_REVIEW_STATUSES.map((s) => `'${s}'`).join(', '))
const unresolvedList = sql.raw(UNRESOLVED_REVIEW_STATUSES.map((s) => `'${s}'`).join(', '))

/** The Sunday that starts the Sun–Sat workweek holding `ymd` (both YYYY-MM-DD). */
export function workweekStart(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

/** Regular and overtime minutes for a caregiver's weeks: each week's minutes over the threshold are overtime. */
export function splitOvertime(weekMinutes: number[], thresholdHours = OT_WEEKLY_HOURS) {
  const cap = Math.round(thresholdHours * 60)
  let regularMinutes = 0, overtimeMinutes = 0
  for (const m of weekMinutes) {
    const n = Math.max(0, Math.round(Number(m) || 0))
    regularMinutes += Math.min(n, cap)
    overtimeMinutes += Math.max(n - cap, 0)
  }
  return { totalMinutes: regularMinutes + overtimeMinutes, regularMinutes, overtimeMinutes }
}

const cents = (dollars: number) => Math.round(dollars * 100)
const hours2 = (minutes: number) => Math.round((minutes / 60) * 100) / 100
/** Pay for minutes at a rate, in whole cents. */
export const payCents = (minutes: number, rateCents: number) => Math.round((minutes * rateCents) / 60)

export interface PayrollLine {
  caregiverId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  shifts: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  weekendHours: number
  baseRate: number
  otRate: number
  regularPay: number
  overtimePay: number
  grossPay: number
  weeks: { weekStart: string; hours: number; regularHours: number; overtimeHours: number }[]
}

/**
 * The pay for every caregiver with payable reviews between `startDate` and `endDate` (inclusive,
 * YYYY-MM-DD), or one caregiver's. Sorted by last name, first name.
 */
export async function payrollForRange(startDate: string, endDate: string, opts: {
  caregiverId?: string | null; otThresholdHours?: number; otMultiplier?: number
} = {}): Promise<PayrollLine[]> {
  const threshold = Number.isFinite(Number(opts.otThresholdHours)) && Number(opts.otThresholdHours) > 0 ? Number(opts.otThresholdHours) : OT_WEEKLY_HOURS
  const multiplier = Number.isFinite(Number(opts.otMultiplier)) && Number(opts.otMultiplier) >= 1 ? Number(opts.otMultiplier) : OT_MULTIPLIER
  const cg = opts.caregiverId || null

  const weeks = rowsOf(await db.execute(sql`
    SELECT psr.caregiver_id,
           to_char(psr.shift_date - EXTRACT(DOW FROM psr.shift_date)::int, 'YYYY-MM-DD') AS week_start,
           SUM(psr.payable_minutes)::int AS minutes,
           COALESCE(SUM(psr.payable_minutes) FILTER (WHERE EXTRACT(DOW FROM psr.shift_date) IN (0, 6)), 0)::int AS weekend_minutes,
           COUNT(*)::int AS shifts
      FROM payroll_shift_reviews psr
     WHERE psr.shift_date BETWEEN ${startDate}::date AND ${endDate}::date
       AND psr.status IN (${payableList})
       AND psr.payable_minutes > 0
       AND (${cg}::text IS NULL OR psr.caregiver_id = ${cg})
     GROUP BY 1, 2
     ORDER BY 1, 2`))
  if (!weeks.length) return []

  const ids = [...new Set(weeks.map((w) => String(w.caregiver_id)))]
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `)
  const people = rowsOf(await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.email, u.default_pay_rate,
           (SELECT r.hourly_rate FROM caregiver_rates r WHERE r.caregiver_id = u.id AND r.rate_type = 'base'
               AND r.effective_date <= ${endDate}::date AND (r.end_date IS NULL OR r.end_date >= ${endDate}::date)
             ORDER BY r.effective_date DESC LIMIT 1) AS base_rate,
           (SELECT r.hourly_rate FROM caregiver_rates r WHERE r.caregiver_id = u.id AND r.rate_type = 'overtime'
               AND r.effective_date <= ${endDate}::date AND (r.end_date IS NULL OR r.end_date >= ${endDate}::date)
             ORDER BY r.effective_date DESC LIMIT 1) AS overtime_rate
      FROM users u WHERE u.id IN (${idList})`))
  const byId = new Map(people.map((p) => [String(p.id), p]))

  const lines: PayrollLine[] = ids.map((id) => {
    const p: any = byId.get(id) || {}
    const mine = weeks.filter((w) => String(w.caregiver_id) === id)
    const split = splitOvertime(mine.map((w) => Number(w.minutes)), threshold)
    const baseRate = Number(p.base_rate ?? p.default_pay_rate ?? FALLBACK_PAY_RATE) || FALLBACK_PAY_RATE
    const baseCents = cents(baseRate)
    const otCents = p.overtime_rate != null && Number.isFinite(Number(p.overtime_rate)) ? cents(Number(p.overtime_rate)) : Math.round(baseCents * multiplier)
    const regularPayCents = payCents(split.regularMinutes, baseCents)
    const overtimePayCents = payCents(split.overtimeMinutes, otCents)
    return {
      caregiverId: id,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      email: p.email ?? null,
      shifts: mine.reduce((s, w) => s + Number(w.shifts), 0),
      totalHours: hours2(split.totalMinutes),
      regularHours: hours2(split.regularMinutes),
      overtimeHours: hours2(split.overtimeMinutes),
      weekendHours: hours2(mine.reduce((s, w) => s + Number(w.weekend_minutes), 0)),
      baseRate: baseCents / 100,
      otRate: otCents / 100,
      regularPay: regularPayCents / 100,
      overtimePay: overtimePayCents / 100,
      grossPay: (regularPayCents + overtimePayCents) / 100,
      weeks: mine.map((w) => {
        const s = splitOvertime([Number(w.minutes)], threshold)
        return { weekStart: String(w.week_start), hours: hours2(s.totalMinutes), regularHours: hours2(s.regularMinutes), overtimeHours: hours2(s.overtimeMinutes) }
      }),
    }
  })
  return lines.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
}

/** Reviews in the range that still need a decision (pending, flagged, missing punch), optionally one caregiver's. */
export async function unresolvedReviewCount(startDate: string, endDate: string, caregiverId: string | null = null): Promise<number> {
  const r = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM payroll_shift_reviews
    WHERE shift_date BETWEEN ${startDate}::date AND ${endDate}::date AND status IN (${unresolvedList})
      AND (${caregiverId}::text IS NULL OR caregiver_id = ${caregiverId})`))
  return Number(r[0]?.n) || 0
}
