// Pay rules (rows 19–20 of the home care parity brief, docs/parity/homecare-payroll.md): when overtime and double time are owed,
// holidays, sleepovers, overnight visits split at midnight, facility thresholds, services left out of overtime, daily and weekly
// limits, and travel between visits — and a reason in words for every minute (the audit trail).
//
// OFF (the default, and for every agency without care_payroll_rules) payroll is exactly what it always was: hours over 40 in
// a work week are overtime (core/payrollPay.ts). ON, the agency picks its state; the rule that state's law requires is applied
// (STATE_RULES, every state and DC, each with its citation). The rules:
//   federal     29 U.S.C. §207(a)(1): over 40 hours in the work week at 1.5x. Every state not listed below.
//   california  Labor Code §510(a): over 8 in a workday at 1.5x, over 12 at 2x; the 7th straight day of the work week: the first
//               8 hours at 1.5x, then 2x; over 40 in the week at 1.5x for hours not already overtime (no stacking, §510(a) last
//               sentence). IWC Wage Order 15-2001 §3(A) for household occupations.
//   california_personal_attendant  Labor Code §1454 (Domestic Worker Bill of Rights) and Wage Order 15 §3(A): a personal attendant
//               is owed 1.5x over 9 hours in a day or over 45 in the week — no double time and no 7th-day rule.
//   alaska      AS 23.10.060(b): over 8 in a day or over 40 in the week at 1.5x.
//   nevada      NRS 608.018(1): an employee paid less than 1.5 times the minimum wage is owed 1.5x over 8 hours in a workday (and
//               over 40 in the week, NRS 608.018(2), for everyone). The minimum wage is $12.00 an hour from 1 July 2024 (Nev. Const.
//               art. 15 §16 as amended by Question 2 of 2022; NRS 608.250), so the line is $18.00. NAC 608.115 counts a workday as
//               24 consecutive hours from when the employee starts; this product counts the agency's calendar day. The 4-day,
//               10-hour schedule an employee may agree to (§608.018(1)(b)) is not modelled.
//   colorado    COMPS Order #39, 7 CCR 1103-1, Rule 4.1.1: over 40 in the week or over 12 in a workday at 1.5x. Rule 4.1.1(C)'s
//               "12 consecutive hours regardless of workday" is not modelled.
//   kentucky    KRS 337.050(1): an employee who works all seven days of the work week is paid 1.5x for every hour of the seventh
//               day, when the week's hours go over 40 (KRS 337.050(2) as the Labor Cabinet applies it); over 40 in the week at 1.5x.
// Minnesota (Minn. Stat. §177.25, 48 hours) and Kansas (K.S.A. 44-1204, 46 hours) have state lines ABOVE the federal one; a home
// care agency is covered by the FLSA (29 CFR 552.109, since 2015), so the federal 40-hour line governs and they are listed federal.
//
// Facility staff (29 U.S.C. §207(j): a hospital or residential care establishment may pay by the day and a 14-day period) are paid
// under the agency's own facility thresholds (a daily line and a weekly line) instead of the state rule.
//
// Breaks (California Labor Code §512 and §226.7, Wage Order 15 §11–12): a meal break of 30 minutes is owed before the end of the 5th
// hour of a workday over 5 hours (waivable in writing when the day is 6 hours or less), a second before the end of the 10th hour of
// a day over 10 hours (waivable when the day is 12 hours or less and the first was not waived); a rest break of 10 minutes every 4
// hours. One hour's pay at the regular rate is owed for each workday a meal break was not provided, and one more for a rest break
// (§226.7(c)) — at most one of each a day. Personal attendants are exempt (Wage Order 15 §11(E), §12(C)). Those premiums are
// computed in core/payrollPay.ts from the break fields on each shift review.
//
// Holidays: the agency's own list of dates and a multiplier; hours worked on one carry a premium of (multiplier − 1) × rate. The
// premium is creditable against overtime owed for the same hours (29 CFR 778.203), so an hour that is both holiday and overtime
// carries whichever premium is larger, never both.
//
// Sleepovers (29 CFR 785.22: on a shift of 24 hours or more, up to 8 hours of sleep may be left unpaid by agreement; 785.21: on a
// shift under 24 hours every hour is work): a review marked sleepover is a worked day (it counts toward California's 7th-day streak,
// as ShiftCare does) whose awake minutes are its payable minutes, plus the agency's flat sleepover amount.
//
// Travel: time between two visits on the same day at DIFFERENT clients is paid under the agency's method — the gap between the
// visits (HomeTrak), or an estimate from the clients' addresses or from the GPS clock-out and clock-in points (WellSky) — rounded up
// to the agency's step, only when the gap is no longer than the limit (an hour by default), up to the cap (30 minutes by default). A
// per-visit flag overrides the rule either way, and the office may type the minutes. Travel is work time, so it counts toward the day
// and the week; it is paid at the travel rate when the agency sets one, else the caregiver's rate; never billed.
//
// The unit is a SEGMENT: a visit's minutes (or the part before / after midnight), or the travel before it, in the order they
// happened. Each minute is classified once, so a client's margin (core/margin.ts) can take its share of the same overtime. Pure.
import { eq } from 'drizzle-orm'
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import type { PayableVisit } from '../../../data/homecarePayRules.ts'
import type { CrmDeps } from '../../deps.ts'
import { ymdIn, addDays } from './agencyTime.ts'

