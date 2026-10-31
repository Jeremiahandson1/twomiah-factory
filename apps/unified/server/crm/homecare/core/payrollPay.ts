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
import { payableVisits, type PayableVisit } from '../../../data/homecarePayRules.ts'
import { pickupsInRange } from '../../../data/homecareRewards.ts'
import type { CrmDeps } from '../../deps.ts'
import { OT_WEEKLY_HOURS as WEEKLY_CAP, workweekStartOn, companyWorkWeek } from '../../payrollExport/workWeek.ts'
import { addDays } from './agencyTime.ts'
import { OVERTIME_RULES, buildSegments, classifyWeek, createPayRules, type PayRules } from './payRules.ts'

export const PAYABLE_REVIEW_STATUSES = ['verified', 'approved', 'manual_entry'] as const
export const UNRESOLVED_REVIEW_STATUSES = ['pending', 'flagged', 'missing_punch'] as const
export const OT_WEEKLY_HOURS = WEEKLY_CAP
export const OT_MULTIPLIER = 1.5
export const FALLBACK_PAY_RATE = 15

/** The day that starts the workweek holding `ymd` (both YYYY-MM-DD): a Sunday unless the company sets another start day. */
export const workweekStart = (ymd: string, startDay = 0): string => workweekStartOn(ymd, startDay)

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
  /** Item 2 (care_payroll_rules): double time and paid travel. Zero for an agency without it; travel hours are already inside the hours above. */
  doubleTimeHours: number
  doubleTimePay: number
  travelHours: number
  /** care_pickup_rewards: the open-shift pickup bonuses of worked visits in the range, already inside grossPay (zero without the feature). */
  bonusPay?: number
  bonusShifts?: number
  baseRate: number
  otRate: number
  regularPay: number
  overtimePay: number
  grossPay: number
  weeks: { weekStart: string; hours: number; regularHours: number; overtimeHours: number; doubleTimeHours?: number }[]
}

