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
// With care_payroll_rules (rows 19–20, core/payRules.ts) the pay run is the agency's own: its state's overtime rule, holidays,
// sleepovers, break premiums, facility thresholds, limits and travel. When a week holds more than one rate (a care-type rate, a
// travel rate) the overtime premium is on the BLENDED regular rate — total straight-time pay ÷ total hours (29 CFR 778.115):
// an overtime hour is paid its own rate plus half the blended rate, a double-time hour its own rate plus the blended rate. A
// week at one rate is paid exactly as before (1.5× / 2× that rate, or the caregiver's overtime rate on file).
//
// Change: the company's reviews, caregivers and rates only (companyId first).
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import { payableReviewWeeks, caregiverPayRates, reviewCountWithStatus } from '../../../data/homecarePayroll.ts'
import { payableVisits, caregiverPayProfiles, caregiverCareTypeCents, type PayableVisit, type AuditRowIn } from '../../../data/homecarePayRules.ts'
import { pickupsInRange } from '../../../data/homecareRewards.ts'
import type { CrmDeps } from '../../deps.ts'
import { OT_WEEKLY_HOURS as WEEKLY_CAP, workweekStartOn, companyWorkWeek } from '../../payrollExport/workWeek.ts'
import { addDays, resolveTimezone } from './agencyTime.ts'
import { drivingLeg, toPoint, type Point } from './distance.ts'
import { OVERTIME_RULES, buildSegments, classifyWeek, createPayRules, type Classified, type PayRules, type TravelEstimate } from './payRules.ts'

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

/** One classified segment of a pay run, as the audit trail and the Excel file show it. */
export interface PayHourRow {
  reviewId: string | null; kind: 'work' | 'travel'; date: string; clientId: string | null; clientName: string | null
  minutes: number; regularMinutes: number; overtimeMinutes: number; doubleTimeMinutes: number; unpaidMinutes: number
  isHoliday: boolean; rateCents: number; ruleId: string; reasons: string[]
  weekStart: string; miles: number | null; sleepover: boolean
  /** This segment's pay in cents (regular, overtime and double time at their rates). */
  payCents: number
}

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
  /** Rows 19–20 (care_payroll_rules). Travel pay is inside the hours' pay already (at the travel rate); holiday, break and sleepover pay are on top. */
  travelPay?: number
  travelRate?: number
  /** The miles of the travel legs the pay run worked out (the pay run's mileage line is from recorded trips). */
  travelLegMiles?: number
  blendedRate?: number
  /** Regular hours worked on a holiday (a payroll file sends them under the holiday code instead of regular). */
  holidayHours?: number
  /** The whole holiday premium; holidayExtraPay is the part on hours that were also overtime or double time. */
  holidayPremiumPay?: number
  holidayExtraPay?: number
  mealPremiums?: number
  restPremiums?: number
  breakPremiumPay?: number
  sleepovers?: number
  sleepoverPay?: number
  /** Hours over the agency's daily / weekly limit that were not paid (limits.capPayable). */
  cappedHours?: number
  limitWarnings?: string[]
  /** limits.mode 'block': the approval is refused until the office changes the hours or the rule. */
  limitBlocked?: boolean
  ruleId?: string
  hours?: PayHourRow[]
  /** care_pickup_rewards: the open-shift pickup bonuses of worked visits in the range, already inside grossPay (zero without the feature). */
  bonusPay?: number
  bonusShifts?: number
  baseRate: number
  otRate: number
  regularPay: number
  overtimePay: number
  grossPay: number
  weeks: { weekStart: string; hours: number; regularHours: number; overtimeHours: number; doubleTimeHours?: number; blendedRate?: number; pay?: number }[]
}

/** The classified rows of a line as the audit table stores them. */
export const auditRowsOf = (line: PayrollLine): AuditRowIn[] => (line.hours ?? []).map((r) => ({
  reviewId: r.reviewId, segmentKind: r.kind, segmentDate: r.date, minutes: r.minutes,
  regularMinutes: r.regularMinutes, overtimeMinutes: r.overtimeMinutes, doubleTimeMinutes: r.doubleTimeMinutes, unpaidMinutes: r.unpaidMinutes,
  isHoliday: r.isHoliday, rateCents: r.rateCents, ruleId: r.ruleId, reasons: r.reasons,
}))