export const PAY_RULES_FEATURE = 'care_payroll_rules'

export type OvertimeRuleId = 'federal' | 'california' | 'california_personal_attendant' | 'alaska' | 'nevada' | 'colorado' | 'kentucky'
export interface OvertimeRule {
  id: OvertimeRuleId
  label: string
  cite: string
  /** Hours over this in the work week are overtime (40; 45 for a California personal attendant, Labor Code §1454). */
  weeklyOtAfterHours: number
  dailyOtAfterHours: number | null
  dailyDoubleAfterHours: number | null
  /** California: 7th day 8 h at 1.5x then 2x. Kentucky: the whole 7th day at 1.5x when the week is over 40 hours. */
  seventhDay: 'none' | 'california' | 'kentucky'
  /** Nevada: the daily line applies only to a rate below this (1.5 × the minimum wage). */
  dailyOtOnlyBelowRateCents: number | null
  /** California Labor Code §512 / §226.7 premiums apply. */
  mealRestPremiums: boolean
}

/** Nevada's minimum wage, $12.00 an hour from 1 July 2024 (Nev. Const. art. 15 §16; NRS 608.250). */
export const NEVADA_MINIMUM_WAGE_CENTS = 1200

export const OVERTIME_RULES: Record<OvertimeRuleId, OvertimeRule> = {
  federal: { id: 'federal', label: 'Federal: over 40 hours a week', cite: '29 U.S.C. §207(a)(1)', weeklyOtAfterHours: 40, dailyOtAfterHours: null, dailyDoubleAfterHours: null, seventhDay: 'none', dailyOtOnlyBelowRateCents: null, mealRestPremiums: false },
  california: { id: 'california', label: 'California: over 8 a day, double time over 12, 7th day, meal and rest premiums', cite: 'Cal. Labor Code §510(a), §512, §226.7; IWC Wage Order 15 §3(A)', weeklyOtAfterHours: 40, dailyOtAfterHours: 8, dailyDoubleAfterHours: 12, seventhDay: 'california', dailyOtOnlyBelowRateCents: null, mealRestPremiums: true },
  california_personal_attendant: { id: 'california_personal_attendant', label: 'California personal attendant: over 9 a day or 45 a week', cite: 'Cal. Labor Code §1454; IWC Wage Order 15 §3(A), §11(E), §12(C)', weeklyOtAfterHours: 45, dailyOtAfterHours: 9, dailyDoubleAfterHours: null, seventhDay: 'none', dailyOtOnlyBelowRateCents: null, mealRestPremiums: false },
  alaska: { id: 'alaska', label: 'Alaska: over 8 hours a day', cite: 'Alaska Stat. §23.10.060(b)', weeklyOtAfterHours: 40, dailyOtAfterHours: 8, dailyDoubleAfterHours: null, seventhDay: 'none', dailyOtOnlyBelowRateCents: null, mealRestPremiums: false },
  nevada: { id: 'nevada', label: 'Nevada: over 8 hours a day when paid under 1.5× the minimum wage', cite: 'NRS 608.018(1)–(2); NRS 608.250; Nev. Const. art. 15 §16', weeklyOtAfterHours: 40, dailyOtAfterHours: 8, dailyDoubleAfterHours: null, seventhDay: 'none', dailyOtOnlyBelowRateCents: Math.round(NEVADA_MINIMUM_WAGE_CENTS * 1.5), mealRestPremiums: false },
  colorado: { id: 'colorado', label: 'Colorado: over 12 hours a day', cite: 'COMPS Order #39, 7 CCR 1103-1, Rule 4.1.1', weeklyOtAfterHours: 40, dailyOtAfterHours: 12, dailyDoubleAfterHours: null, seventhDay: 'none', dailyOtOnlyBelowRateCents: null, mealRestPremiums: false },
  kentucky: { id: 'kentucky', label: 'Kentucky: the 7th straight day at 1.5× in a week over 40 hours', cite: 'KRS 337.050(1)–(2)', weeklyOtAfterHours: 40, dailyOtAfterHours: null, dailyDoubleAfterHours: null, seventhDay: 'kentucky', dailyOtOnlyBelowRateCents: null, mealRestPremiums: false },
}

