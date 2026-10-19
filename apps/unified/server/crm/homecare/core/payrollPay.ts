// What payroll pays — ONE rule for every screen and export that turns shift reviews into pay: Payroll → Calculate, a
// caregiver's payroll approval, the Gusto preview and the Gusto hours CSV. Moved from
// templates/crm-homecare/backend/src/services/payrollPay.ts; its SQL is in server/data/homecarePayroll.ts.
//
//   · Hours: the PAYABLE minutes of payroll shift reviews whose shift date falls in the range and whose status is
//     verified, approved or manual_entry. A pending, flagged, missing-punch or excused review is not paid.
//   · Overtime (FLSA): payable hours over 40 in each SUNDAY–SATURDAY workweek, never over 40 in a two-week period. A
//     week that straddles the range counts only its days inside the range.
//   · Rates: the caregiver's caregiver_rates row in force on the range's last day ('base', and 'overtime' when one is
//     set), else user.default_pay_rate, else $15. Overtime with no overtime row is the base rate × 1.5.
//   · Money in whole cents: pay = round(minutes × rate-in-cents / 60), per caregiver.
//
// Change: the company's reviews, caregivers and rates only (companyId first).
import { payableReviewWeeks, caregiverPayRates, reviewCountWithStatus } from '../../../data/homecarePayroll.ts'
import type { CrmDeps } from '../../deps.ts'

export const PAYABLE_REVIEW_STATUSES = ['verified', 'approved', 'manual_entry'] as const
export const UNRESOLVED_REVIEW_STATUSES = ['pending', 'flagged', 'missing_punch'] as const
export const OT_WEEKLY_HOURS = 40
export const OT_MULTIPLIER = 1.5
export const FALLBACK_PAY_RATE = 15

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

export function createPayrollPay(d: CrmDeps) {
  /**
   * The pay for every caregiver of the company with payable reviews between `startDate` and `endDate` (inclusive,
   * YYYY-MM-DD), or one caregiver's. Sorted by last name, first name.
   */
  async function payrollForRange(companyId: string, startDate: string, endDate: string, opts: {
    caregiverId?: string | null; otThresholdHours?: number; otMultiplier?: number
  } = {}): Promise<PayrollLine[]> {
    const threshold = Number.isFinite(Number(opts.otThresholdHours)) && Number(opts.otThresholdHours) > 0 ? Number(opts.otThresholdHours) : OT_WEEKLY_HOURS
    const multiplier = Number.isFinite(Number(opts.otMultiplier)) && Number(opts.otMultiplier) >= 1 ? Number(opts.otMultiplier) : OT_MULTIPLIER
    const cg = opts.caregiverId || null

    const weeks = await payableReviewWeeks(d.db, companyId, startDate, endDate, PAYABLE_REVIEW_STATUSES, cg)
    if (!weeks.length) return []

    const ids = [...new Set(weeks.map((w) => String(w.caregiverId)))]
    const people = await caregiverPayRates(d.db, companyId, ids, endDate)
    const byId = new Map(people.map((p) => [String(p.id), p]))

    const lines: PayrollLine[] = ids.map((id) => {
      const p: any = byId.get(id) || {}
      const mine = weeks.filter((w) => String(w.caregiverId) === id)
      const split = splitOvertime(mine.map((w) => Number(w.minutes)), threshold)
      const baseRate = Number(p.baseRate ?? p.defaultPayRate ?? FALLBACK_PAY_RATE) || FALLBACK_PAY_RATE
      const baseCents = cents(baseRate)
      const otCents = p.overtimeRate != null && Number.isFinite(Number(p.overtimeRate)) ? cents(Number(p.overtimeRate)) : Math.round(baseCents * multiplier)
      const regularPayCents = payCents(split.regularMinutes, baseCents)
      const overtimePayCents = payCents(split.overtimeMinutes, otCents)
      return {
        caregiverId: id,
        firstName: p.firstName ?? null,
        lastName: p.lastName ?? null,
        email: p.email ?? null,
        shifts: mine.reduce((s, w) => s + Number(w.shifts), 0),
        totalHours: hours2(split.totalMinutes),
        regularHours: hours2(split.regularMinutes),
        overtimeHours: hours2(split.overtimeMinutes),
        weekendHours: hours2(mine.reduce((s, w) => s + Number(w.weekendMinutes), 0)),
        baseRate: baseCents / 100,
        otRate: otCents / 100,
        regularPay: regularPayCents / 100,
        overtimePay: overtimePayCents / 100,
        grossPay: (regularPayCents + overtimePayCents) / 100,
        weeks: mine.map((w) => {
          const s = splitOvertime([Number(w.minutes)], threshold)
          return { weekStart: String(w.weekStart), hours: hours2(s.totalMinutes), regularHours: hours2(s.regularMinutes), overtimeHours: hours2(s.overtimeMinutes) }
        }),
      }
    })
    return lines.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
  }

  /** Reviews in the range that still need a decision (pending, flagged, missing punch), optionally one caregiver's. */
  function unresolvedReviewCount(companyId: string, startDate: string, endDate: string, caregiverId: string | null = null): Promise<number> {
    return reviewCountWithStatus(d.db, companyId, startDate, endDate, UNRESOLVED_REVIEW_STATUSES, caregiverId)
  }

  return { payrollForRange, unresolvedReviewCount }
}

export type PayrollPay = ReturnType<typeof createPayrollPay>