const MEAL_AFTER_MINUTES = 5 * 60, MEAL_WAIVABLE_UNDER = 6 * 60, SECOND_MEAL_AFTER = 10 * 60, SECOND_MEAL_WAIVABLE_UNDER = 12 * 60, MEAL_MINUTES = 30

/**
 * California Labor Code §512 / §226.7: the meal and rest premiums owed for one workday from its visits. One hour's pay for the
 * day when a meal break was owed and none of at least 30 minutes was recorded (and it was not waived where waiving is allowed), one
 * more when a rest break was missed. Returns how many of each (0 or 1).
 */
export function breakPremiumsForDay(visits: Pick<PayableVisit, 'minutes' | 'mealBreakMinutes' | 'mealWaived' | 'restBreakMissed' | 'isSleepover'>[]): { meal: number; rest: number } {
  const worked = visits.reduce((s, v) => s + Number(v.minutes), 0)
  const longestMeal = Math.max(0, ...visits.map((v) => Number(v.mealBreakMinutes ?? 0)))
  const waived = visits.some((v) => v.mealWaived)
  let meal = 0
  if (worked > MEAL_AFTER_MINUTES) {
    const firstOk = longestMeal >= MEAL_MINUTES || (waived && worked <= MEAL_WAIVABLE_UNDER)
    if (!firstOk) meal = 1
    else if (worked > SECOND_MEAL_AFTER) {
      // the second meal: a second recorded break is not tracked apart from the first; it is owed unless waived on a day of 12 hours or less
      const secondOk = visits.filter((v) => Number(v.mealBreakMinutes ?? 0) >= MEAL_MINUTES).length >= 2 || (waived && worked <= SECOND_MEAL_WAIVABLE_UNDER && longestMeal >= MEAL_MINUTES)
      if (!secondOk) meal = 1
    }
  }
  const rest = visits.some((v) => v.restBreakMissed) ? 1 : 0
  return { meal, rest }
}