export interface StateRule { code: string; name: string; rule: OvertimeRuleId; note: string | null }
const st = (code: string, name: string, rule: OvertimeRuleId = 'federal', note: string | null = null): StateRule => ({ code, name, rule, note })
/** Every state and DC: the overtime rule its law requires of a home care agency, with what is special about it. */
export const STATE_RULES: StateRule[] = [
  st('AL', 'Alabama'), st('AK', 'Alaska', 'alaska', 'Over 8 hours in a day is overtime (Alaska Stat. §23.10.060(b)).'), st('AZ', 'Arizona'), st('AR', 'Arkansas'),
  st('CA', 'California', 'california', 'Daily overtime over 8, double time over 12, the 7th day, meal and rest break premiums (Labor Code §510, §512, §226.7). A personal attendant is owed overtime over 9 a day or 45 a week instead (§1454): pick that rule when your caregivers are personal attendants.'),
  st('CO', 'Colorado', 'colorado', 'Over 12 hours in a day is overtime (COMPS Order #39 Rule 4.1.1).'), st('CT', 'Connecticut'), st('DE', 'Delaware'), st('DC', 'District of Columbia'), st('FL', 'Florida'), st('GA', 'Georgia'), st('HI', 'Hawaii'), st('ID', 'Idaho'), st('IL', 'Illinois'), st('IN', 'Indiana'), st('IA', 'Iowa'),
  st('KS', 'Kansas', 'federal', 'Kansas law sets 46 hours (K.S.A. 44-1204) but only for employers the FLSA does not cover; a home care agency is covered (29 CFR 552.109), so the federal 40-hour line governs.'),
  st('KY', 'Kentucky', 'kentucky', 'Every hour of the 7th straight day is overtime when the week is over 40 hours (KRS 337.050).'), st('LA', 'Louisiana'), st('ME', 'Maine'), st('MD', 'Maryland'), st('MA', 'Massachusetts'), st('MI', 'Michigan'),
  st('MN', 'Minnesota', 'federal', 'Minnesota law sets 48 hours (Minn. Stat. §177.25) but the FLSA covers a home care agency (29 CFR 552.109), so the federal 40-hour line governs.'),
  st('MS', 'Mississippi'), st('MO', 'Missouri'), st('MT', 'Montana'), st('NE', 'Nebraska'),
  st('NV', 'Nevada', 'nevada', 'Over 8 hours in a day is overtime for a caregiver paid under 1.5× the minimum wage, $18.00 an hour from 1 July 2024 (NRS 608.018, NRS 608.250).'),
  st('NH', 'New Hampshire'), st('NJ', 'New Jersey'), st('NM', 'New Mexico'), st('NY', 'New York'), st('NC', 'North Carolina'), st('ND', 'North Dakota'), st('OH', 'Ohio'), st('OK', 'Oklahoma'),
  st('OR', 'Oregon', 'federal', 'Oregon\'s daily line (ORS 652.020) is for manufacturing only; home care follows the 40-hour week (ORS 653.261).'),
  st('PA', 'Pennsylvania'), st('RI', 'Rhode Island'), st('SC', 'South Carolina'), st('SD', 'South Dakota'), st('TN', 'Tennessee'), st('TX', 'Texas'), st('UT', 'Utah'), st('VT', 'Vermont'), st('VA', 'Virginia'), st('WA', 'Washington'), st('WV', 'West Virginia'), st('WI', 'Wisconsin'), st('WY', 'Wyoming'),
]
export const stateRule = (code: unknown): StateRule | null => STATE_RULES.find((s) => s.code === String(code ?? '').trim().toUpperCase()) ?? null

