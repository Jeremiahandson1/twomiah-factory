// Pay rules (item 2, docs/parity/homecare-payroll.md): when overtime and double time are owed, and travel time between visits.
//
// OFF (the default, and for every agency without care_payroll_rules) payroll is exactly what it always was: hours over 40 in
// a work week are overtime (core/payrollPay.ts). ON, the agency chooses the rule its state requires:
//   federal    over 40 in the work week at 1.5x
//   california over 8 in a day at 1.5x, over 12 at 2x; the 7th straight day of the work week: first 8 hours 1.5x, then 2x; and
//              over 40 in the week at 1.5x for hours not already overtime (no stacking)
//   alaska     over 8 in a day at 1.5x; over 40 in the week at 1.5x for hours not already overtime
//   colorado   over 12 in a day at 1.5x; over 40 in the week at 1.5x for hours not already overtime
// Other states with daily overtime (Nevada's depends on the wage) are not built; the office keeps "federal" and fixes the
// pay by hand, as today. Not modelled for any state: the blended "regular rate" when a week has more than one rate,
// meal/rest-break premiums, consecutive-hours rules, holiday pay.
//
// Travel: time between two visits on the same day at DIFFERENT clients is paid when the gap is no longer than the agency's limit
// (an hour by default), up to its cap (30 minutes by default). It is work time, so it counts toward the day's and the week's
// hours (and overtime). It is only worked out when both visits have times of the same kind (both punched, or both scheduled).
//
// The unit is a SEGMENT: a visit's minutes, or the travel minutes before it, in the order they happened. Each minute is
// classified once, so a client's margin (core/margin.ts) can take its share of the same overtime payroll pays. Pure.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { PayableVisit } from '../../../data/homecarePayRules.ts'
import type { CrmDeps } from '../../deps.ts'

export const PAY_RULES_FEATURE = 'care_payroll_rules'

export type OvertimeRuleId = 'federal' | 'california' | 'alaska' | 'colorado'
export interface OvertimeRule { id: OvertimeRuleId; label: string; dailyOtAfterHours: number | null; dailyDoubleAfterHours: number | null; seventhDay: boolean }
export const OVERTIME_RULES: Record<OvertimeRuleId, OvertimeRule> = {
  federal: { id: 'federal', label: 'Federal: over 40 hours a week', dailyOtAfterHours: null, dailyDoubleAfterHours: null, seventhDay: false },
  california: { id: 'california', label: 'California: daily overtime, double time, 7th day', dailyOtAfterHours: 8, dailyDoubleAfterHours: 12, seventhDay: true },
  alaska: { id: 'alaska', label: 'Alaska: over 8 hours a day', dailyOtAfterHours: 8, dailyDoubleAfterHours: null, seventhDay: false },
  colorado: { id: 'colorado', label: 'Colorado: over 12 hours a day', dailyOtAfterHours: 12, dailyDoubleAfterHours: null, seventhDay: false },
}

export interface TravelRule { enabled: boolean; maxGapMinutes: number; capMinutes: number }
export interface PayRules { overtimeRule: OvertimeRuleId; travel: TravelRule }
export const DEFAULT_PAY_RULES: PayRules = { overtimeRule: 'federal', travel: { enabled: false, maxGapMinutes: 60, capMinutes: 30 } }

export interface Segment { id: string; kind: 'work' | 'travel'; clientId: string | null; date: string; minutes: number }
export interface Classified extends Segment { regular: number; overtime: number; doubleTime: number }

const WEEKLY_MINUTES = 40 * 60
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/**
 * Classify one work week's segments (ONE caregiver, in the order worked, dates ascending) as regular, overtime and double time
 * minutes under `rule`. Each segment's three numbers add up to its minutes.
 */