export function createPayrollPay(d: CrmDeps) {
  const payRules = createPayRules(d)

  /** Travel estimates (addresses or gps) for each visit reached from another client the same day — and from home for the first. */
  async function travelEstimates(visits: PayableVisit[], rules: PayRules, home: Point | null): Promise<Map<string, TravelEstimate>> {
    const out = new Map<string, TravelEstimate>()
    if (!rules.travel.enabled || rules.travel.method === 'gap') return out
    const byDate = new Map<string, PayableVisit[]>()
    for (const v of visits) byDate.set(v.shiftDate, [...(byDate.get(v.shiftDate) ?? []), v])
    const startOf = (v: PayableVisit) => Date.parse(`${v.actualStart ?? v.scheduledStart ?? ''}Z`)
    for (const day of byDate.values()) {
      const ordered = day.slice().sort((a, b) => (Number.isFinite(startOf(a)) ? startOf(a) : Infinity) - (Number.isFinite(startOf(b)) ? startOf(b) : Infinity) || a.id.localeCompare(b.id))
      for (let i = 0; i < ordered.length; i++) {
        const v = ordered[i], prev = i > 0 ? ordered[i - 1] : null
        const clientPoint = toPoint({ lat: v.clientLat, lng: v.clientLng })
        const to = (rules.travel.method === 'gps' ? toPoint(v.gpsIn) : null) ?? clientPoint
        let from: Point | null = null
        if (prev) {
          if (!prev.clientId || !v.clientId || prev.clientId === v.clientId) continue
          from = (rules.travel.method === 'gps' ? toPoint(prev.gpsOut) : null) ?? toPoint({ lat: prev.clientLat, lng: prev.clientLng })
        } else if (rules.travel.fromHome) from = home
        if (!from || !to) continue
        const leg = await drivingLeg(from, to)
        out.set(v.id, { minutes: leg.minutes, miles: leg.miles })
      }
    }
    return out
  }

  /**
   * The pay run under the agency's own overtime rule and travel pay (item 2). Visits are read for whole work weeks so a daily or
   * 7th-day rule sees the days either side of the range; only the days inside the range are paid.
   */
  async function payrollWithRules(companyId: string, startDate: string, endDate: string, rules: PayRules, startDay: number, cg: string | null, multiplier: number, threshold: number | null): Promise<PayrollLine[]> {
    const rule = OVERTIME_RULES[rules.overtimeRule]
    const wkStart = workweekStartOn(startDate, startDay)
    const wkEnd = addDays(workweekStartOn(endDate, startDay), 6)
    const visits = await payableVisits(d.db, companyId, wkStart, wkEnd, PAYABLE_REVIEW_STATUSES, cg)
    if (!visits.length) return []
    const [co] = await d.db.select({ timezone: company.timezone, state: company.state }).from(company).where(eq(company.id, companyId)).limit(1)
    const tz = resolveTimezone(co)
    const inRange = (date: string) => date >= startDate && date <= endDate
    const ids = [...new Set(visits.map((v) => v.caregiverId))]
    const [people, profiles, careRates] = await Promise.all([caregiverPayRates(d.db, companyId, ids, endDate), caregiverPayProfiles(d.db, companyId, ids), caregiverCareTypeCents(d.db, companyId, ids)])
    const byId = new Map(people.map((p) => [String(p.id), p]))
    const profileBy = new Map(profiles.map((p) => [p.caregiverId, p]))
    const holidays = new Map(rules.holidays.map((h) => [h.date, h]))
    const weeklyMinutes = threshold === null ? null : Math.round(threshold * 60)

    const lines: PayrollLine[] = []
    for (const id of ids) {
      const mine = visits.filter((v) => v.caregiverId === id)
      const p: any = byId.get(id) || {}
      const prof = profileBy.get(id)
      const baseRate = Number(p.baseRate ?? p.defaultPayRate ?? FALLBACK_PAY_RATE) || FALLBACK_PAY_RATE
      const baseCents = cents(baseRate)
      const otOverride = p.overtimeRate != null && Number.isFinite(Number(p.overtimeRate)) ? cents(Number(p.overtimeRate)) : null
      const otCents = otOverride ?? Math.round(baseCents * multiplier)
      const travelCents = rules.travel.rateCents ?? baseCents
      const myCareRates = careRates.get(id) ?? new Map<string, number>()
      const rateOf = (v: PayableVisit) => (v.careTypeId && myCareRates.get(v.careTypeId)) || baseCents
      const estimates = await travelEstimates(mine, rules, toPoint({ lat: prof?.homeLat, lng: prof?.homeLng }))
      const visitBy = new Map(mine.map((v) => [v.id, v]))

      const byWeek = new Map<string, PayableVisit[]>()
      for (const v of mine) { const w = workweekStartOn(v.shiftDate, startDay); byWeek.set(w, [...(byWeek.get(w) ?? []), v]) }
      let reg = 0, ot = 0, dt = 0, unpaid = 0, travel = 0, travelMilesSum = 0, weekend = 0, shifts = 0, holidayMin = 0
      let regularPayC = 0, overtimePayC = 0, doubleTimePayC = 0, holidayPremiumC = 0, holidayExtraC = 0, travelPayC = 0, breakPremiumC = 0
      let mealPremiums = 0, restPremiums = 0, sleepovers = 0
      const warnings: string[] = []
      const hoursRows: PayHourRow[] = []
      const weeks: PayrollLine['weeks'] = []
      let lastBlended = baseCents
      for (const [weekStart, wk] of [...byWeek.entries()].sort()) {
        const segments = buildSegments(wk, rules.travel, { tz, splitMidnight: rules.splitOvernightAtMidnight, holidays: new Set(holidays.keys()), estimates })
        for (const s of segments) s.rateCents = s.kind === 'travel' ? travelCents : rateOf(visitBy.get(s.reviewId ?? s.id)!)
        const all = classifyWeek(segments, rule, weeklyMinutes, { rateCents: baseCents, facility: prof?.isFacilityStaff ? rules.facility : null, limits: rules.limits })
        // the blended regular rate is the whole week's (29 CFR 778.115), the pay only the days in range
        const paidMin = (s: Classified) => s.regular + s.overtime + s.doubleTime
        const straightAll = all.reduce((t, s) => t + payCents(paidMin(s), s.rateCents!), 0)
        const minutesAll = all.reduce((t, s) => t + paidMin(s), 0)
        const blended = minutesAll > 0 ? Math.round((straightAll * 60) / minutesAll) : baseCents
        const multiRate = new Set(all.filter((s) => paidMin(s) > 0).map((s) => s.rateCents)).size > 1
        lastBlended = blended
        const classified = all.filter((s) => inRange(s.date))
        if (!classified.length) continue
        const w = { reg: 0, ot: 0, dt: 0, pay: 0 }
        for (const s of classified) {
          const r = s.rateCents!
          w.reg += s.regular; w.ot += s.overtime; w.dt += s.doubleTime; unpaid += s.unpaid
          const regC = payCents(s.regular, r)
          // one rate: the rates on file; several: each hour's own rate plus the blended premium (29 CFR 778.115)
          const otC = multiRate ? payCents(s.overtime, r) + payCents(s.overtime, Math.round(blended / 2)) : payCents(s.overtime, otOverride && r === baseCents ? otOverride : Math.round(r * multiplier))
          const dtC = multiRate ? payCents(s.doubleTime, r) + payCents(s.doubleTime, blended) : payCents(s.doubleTime, r * 2)
          regularPayC += regC; overtimePayC += otC; doubleTimePayC += dtC
          w.pay += regC + otC + dtC
          if (s.holiday) {
            const m = holidays.get(s.date)?.multiplier ?? 1
            holidayMin += s.regular
            // the holiday premium is credited against the overtime premium on the same hours (29 CFR 778.203): the larger is paid
            const extra = payCents(s.overtime, Math.round(r * Math.max(0, m - 1.5))) + payCents(s.doubleTime, Math.round(r * Math.max(0, m - 2)))
            holidayPremiumC += payCents(s.regular, Math.round(r * (m - 1))) + extra
            holidayExtraC += extra
          }
          if (s.kind === 'travel') { travel += paidMin(s); travelPayC += payCents(paidMin(s), r); if (s.miles) travelMilesSum += Number(s.miles) }
          else {
            if (!s.id.endsWith(':2')) shifts++
            const dow = new Date(`${s.date}T12:00:00Z`).getUTCDay(); if (dow === 0 || dow === 6) weekend += paidMin(s)
          }
          const v = visitBy.get(s.reviewId ?? s.id)
          hoursRows.push({
            reviewId: s.reviewId ?? null, kind: s.kind, date: s.date, clientId: s.clientId, clientName: v?.clientFirstName ? `${v.clientFirstName} ${v.clientLastName ?? ''}`.trim() : null,
            minutes: s.minutes, regularMinutes: s.regular, overtimeMinutes: s.overtime, doubleTimeMinutes: s.doubleTime, unpaidMinutes: s.unpaid,
            isHoliday: !!s.holiday, rateCents: r, ruleId: prof?.isFacilityStaff ? 'facility' : rule.id, reasons: s.reasons, weekStart, miles: s.miles ?? null, sleepover: !!s.sleepover,
            payCents: regC + otC + dtC,
          })
        }
        reg += w.reg; ot += w.ot; dt += w.dt
        weeks.push({ weekStart, hours: hours2(w.reg + w.ot + w.dt), regularHours: hours2(w.reg), overtimeHours: hours2(w.ot), doubleTimeHours: hours2(w.dt), blendedRate: blended / 100, pay: w.pay / 100 })
        // limits: warn (and block) on the days and the week over the agency's lines, paid or not
        if (rules.limits.mode !== 'off') {
          const dayMin = new Map<string, number>()
          for (const s of classified) dayMin.set(s.date, (dayMin.get(s.date) ?? 0) + s.minutes)
          if (rules.limits.dailyHours != null) for (const [date, m] of dayMin) if (m > rules.limits.dailyHours * 60) warnings.push(`${date}: ${hours2(m)} h, over the daily limit of ${rules.limits.dailyHours} h${rules.limits.capPayable ? ' (the rest not paid)' : ''}`)
          const weekAll = all.reduce((t, s) => t + s.minutes, 0)
          if (rules.limits.weeklyHours != null && weekAll > rules.limits.weeklyHours * 60) warnings.push(`Week of ${weekStart}: ${hours2(weekAll)} h, over the weekly limit of ${rules.limits.weeklyHours} h${rules.limits.capPayable ? ' (the rest not paid)' : ''}`)
        }
      }
      if (reg + ot + dt + unpaid === 0 && !mine.some((v) => v.isSleepover && inRange(v.shiftDate))) continue
      // break premiums (California) and sleepovers, by the day, days in range only
      const byDay = new Map<string, PayableVisit[]>()
      for (const v of mine) if (inRange(v.shiftDate)) byDay.set(v.shiftDate, [...(byDay.get(v.shiftDate) ?? []), v])
      for (const dayVisits of byDay.values()) {
        if (rule.mealRestPremiums && rules.breakPremiums && !prof?.isFacilityStaff) {
          const b = breakPremiumsForDay(dayVisits)
          mealPremiums += b.meal; restPremiums += b.rest
          breakPremiumC += (b.meal + b.rest) * lastBlended // one hour's pay at the regular rate (Labor Code §226.7(c))
        }
        sleepovers += dayVisits.filter((v) => v.isSleepover).length
      }
      const sleepoverC = sleepovers * rules.sleepoverCents
      lines.push({
        caregiverId: id, firstName: p.firstName ?? null, lastName: p.lastName ?? null, email: p.email ?? null,
        shifts, totalHours: hours2(reg + ot + dt), regularHours: hours2(reg), overtimeHours: hours2(ot), weekendHours: hours2(weekend),
        doubleTimeHours: hours2(dt), doubleTimePay: doubleTimePayC / 100, travelHours: hours2(travel),
        travelPay: travelPayC / 100, travelRate: travelCents / 100, travelLegMiles: Math.round(travelMilesSum * 100) / 100, blendedRate: lastBlended / 100,
        holidayHours: hours2(holidayMin), holidayPremiumPay: holidayPremiumC / 100, holidayExtraPay: holidayExtraC / 100,
        mealPremiums, restPremiums, breakPremiumPay: breakPremiumC / 100, sleepovers, sleepoverPay: sleepoverC / 100,
        cappedHours: hours2(unpaid), limitWarnings: warnings, limitBlocked: rules.limits.mode === 'block' && warnings.length > 0,
        ruleId: prof?.isFacilityStaff ? 'facility' : rule.id, hours: hoursRows,
        baseRate: baseCents / 100, otRate: otCents / 100,
        regularPay: regularPayC / 100, overtimePay: overtimePayC / 100,
        grossPay: (regularPayC + overtimePayC + doubleTimePayC + holidayPremiumC + breakPremiumC + sleepoverC) / 100, weeks,
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
    const askedThreshold = Number.isFinite(Number(opts.otThresholdHours)) && Number(opts.otThresholdHours) > 0 ? Number(opts.otThresholdHours) : null
    const threshold = askedThreshold ?? OT_WEEKLY_HOURS
    const multiplier = Number.isFinite(Number(opts.otMultiplier)) && Number(opts.otMultiplier) >= 1 ? Number(opts.otMultiplier) : OT_MULTIPLIER
    const cg = opts.caregiverId || null

    const { startDay } = await companyWorkWeek(d.db, companyId)
    // Item 2: an agency with care_payroll_rules is paid by its own overtime rule and travel pay; every other agency, as ever.
    // Its weekly line is the rule's (40, or 45 for a California personal attendant) unless the office typed another on Calculate.
    const rules = await payRules.forCompany(companyId)
    if (rules) return payrollWithRules(companyId, startDate, endDate, rules, startDay, cg, multiplier, askedThreshold !== null && askedThreshold !== OT_WEEKLY_HOURS ? askedThreshold : null)
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