export type TravelMethod = 'gap' | 'addresses' | 'gps'
export interface TravelRule {
  enabled: boolean; maxGapMinutes: number; capMinutes: number
  /** Travel paid at this rate (cents an hour), or null for the caregiver's own rate. */
  rateCents: number | null
  method: TravelMethod
  /** Travel minutes are rounded UP to a multiple of this (1, 5, 10, 15, 30). */
  roundToMinutes: number
  /** The first visit of the day is reached from the caregiver's home address (addresses method). */
  fromHome: boolean
  /** Miles between completed visits' addresses are recorded as travel mileage when the pay run is made. */
  mileageFromVisits: boolean
}
export interface Holiday { date: string; label: string; multiplier: number }
export interface FacilityRule { weeklyHours: number; dailyOtAfterHours: number | null }
export type LimitMode = 'off' | 'warn' | 'block'
export interface LimitsRule { dailyHours: number | null; weeklyHours: number | null; mode: LimitMode; capPayable: boolean }
export interface PayRules {
  state: string | null
  overtimeRule: OvertimeRuleId
  travel: TravelRule
  holidays: Holiday[]
  sleepoverCents: number
  breakPremiums: boolean
  splitOvernightAtMidnight: boolean
  facility: FacilityRule
  limits: LimitsRule
}
export const DEFAULT_PAY_RULES: PayRules = {
  state: null, overtimeRule: 'federal',
  travel: { enabled: false, maxGapMinutes: 60, capMinutes: 30, rateCents: null, method: 'gap', roundToMinutes: 1, fromHome: false, mileageFromVisits: false },
  holidays: [], sleepoverCents: 0, breakPremiums: false, splitOvernightAtMidnight: false,
  facility: { weeklyHours: 40, dailyOtAfterHours: 8 },
  limits: { dailyHours: null, weeklyHours: null, mode: 'off', capPayable: false },
}

export interface Segment {
  id: string; kind: 'work' | 'travel'; clientId: string | null; date: string; minutes: number
  reviewId?: string | null
  /** The rate this segment is paid at (cents an hour); set by the pay run, so one week can blend several. */
  rateCents?: number
  otExempt?: boolean
  holiday?: boolean
  sleepover?: boolean
  /** Travel only: the miles driven (an estimate, a map answer, or what the office typed). */
  miles?: number | null
}
export interface Classified extends Segment {
  regular: number; overtime: number; doubleTime: number
  /** Minutes over a daily or weekly limit the agency does not pay (limits.capPayable). */
  unpaid: number
  reasons: string[]
}
export interface ClassifyContext {
  /** The caregiver's base rate, for Nevada's wage test when a segment has none of its own. */
  rateCents?: number
  facility?: FacilityRule | null
  limits?: LimitsRule | null
}

const WEEKLY_MINUTES = 40 * 60
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
const h = (m: number) => (m / 60).toFixed(2)

/**
 * Classify one work week's segments (ONE caregiver, in the order worked, dates ascending) as regular, overtime, double time and
 * unpaid minutes under `rule`, with the reason for each. Each segment's four numbers add up to its minutes. `weeklyMinutes`
 * overrides the rule's weekly line (the pay run's own threshold).
 */
