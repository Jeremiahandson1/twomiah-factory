// The visit optimizer (row 15, care_visit_optimizer) — pure; the route supplies the rows. Modelled on AlayaCare's Visit Optimizer:
// the scheduler filters the vacant visits to fill, picks how much each objective matters, runs it, reviews the proposals and then
// assigns them in bulk or offers them to the proposed caregivers.
//
// The six objectives (AlayaCare's: minimise travel time, maximise continuity of care, maximise skills matching, minimise wait times,
// optimise for daily hours, optimise for weekly hours), each weighted 0 (ignore) to 3 (matters most):
//   · travel      — minutes from where the caregiver is just before (their previous visit that day, else home), straight line × 1.3
//                   at 30 mph (core/distance.ts estimateLeg), so it works without a maps key;
//   · continuity  — completed visits with this client before (3 points each, up to 30);
//   · skills      — the client's needs against the caregiver (core/matchTraits.ts: skills, certifications, gender, language, home,
//                   travel limit — a must-have miss never reaches here, the route leaves that caregiver out);
//   · waitTime    — the idle gap between the caregiver's previous visit that day and this one (a short gap is better);
//   · dailyHours  — hours that day once this visit is added (over 8 counts heavily);
//   · weeklyHours — hours that week against the caregiver's own maximum (over 40 counts heavily).
//
// Visits are filled one at a time (most urgent, then soonest) and each placement is remembered, so two proposals never give the
// same caregiver overlapping visits and the hours, travel and gaps of later proposals count the earlier ones.
import { estimateLeg, toPoint } from './distance.ts'

export const OBJECTIVES = ['travel', 'continuity', 'skills', 'waitTime', 'dailyHours', 'weeklyHours'] as const
export type Objective = typeof OBJECTIVES[number]
export type Weights = Record<Objective, number>
export const DEFAULT_WEIGHTS: Weights = { travel: 2, continuity: 2, skills: 3, waitTime: 1, dailyHours: 1, weeklyHours: 1 }
export const OBJECTIVE_LABELS: Record<Objective, string> = {
  travel: 'Least travel time', continuity: 'Continuity of care', skills: 'Best skills match',
  waitTime: 'Least waiting between visits', dailyHours: 'Balanced daily hours', weeklyHours: 'Balanced weekly hours',
}

/** Weights as sent: each objective a whole number 0–3; anything else keeps the default. */
export function normWeights(v: unknown): Weights {
  const out = { ...DEFAULT_WEIGHTS }
  if (v && typeof v === 'object') {
    for (const k of OBJECTIVES) {
      const n = Number((v as any)[k])
      if (Number.isInteger(n) && n >= 0 && n <= 3) out[k] = n
    }
  }
  return out
}

export interface DayVisit { date: string; start: string; end: string; lat?: unknown; lng?: unknown }
export interface OptShift { id: string; date: string; start: string; end: string; hours: number; clientLat?: unknown; clientLng?: unknown }
export interface OptCandidate {
  id: string; name: string
  /** Why this caregiver may not take this visit at all (time off, a clash, a must-have miss…); null when they may. */
  blocked: string | null
  homeLat?: unknown; homeLng?: unknown
  visitsWithClient: number
  /** core/matchTraits.ts scoreDelta, and its reasons. */
  traitDelta: number; traitReasons: string[]
  weeklyHours: number; maxHours: number
}
export interface Scored {
  caregiverId: string; name: string; total: number
  travelMinutes: number; continuityVisits: number; waitMinutes: number | null; dayHours: number; weekHours: number
  reasons: string[]
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)