export function classifyWeek(segments: Segment[], rule: OvertimeRule, weeklyMinutes = WEEKLY_MINUTES): Classified[] {
  const dayTotals = new Map<string, number>()
  for (const s of segments) dayTotals.set(s.date, (dayTotals.get(s.date) ?? 0) + s.minutes)
  const dates = [...dayTotals.keys()].sort()
  // the 7th day only counts when every one of the week's 7 days was worked
  const seventh = rule.seventhDay && dates.length === 7 ? dates[6] : null
  const otAt = (date: string) => (date === seventh ? 0 : rule.dailyOtAfterHours === null ? Infinity : rule.dailyOtAfterHours * 60)
  const dtAt = (date: string) => (date === seventh ? 8 * 60 : rule.dailyDoubleAfterHours === null ? Infinity : rule.dailyDoubleAfterHours * 60)

  const done = new Map<string, number>()
  const out: Classified[] = segments.map((s) => {
    const pos = done.get(s.date) ?? 0
    done.set(s.date, pos + s.minutes)
    const ot0 = otAt(s.date), dt0 = Math.max(dtAt(s.date), ot0)
    return {
      ...s,
      regular: overlap(pos, pos + s.minutes, 0, ot0),
      overtime: overlap(pos, pos + s.minutes, ot0, dt0),
      doubleTime: overlap(pos, pos + s.minutes, dt0, Infinity),
    }
  })
  // hours over the weekly line that are not already overtime: the LATER regular minutes of the week become overtime
  let regularSoFar = 0
  for (const s of out) {
    const keep = Math.min(s.regular, Math.max(0, weeklyMinutes - regularSoFar))
    s.overtime += s.regular - keep
    s.regular = keep
    regularSoFar += keep
  }
  return out
}

const stamp = (v: string | null) => (v ? Date.parse(`${v}Z`) : NaN)

/** One week's visits of one caregiver as segments in the order worked, with the travel between visits when the rule pays it. */
export function buildSegments(visits: PayableVisit[], travel: TravelRule | null): Segment[] {
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
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!.slice().sort((a, b) => (Number.isFinite(a.s) ? a.s : Infinity) - (Number.isFinite(b.s) ? b.s : Infinity) || a.id.localeCompare(b.id))
    day.forEach((v, i) => {
      const prev = i > 0 ? day[i - 1] : null
      if (travel?.enabled && prev && prev.kind && prev.kind === v.kind && prev.clientId && v.clientId && prev.clientId !== v.clientId) {
        const gap = Math.round((v.s - prev.e) / 60_000)
        if (gap > 0 && gap <= travel.maxGapMinutes) {
          const paid = Math.min(gap, travel.capMinutes)
          if (paid > 0) out.push({ id: `travel:${v.id}`, kind: 'travel', clientId: v.clientId, date, minutes: paid })
        }
      }
      out.push({ id: v.id, kind: 'work', clientId: v.clientId, date, minutes: Number(v.minutes) })
    })
  }
  return out
}

export function sanitizeRules(input: any): { rules: PayRules } | { problem: string; code: string } {
  const id = String(input?.overtimeRule ?? 'federal')
  if (!(id in OVERTIME_RULES)) return { problem: `Overtime rule must be one of: ${Object.keys(OVERTIME_RULES).join(', ')}.`, code: 'bad_rule' }
  const t = input?.travel ?? {}
  const num = (v: unknown, dflt: number) => (v === undefined || v === null || v === '' ? dflt : Number(v))
  const maxGap = num(t.maxGapMinutes, DEFAULT_PAY_RULES.travel.maxGapMinutes), cap = num(t.capMinutes, DEFAULT_PAY_RULES.travel.capMinutes)
  if (!Number.isInteger(maxGap) || maxGap < 1 || maxGap > 240) return { problem: 'The longest gap that counts as travel must be 1 to 240 minutes.', code: 'bad_travel' }
  if (!Number.isInteger(cap) || cap < 1 || cap > 240) return { problem: 'The most travel time paid between two visits must be 1 to 240 minutes.', code: 'bad_travel' }
  return { rules: { overtimeRule: id as OvertimeRuleId, travel: { enabled: t.enabled === true, maxGapMinutes: maxGap, capMinutes: cap } } }
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