export function classifyWeek(segments: Segment[], rule: OvertimeRule, weeklyMinutes: number | null = null, ctx: ClassifyContext = {}): Classified[] {
  const facility = ctx.facility ?? null
  const weekly = facility ? facility.weeklyHours * 60 : (weeklyMinutes ?? (rule.weeklyOtAfterHours * 60 || WEEKLY_MINUTES))
  const cite = facility ? '29 U.S.C. §207(j), the agency\'s facility thresholds' : rule.cite
  const limits = ctx.limits && ctx.limits.mode !== 'off' && ctx.limits.capPayable ? ctx.limits : null

  // Every date with a segment is a worked day — a sleepover of 0 awake minutes included.
  const dayTotals = new Map<string, number>()
  for (const s of segments) dayTotals.set(s.date, (dayTotals.get(s.date) ?? 0) + (s.otExempt ? 0 : s.minutes))
  const dates = [...dayTotals.keys()].sort()
  const weekMinutes = [...dayTotals.values()].reduce((a, b) => a + b, 0)
  const seventh = !facility && dates.length === 7 && (rule.seventhDay === 'california' || (rule.seventhDay === 'kentucky' && weekMinutes > weekly)) ? dates[6] : null

  const dailyLine = (s: Segment): number => {
    if (facility) return facility.dailyOtAfterHours === null ? Infinity : facility.dailyOtAfterHours * 60
    if (rule.dailyOtAfterHours === null) return Infinity
    if (rule.dailyOtOnlyBelowRateCents !== null) {
      const rate = s.rateCents ?? ctx.rateCents
      if (rate === undefined || rate >= rule.dailyOtOnlyBelowRateCents) return Infinity
    }
    return rule.dailyOtAfterHours * 60
  }
  const doubleLine = (): number => (facility || rule.dailyDoubleAfterHours === null ? Infinity : rule.dailyDoubleAfterHours * 60)

  // Daily limit: the minutes of a day over the limit are not paid, taken from the END of the day.
  const dailyCap = limits?.dailyHours != null ? limits.dailyHours * 60 : Infinity
  const weeklyCap = limits?.weeklyHours != null ? limits.weeklyHours * 60 : Infinity

  const done = new Map<string, number>()
  let paidSoFar = 0
  const out: Classified[] = segments.map((s) => {
    const reasons: string[] = []
    if (s.otExempt) {
      reasons.push(`Service left out of overtime: ${h(s.minutes)} h regular`)
      return { ...s, regular: s.minutes, overtime: 0, doubleTime: 0, unpaid: 0, reasons }
    }
    const pos = done.get(s.date) ?? 0
    done.set(s.date, pos + s.minutes)
    // limits first: what is over the daily or weekly cap is unpaid
    const paidInDay = overlap(pos, pos + s.minutes, 0, dailyCap)
    const paidInWeek = Math.min(paidInDay, Math.max(0, weeklyCap - paidSoFar))
    paidSoFar += paidInWeek
    const unpaid = s.minutes - paidInWeek
    if (unpaid > 0) reasons.push(`${h(unpaid)} h over the agency's ${paidInDay < s.minutes ? `daily limit of ${limits!.dailyHours} h` : `weekly limit of ${limits!.weeklyHours} h`}: not paid`)
    const end = pos + paidInWeek
    let ot0: number, dt0: number
    if (s.date === seventh && rule.seventhDay === 'california') { ot0 = 0; dt0 = 8 * 60 }
    else if (s.date === seventh && rule.seventhDay === 'kentucky') { ot0 = 0; dt0 = Infinity }
    else { ot0 = dailyLine(s); dt0 = Math.max(doubleLine(), ot0) }
    const regular = overlap(pos, end, 0, ot0), overtime = overlap(pos, end, ot0, dt0), doubleTime = overlap(pos, end, dt0, Infinity)
    if (s.date === seventh) reasons.push(`7th straight day of the week: ${h(overtime)} h overtime${doubleTime ? `, ${h(doubleTime)} h double time` : ''} (${cite})`)
    else {
      if (overtime > 0) reasons.push(`Over ${ot0 / 60} h in the day: ${h(overtime)} h overtime (${cite})`)
      if (doubleTime > 0) reasons.push(`Over ${dt0 / 60} h in the day: ${h(doubleTime)} h double time (${cite})`)
    }
    if (s.kind === 'travel') reasons.unshift(`Travel between visits: ${h(s.minutes)} h${s.miles ? `, ${Number(s.miles).toFixed(1)} mi` : ''}`)
    if (s.sleepover) reasons.unshift('Sleepover: a worked day; awake minutes paid (29 CFR 785.22)')
    if (s.holiday) reasons.push('Holiday: premium at the agency\'s multiplier (29 CFR 778.203 credit against overtime)')
    return { ...s, regular, overtime, doubleTime, unpaid, reasons }
  })
  // hours over the weekly line that are not already overtime: the LATER regular minutes of the week become overtime
  let regularSoFar = 0
  for (const s of out) {
    if (s.otExempt) continue
    const keep = Math.min(s.regular, Math.max(0, weekly - regularSoFar))
    const moved = s.regular - keep
    if (moved > 0) s.reasons.push(`Over ${weekly / 60} h in the week: ${h(moved)} h overtime (${cite})`)
    s.overtime += moved
    s.regular = keep
    regularSoFar += keep
  }
  for (const s of out) if (s.regular > 0 && s.reasons.every((r) => !r.includes('regular'))) s.reasons.push(`${h(s.regular)} h regular`)
  return out
}