/** One caregiver for one visit: the score under these weights, and what it is made of. */
export function scoreFor(shift: OptShift, c: OptCandidate, day: DayVisit[], extraWeekHours: number, w: Weights): Scored {
  const sMin = toMin(shift.start)
  const before = day.filter((v) => toMin(v.end) <= sMin).sort((a, b) => toMin(b.end) - toMin(a.end))[0] ?? null
  const from = (before && toPoint({ lat: before.lat, lng: before.lng })) || toPoint({ lat: c.homeLat, lng: c.homeLng })
  const to = toPoint({ lat: shift.clientLat, lng: shift.clientLng })
  const travelMinutes = from && to ? estimateLeg(from, to).minutes : 30          // unknown: assume half an hour
  const waitMinutes = before ? Math.max(0, sMin - toMin(before.end) - travelMinutes) : null
  const dayHours = day.reduce((s, v) => s + (toMin(v.end) - toMin(v.start)) / 60, 0) + shift.hours
  const weekHours = c.weeklyHours + extraWeekHours + shift.hours
  const max = c.maxHours > 0 ? c.maxHours : 40

  const parts: Record<Objective, number> = {
    travel: -travelMinutes / 2,
    continuity: Math.min(c.visitsWithClient * 3, 30),
    skills: c.traitDelta / 4,
    waitTime: waitMinutes === null ? 0 : -Math.min(waitMinutes, 240) / 8,
    dailyHours: -Math.max(0, dayHours - 8) * 10 - dayHours,
    weeklyHours: -(weekHours / max) * 20 - (weekHours > 40 ? 15 : 0),
  }
  const total = OBJECTIVES.reduce((s, k) => s + parts[k] * w[k], 0)

  const reasons: string[] = [`${Math.round(travelMinutes)} min travel${before ? ' from the visit before' : ''}`]
  if (c.visitsWithClient) reasons.push(`${c.visitsWithClient} visit${c.visitsWithClient === 1 ? '' : 's'} with this client`)
  if (waitMinutes !== null) reasons.push(`${Math.round(waitMinutes)} min wait after the visit before`)
  reasons.push(`${dayHours.toFixed(1)} h that day`, `${weekHours.toFixed(1)} h that week`)
  reasons.push(...c.traitReasons)
  return { caregiverId: c.id, name: c.name, total: Math.round(total * 10) / 10, travelMinutes: Math.round(travelMinutes), continuityVisits: c.visitsWithClient, waitMinutes: waitMinutes === null ? null : Math.round(waitMinutes), dayHours: Math.round(dayHours * 10) / 10, weekHours: Math.round(weekHours * 10) / 10, reasons }
}

export interface Proposal { shiftId: string; best: Scored | null; alternatives: Scored[]; unfilledBecause: string[] }

/**
 * Fill the visits in the order given. `candidatesFor(shift)` is every active caregiver for that visit (blocked ones carry why);
 * `dayOf(caregiverId, date)` what they already have that day. A caregiver over their weekly maximum or clashing with an earlier
 * proposal is not proposed.
 */
export function optimize(shifts: OptShift[], candidatesFor: (s: OptShift) => OptCandidate[], dayOf: (caregiverId: string, date: string) => DayVisit[], w: Weights): Proposal[] {
  const placed = new Map<string, DayVisit[]>()          // caregiverId → visits proposed here
  const extraWeek = new Map<string, number>()
  const out: Proposal[] = []
  for (const s of shifts) {
    const scored: Scored[] = []
    const why = new Map<string, number>()
    for (const c of candidatesFor(s)) {
      if (c.blocked) { why.set(c.blocked, (why.get(c.blocked) || 0) + 1); continue }
      const mine = (placed.get(c.id) || []).filter((v) => v.date === s.date)
      if (mine.some((v) => overlaps(v, s))) { why.set('Already proposed for a visit then', (why.get('Already proposed for a visit then') || 0) + 1); continue }
      const extra = extraWeek.get(c.id) || 0
      if (c.weeklyHours + extra + s.hours > (c.maxHours > 0 ? c.maxHours : 40)) { why.set('Over their weekly maximum', (why.get('Over their weekly maximum') || 0) + 1); continue }
      scored.push(scoreFor(s, c, [...dayOf(c.id, s.date), ...mine], extra, w))
    }
    scored.sort((a, b) => b.total - a.total)
    const best = scored[0] ?? null
    if (best) {
      placed.set(best.caregiverId, [...(placed.get(best.caregiverId) || []), { date: s.date, start: s.start, end: s.end, lat: s.clientLat, lng: s.clientLng }])
      extraWeek.set(best.caregiverId, (extraWeek.get(best.caregiverId) || 0) + s.hours)
    }
    out.push({ shiftId: s.id, best, alternatives: scored.slice(1, 4), unfilledBecause: best ? [] : [...why.entries()].map(([k, n]) => `${k} (${n})`) })
  }
  return out
}