export function createPayrollPay(d: CrmDeps) {
  const payRules = createPayRules(d)

  /**
   * The pay run under the agency's own overtime rule and travel pay (item 2). Visits are read for whole work weeks so a daily or
   * 7th-day rule sees the days either side of the range; only the days inside the range are paid.
   */
  async function payrollWithRules(companyId: string, startDate: string, endDate: string, rules: PayRules, startDay: number, cg: string | null, multiplier: number, threshold: number): Promise<PayrollLine[]> {
    const rule = OVERTIME_RULES[rules.overtimeRule]
    const wkStart = workweekStartOn(startDate, startDay)
    const wkEnd = addDays(workweekStartOn(endDate, startDay), 6)
    const visits = await payableVisits(d.db, companyId, wkStart, wkEnd, PAYABLE_REVIEW_STATUSES, cg)
    if (!visits.length) return []
    const inRange = (date: string) => date >= startDate && date <= endDate
    const ids = [...new Set(visits.map((v) => v.caregiverId))]
    const people = await caregiverPayRates(d.db, companyId, ids, endDate)
    const byId = new Map(people.map((p) => [String(p.id), p]))

    const lines: PayrollLine[] = []
    for (const id of ids) {
      const mine = visits.filter((v) => v.caregiverId === id)
      const byWeek = new Map<string, PayableVisit[]>()
      for (const v of mine) { const w = workweekStartOn(v.shiftDate, startDay); byWeek.set(w, [...(byWeek.get(w) ?? []), v]) }
      let reg = 0, ot = 0, dt = 0, travel = 0, weekend = 0, shifts = 0
      const weeks: PayrollLine['weeks'] = []
      for (const [weekStart, wk] of [...byWeek.entries()].sort()) {
        const classified = classifyWeek(buildSegments(wk, rules.travel), rule, Math.round(threshold * 60)).filter((s) => inRange(s.date))
        if (!classified.length) continue
        const w = { reg: 0, ot: 0, dt: 0 }
        for (const s of classified) {
          w.reg += s.regular; w.ot += s.overtime; w.dt += s.doubleTime
          if (s.kind === 'travel') travel += s.minutes
          else { shifts++; const dow = new Date(`${s.date}T12:00:00Z`).getUTCDay(); if (dow === 0 || dow === 6) weekend += s.minutes }
        }
        reg += w.reg; ot += w.ot; dt += w.dt
        weeks.push({ weekStart, hours: hours2(w.reg + w.ot + w.dt), regularHours: hours2(w.reg), overtimeHours: hours2(w.ot), doubleTimeHours: hours2(w.dt) })
      }
      if (reg + ot + dt === 0) continue
      const p: any = byId.get(id) || {}
      const baseRate = Number(p.baseRate ?? p.defaultPayRate ?? FALLBACK_PAY_RATE) || FALLBACK_PAY_RATE
      const baseCents = cents(baseRate)
      const otCents = p.overtimeRate != null && Number.isFinite(Number(p.overtimeRate)) ? cents(Number(p.overtimeRate)) : Math.round(baseCents * multiplier)
      const dtCents = baseCents * 2
      const regularPayCents = payCents(reg, baseCents), overtimePayCents = payCents(ot, otCents), doubleTimePayCents = payCents(dt, dtCents)
      lines.push({
        caregiverId: id, firstName: p.firstName ?? null, lastName: p.lastName ?? null, email: p.email ?? null,
        shifts, totalHours: hours2(reg + ot + dt), regularHours: hours2(reg), overtimeHours: hours2(ot), weekendHours: hours2(weekend),
        doubleTimeHours: hours2(dt), doubleTimePay: doubleTimePayCents / 100, travelHours: hours2(travel),
        baseRate: baseCents / 100, otRate: otCents / 100,
        regularPay: regularPayCents / 100, overtimePay: overtimePayCents / 100,
        grossPay: (regularPayCents + overtimePayCents + doubleTimePayCents) / 100, weeks,
      })
    }
    return lines.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
  }

  /**
   * The pay for every caregiver of the company with payable reviews between `startDate` and `endDate` (inclusive,
   * YYYY-MM-DD), or one caregiver's. Sorted by last name, first name.
   */
  async function payrollForRange(companyId: string, startDate: string, endDate: string, opts: {
    caregiverId?: string | null; otThresholdHours?: number; otMultiplier?: number
  } = {}): Promise<PayrollLine[]> {
    const lines = await hoursPayroll(companyId, startDate, endDate, opts)
    return withPickupBonuses(companyId, startDate, endDate, opts.caregiverId || null, lines)
  }

  /**
   * An open shift's pickup bonus is paid through the pay run (care_pickup_rewards): once the visit it was posted for has been worked
   * (a payable review of that caregiver, that client, that day), the bonus is added to that caregiver's line in the pay period holding
   * the shift's date — separately shown (bonusPay) and inside grossPay, so Calculate, the approval and every export carry it. It is a flat
   * amount: it never changes the hours or the overtime split.
   */
  async function withPickupBonuses(companyId: string, startDate: string, endDate: string, caregiverId: string | null, lines: PayrollLine[]): Promise<PayrollLine[]> {
    if (!lines.length || !(await d.features.isFeatureEnabled(companyId, 'care_pickup_rewards'))) return lines
    const pickups = (await pickupsInRange(d.db, companyId, startDate, endDate, caregiverId, PAYABLE_REVIEW_STATUSES)).filter((p) => p.reviewId && p.bonusCents > 0)
    if (!pickups.length) return lines
    const byCaregiver = new Map<string, { cents: number; shifts: number }>()
    for (const p of pickups) {
      const cur = byCaregiver.get(p.caregiverId) ?? { cents: 0, shifts: 0 }
      byCaregiver.set(p.caregiverId, { cents: cur.cents + Number(p.bonusCents), shifts: cur.shifts + 1 })
    }
    return lines.map((l) => {
      const b = byCaregiver.get(l.caregiverId)
      if (!b) return l
      return { ...l, bonusPay: b.cents / 100, bonusShifts: b.shifts, grossPay: (cents(l.grossPay) + b.cents) / 100 }
    })
  }

  async function hoursPayroll(companyId: string, startDate: string, endDate: string, opts: {
    caregiverId?: string | null; otThresholdHours?: number; otMultiplier?: number
  } = {}): Promise<PayrollLine[]> {
    const threshold = Number.isFinite(Number(opts.otThresholdHours)) && Number(opts.otThresholdHours) > 0 ? Number(opts.otThresholdHours) : OT_WEEKLY_HOURS
    const multiplier = Number.isFinite(Number(opts.otMultiplier)) && Number(opts.otMultiplier) >= 1 ? Number(opts.otMultiplier) : OT_MULTIPLIER
    const cg = opts.caregiverId || null

    const { startDay } = await companyWorkWeek(d.db, companyId)
    // Item 2: an agency with care_payroll_rules is paid by its own overtime rule and travel pay; every other agency, as ever.
    const rules = await payRules.forCompany(companyId)
    if (rules) return payrollWithRules(companyId, startDate, endDate, rules, startDay, cg, multiplier, threshold)
    const weeks = await payableReviewWeeks(d.db, companyId, startDate, endDate, PAYABLE_REVIEW_STATUSES, cg, startDay)
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
        doubleTimeHours: 0,
        doubleTimePay: 0,
        travelHours: 0,
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

  return { payrollForRange, unresolvedReviewCount, payRules }
}

export type PayrollPay = ReturnType<typeof createPayrollPay>