const stamp = (v: string | null) => (v ? Date.parse(`${v}Z`) : NaN)

/** The UTC instant of local midnight starting `ymd` in `tz`. */
export const midnightUtc = (ymd: string, tz: string): number => zonedWallTimeToUtc(ymd, '00:00', tz).getTime()

export interface TravelEstimate { minutes: number; miles: number | null }
export interface BuildOptions {
  tz?: string
  splitMidnight?: boolean
  holidays?: Set<string>
  /** By visit id: the estimated travel TO that visit (addresses or gps method), before rounding and the cap. */
  estimates?: Map<string, TravelEstimate>
}

const roundUp = (minutes: number, step: number) => (step > 1 ? Math.ceil(minutes / step) * step : minutes)

/** One week's visits of one caregiver as segments in the order worked, with the travel between visits when the rule pays it. */
export function buildSegments(visits: PayableVisit[], travel: TravelRule | null, opts: BuildOptions = {}): Segment[] {
  type V = PayableVisit & { s: number; e: number; kind: 'actual' | 'scheduled' | null }
  const dated: V[] = visits.map((v) => {
    const aS = stamp(v.actualStart), aE = stamp(v.actualEnd), sS = stamp(v.scheduledStart), sE = stamp(v.scheduledEnd)
    if (Number.isFinite(aS) && Number.isFinite(aE) && aE > aS) return { ...v, s: aS, e: aE, kind: 'actual' as const }
    if (Number.isFinite(sS) && Number.isFinite(sE) && sE > sS) return { ...v, s: sS, e: sE, kind: 'scheduled' as const }
    return { ...v, s: NaN, e: NaN, kind: null }
  })
  const byDate = new Map<string, V[]>()
  for (const v of dated) byDate.set(v.shiftDate, [...(byDate.get(v.shiftDate) ?? []), v])
  const out: Segment[] = []
  const step = travel?.roundToMinutes ?? 1
  const holidays = opts.holidays ?? new Set<string>()
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!.slice().sort((a, b) => (Number.isFinite(a.s) ? a.s : Infinity) - (Number.isFinite(b.s) ? b.s : Infinity) || a.id.localeCompare(b.id))
    day.forEach((v, i) => {
      const prev = i > 0 ? day[i - 1] : null
      if (travel?.enabled && v.travelPaid !== false) {
        const est = opts.estimates?.get(v.id)
        const differentClients = !!(prev && prev.clientId && v.clientId && prev.clientId !== v.clientId)
        const sameKind = !!(prev && prev.kind && prev.kind === v.kind)
        let minutes: number | null = null
        let miles: number | null = v.travelMiles != null ? Number(v.travelMiles) : (est?.miles ?? null)
        if (v.travelMinutes != null) minutes = Number(v.travelMinutes) // the office typed it over any estimate
        else if (prev && differentClients) {
          if (travel.method === 'gap' || !est) {
            if (sameKind) {
              const gap = Math.round((v.s - prev.e) / 60_000)
              if (gap > 0 && (gap <= travel.maxGapMinutes || v.travelPaid === true)) minutes = Math.min(roundUp(gap, step), travel.capMinutes)
            }
          } else if (sameKind) {
            const gap = Math.round((v.s - prev.e) / 60_000)
            if (gap > 0 && (gap <= travel.maxGapMinutes || v.travelPaid === true)) minutes = Math.min(roundUp(est.minutes, step), travel.capMinutes, roundUp(gap, step))
          }
        } else if (!prev && travel.fromHome && est) minutes = Math.min(roundUp(est.minutes, step), travel.capMinutes)
        if (minutes !== null && minutes > 0) out.push({ id: `travel:${v.id}`, kind: 'travel', clientId: v.clientId, date, minutes, reviewId: v.id, miles, holiday: holidays.has(date) })
      }
      const base: Segment = { id: v.id, kind: 'work', clientId: v.clientId, date, minutes: Number(v.minutes), reviewId: v.id, otExempt: !!v.otExempt, holiday: holidays.has(date), sleepover: !!v.isSleepover }
      // An overnight visit is split at the agency's midnight: the part after it belongs to the next day (California Labor Code §510
      // counts each workday on its own; ShiftCare splits at midnight).
      if (opts.splitMidnight && opts.tz && v.kind === 'actual') {
        const startDay = ymdIn(new Date(v.s), opts.tz), endDay = ymdIn(new Date(v.e - 1), opts.tz)
        if (endDay > startDay) {
          const mid = midnightUtc(addDays(startDay, 1), opts.tz)
          const span = v.e - v.s
          const before = Math.round(base.minutes * Math.max(0, Math.min(span, mid - v.s)) / span)
          out.push({ ...base, minutes: before })
          out.push({ ...base, id: `${v.id}:2`, date: addDays(startDay, 1), minutes: base.minutes - before, holiday: holidays.has(addDays(startDay, 1)) })
          return
        }
      }
      out.push(base)
    })
  }
  // a split second half can belong to the next day: keep the order worked by date, then by original order
  return out.map((s, i) => ({ s, i })).sort((a, b) => a.s.date.localeCompare(b.s.date) || a.i - b.i).map((x) => x.s)
}

const isYmdStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

export function sanitizeRules(input: any): { rules: PayRules } | { problem: string; code: string } {
  const stateCode = input?.state === undefined || input?.state === null || String(input.state).trim() === '' ? null : String(input.state).trim().toUpperCase()
  if (stateCode !== null && !stateRule(stateCode)) return { problem: 'Pick a state from the list.', code: 'bad_state' }
  const id = String(input?.overtimeRule ?? (stateCode ? stateRule(stateCode)!.rule : 'federal'))
  if (!(id in OVERTIME_RULES)) return { problem: `Overtime rule must be one of: ${Object.keys(OVERTIME_RULES).join(', ')}.`, code: 'bad_rule' }
  const t = input?.travel ?? {}
  const num = (v: unknown, dflt: number) => (v === undefined || v === null || v === '' ? dflt : Number(v))
  const D = DEFAULT_PAY_RULES
  const maxGap = num(t.maxGapMinutes, D.travel.maxGapMinutes), cap = num(t.capMinutes, D.travel.capMinutes)
  if (!Number.isInteger(maxGap) || maxGap < 1 || maxGap > 240) return { problem: 'The longest gap that counts as travel must be 1 to 240 minutes.', code: 'bad_travel' }
  if (!Number.isInteger(cap) || cap < 1 || cap > 240) return { problem: 'The most travel time paid between two visits must be 1 to 240 minutes.', code: 'bad_travel' }
  const rateCents = t.rateCents === undefined || t.rateCents === null || t.rateCents === '' ? null : Number(t.rateCents)
  if (rateCents !== null && (!Number.isInteger(rateCents) || rateCents < 0 || rateCents > 20_000)) return { problem: 'The travel rate is whole cents an hour, up to $200.', code: 'bad_travel' }
  const method = String(t.method ?? 'gap')
  if (!['gap', 'addresses', 'gps'].includes(method)) return { problem: 'Travel is worked out from the gap, from addresses or from GPS.', code: 'bad_travel' }
  const round = num(t.roundToMinutes, 1)
  if (![1, 5, 10, 15, 30].includes(round)) return { problem: 'Travel minutes round to 1, 5, 10, 15 or 30.', code: 'bad_travel' }
  const holidaysIn = Array.isArray(input?.holidays) ? input.holidays : []
  const holidays: Holiday[] = []
  for (const hd of holidaysIn) {
    if (!isYmdStr(hd?.date)) return { problem: 'Each holiday needs a date (YYYY-MM-DD).', code: 'bad_holiday' }
    const mult = num(hd?.multiplier, 1.5)
    if (!Number.isFinite(mult) || mult < 1 || mult > 3) return { problem: 'A holiday multiplier is 1 to 3 (1.5 = time and a half).', code: 'bad_holiday' }
    if (holidays.some((x) => x.date === hd.date)) return { problem: `${hd.date} is listed twice.`, code: 'bad_holiday' }
    holidays.push({ date: hd.date, label: String(hd?.label ?? '').trim().slice(0, 60) || 'Holiday', multiplier: Math.round(mult * 100) / 100 })
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date))
  const sleepoverCents = num(input?.sleepoverCents, 0)
  if (!Number.isInteger(sleepoverCents) || sleepoverCents < 0 || sleepoverCents > 100_000) return { problem: 'The sleepover amount is whole cents, up to $1,000.', code: 'bad_sleepover' }
  const f = input?.facility ?? {}
  const fWeekly = num(f.weeklyHours, D.facility.weeklyHours)
  const fDaily = f.dailyOtAfterHours === null || f.dailyOtAfterHours === '' ? null : num(f.dailyOtAfterHours, D.facility.dailyOtAfterHours as number)
  if (!Number.isFinite(fWeekly) || fWeekly < 1 || fWeekly > 80) return { problem: 'The facility weekly line is 1 to 80 hours.', code: 'bad_facility' }
  if (fDaily !== null && (!Number.isFinite(fDaily) || fDaily < 1 || fDaily > 24)) return { problem: 'The facility daily line is 1 to 24 hours, or blank.', code: 'bad_facility' }
  const l = input?.limits ?? {}
  const mode = String(l.mode ?? 'off')
  if (!['off', 'warn', 'block'].includes(mode)) return { problem: 'Limits are off, warn or block.', code: 'bad_limits' }
  const lim = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))
  const dailyHours = lim(l.dailyHours), weeklyHours = lim(l.weeklyHours)
  if (dailyHours !== null && (!Number.isFinite(dailyHours) || dailyHours < 1 || dailyHours > 24)) return { problem: 'The daily limit is 1 to 24 hours, or blank.', code: 'bad_limits' }
  if (weeklyHours !== null && (!Number.isFinite(weeklyHours) || weeklyHours < 1 || weeklyHours > 168)) return { problem: 'The weekly limit is 1 to 168 hours, or blank.', code: 'bad_limits' }
  if (mode !== 'off' && dailyHours === null && weeklyHours === null) return { problem: 'Set a daily or a weekly limit, or turn limits off.', code: 'bad_limits' }
  return {
    rules: {
      state: stateCode, overtimeRule: id as OvertimeRuleId,
      travel: { enabled: t.enabled === true, maxGapMinutes: maxGap, capMinutes: cap, rateCents, method: method as TravelMethod, roundToMinutes: round, fromHome: t.fromHome === true, mileageFromVisits: t.mileageFromVisits === true },
      holidays, sleepoverCents, breakPremiums: input?.breakPremiums === true, splitOvernightAtMidnight: input?.splitOvernightAtMidnight === true,
      facility: { weeklyHours: fWeekly, dailyOtAfterHours: fDaily },
      limits: { dailyHours, weeklyHours, mode: mode as LimitMode, capPayable: l.capPayable === true },
    },
  }
}

export function createPayRules(d: CrmDeps) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, PAY_RULES_FEATURE)

  async function stored(companyId: string): Promise<PayRules> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const s = sanitizeRules((row?.settings as any)?.payRules)
    return 'rules' in s ? s.rules : DEFAULT_PAY_RULES
  }

  /** The agency's rules, or null when it does not have the feature (payroll then runs the federal weekly rule as ever). */
  async function forCompany(companyId: string): Promise<PayRules | null> {
    return (await enabled(companyId)) ? stored(companyId) : null
  }

  async function save(companyId: string, rules: PayRules): Promise<void> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), payRules: rules } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  return { enabled, stored, forCompany, save }
}
export type PayRulesModule = ReturnType<typeof createPayRules>
