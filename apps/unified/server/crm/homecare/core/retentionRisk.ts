// Which caregivers may be about to leave (row 13, care_caregiver_surveys; docs/parity/homecare-margin-turnover.md), from OUR OWN
// signals — nothing predicted by a model nobody can explain. Each signal adds points and a sentence, so the office sees the score
// AND why:
//   · hours drop         the last 4 weeks against the 8 before (a caregiver whose hours fell by a quarter or more)
//   · call-outs          absences and visits cancelled as "caregiver called out" in the last 60 days
//   · missed visits      no-show alerts in the last 60 days
//   · survey             the latest satisfaction score (low), or surveys left unanswered for two weeks
//   · tenure             the first 90 days, when most caregivers who leave do; the next 90 a little
//   · gone quiet         no visit in 14 / 30 days although they have worked before
//   · under their wish   working under half the hours they asked for
// The score is 0–100 (higher = more likely to leave); the band is low (< 25) / watch (25–49) / high (50+). Snapshots are written once a
// day by the survey scan, so the office sees each caregiver's trend. Pure scoring (scoreRisk), tested alone.
import { and, eq, lt } from 'drizzle-orm'
import { caregiverRiskSnapshot } from '../../../db/schema/index.ts'
import { activeCaregivers, riskHistory, riskSignals } from '../../../data/homecareSurveys.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'

export interface RiskSignals {
  hoursLast4Weeks: number; hoursPrevious8Weeks: number; lastVisit: string | null; calloutsSixtyDays: number; missedSixtyDays: number
  latestScore: number | null; latestScoreOn: string | null; unansweredSurveys: number; hoursWanted: number | null; hired: string
}
export interface RiskReason { signal: string; label: string; points: number; detail: string }
export type Band = 'low' | 'watch' | 'high'
export const BAND_LABELS: Record<Band, string> = { low: 'Low risk', watch: 'Watch', high: 'At risk' }
export const bandOf = (score: number): Band => (score >= 50 ? 'high' : score >= 25 ? 'watch' : 'low')
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const h1 = (n: number) => Math.round(n * 10) / 10

/** The score and its reasons for one caregiver as of `today`. Pure. */
export function scoreRisk(s: RiskSignals, today: string): { score: number; band: Band; reasons: RiskReason[] } {
  const reasons: RiskReason[] = []
  const lastWeekly = s.hoursLast4Weeks / 4, prevWeekly = s.hoursPrevious8Weeks / 8
  const tenureDays = daysBetween(s.hired, today)
  if (prevWeekly >= 4 && lastWeekly < prevWeekly * 0.75) {
    const drop = 1 - lastWeekly / prevWeekly
    const points = drop >= 0.5 ? 30 : 15
    reasons.push({ signal: 'hours_drop', label: 'Hours dropped', points, detail: `Working ${h1(lastWeekly)} h a week over the last 4 weeks, down from ${h1(prevWeekly)} h over the 8 before (${Math.round(drop * 100)}% less)` })
  }
  if (s.calloutsSixtyDays > 0) {
    const points = Math.min(30, s.calloutsSixtyDays * 10)
    reasons.push({ signal: 'callouts', label: 'Called out', points, detail: `${s.calloutsSixtyDays} call-out${s.calloutsSixtyDays === 1 ? '' : 's'} in the last 60 days` })
  }
  if (s.missedSixtyDays > 0) {
    const points = Math.min(20, s.missedSixtyDays * 10)
    reasons.push({ signal: 'missed', label: 'Missed visits', points, detail: `${s.missedSixtyDays} missed visit${s.missedSixtyDays === 1 ? '' : 's'} (no-show) in the last 60 days` })
  }
  if (s.latestScore !== null) {
    if (s.latestScore < 300) reasons.push({ signal: 'survey_low', label: 'Low satisfaction', points: 25, detail: `Scored ${(s.latestScore / 100).toFixed(1)} of 5 on the survey of ${s.latestScoreOn}` })
    else if (s.latestScore < 350) reasons.push({ signal: 'survey_middling', label: 'Middling satisfaction', points: 10, detail: `Scored ${(s.latestScore / 100).toFixed(1)} of 5 on the survey of ${s.latestScoreOn}` })
  }
  if (s.unansweredSurveys > 0) reasons.push({ signal: 'survey_unanswered', label: 'Survey not answered', points: 10, detail: `${s.unansweredSurveys} survey${s.unansweredSurveys === 1 ? '' : 's'} left unanswered for two weeks or more` })
  if (tenureDays < 90) reasons.push({ signal: 'new', label: 'First 90 days', points: 15, detail: `Hired ${tenureDays} day${tenureDays === 1 ? '' : 's'} ago — most caregivers who leave do so in their first 90 days` })
  else if (tenureDays < 180) reasons.push({ signal: 'newish', label: 'Under six months', points: 5, detail: `Hired ${tenureDays} days ago` })
  if (s.lastVisit && tenureDays >= 14) {
    const idle = daysBetween(s.lastVisit, today)
    if (idle > 30) reasons.push({ signal: 'quiet', label: 'Gone quiet', points: 30, detail: `No visit in ${idle} days (last one ${s.lastVisit})` })
    else if (idle > 14) reasons.push({ signal: 'quiet', label: 'Gone quiet', points: 20, detail: `No visit in ${idle} days (last one ${s.lastVisit})` })
  }
  if (s.hoursWanted !== null && s.hoursWanted > 0 && lastWeekly < s.hoursWanted * 0.5 && tenureDays >= 28) {
    reasons.push({ signal: 'under_wish', label: 'Under the hours they want', points: 10, detail: `Asked for ${s.hoursWanted} h a week, getting ${h1(lastWeekly)}` })
  }
  const score = Math.min(100, reasons.reduce((t, r) => t + r.points, 0))
  reasons.sort((a, b) => b.points - a.points)
  return { score, band: bandOf(score), reasons }
}

export function createRetentionRisk(d: CrmDeps, deps: { time: AgencyTime }) {
  const asSignals = (r: any): RiskSignals => ({
    hoursLast4Weeks: Number(r.hoursLast4Weeks) || 0, hoursPrevious8Weeks: Number(r.hoursPrevious8Weeks) || 0, lastVisit: r.lastVisit ? String(r.lastVisit).slice(0, 10) : null,
    calloutsSixtyDays: Number(r.calloutsSixtyDays) || 0, missedSixtyDays: Number(r.missedSixtyDays) || 0,
    latestScore: r.latestScore === null || r.latestScore === undefined ? null : Number(r.latestScore), latestScoreOn: r.latestScoreOn ?? null,
    unansweredSurveys: Number(r.unansweredSurveys) || 0, hoursWanted: r.hoursWanted === null || r.hoursWanted === undefined ? null : Number(r.hoursWanted), hired: String(r.hired),
  })

  /** Every active caregiver's risk now, highest first, with the reasons and where they sit. */
  async function current(companyId: string, today?: string) {
    const day = today ?? await deps.time.today(companyId)
    const tz = await deps.time.timezone(companyId)
    const [people, signals] = await Promise.all([activeCaregivers(d.db, companyId), riskSignals(d.db, companyId, day, tz)])
    const byId = new Map(signals.map((s: any) => [String(s.id), s]))
    return people.map((p: any) => {
      const raw = byId.get(String(p.id)) ?? {}
      const scored = scoreRisk(asSignals({ ...raw, hired: p.hired }), day)
      return {
        caregiverId: String(p.id), name: `${p.firstName} ${p.lastName}`.trim(), hired: p.hired, branchName: p.branchName ?? null, team: p.team ?? null,
        managerUserId: p.managerUserId ?? null, managerName: p.managerFirst ? `${p.managerFirst} ${p.managerLast ?? ''}`.trim() : null,
        score: scored.score, band: scored.band, bandLabel: BAND_LABELS[scored.band], reasons: scored.reasons,
      }
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  }

  /** Write today's snapshot for every active caregiver (once a day; a later run the same day replaces it). Returns how many. */
  async function snapshot(companyId: string, today?: string): Promise<number> {
    const day = today ?? await deps.time.today(companyId)
    const rows = await current(companyId, day)
    for (const r of rows) {
      await d.db.insert(caregiverRiskSnapshot).values({ companyId, caregiverId: r.caregiverId, asOf: day, score: r.score, band: r.band, reasons: r.reasons })
        .onConflictDoUpdate({ target: [caregiverRiskSnapshot.caregiverId, caregiverRiskSnapshot.asOf], set: { score: r.score, band: r.band, reasons: r.reasons } })
    }
    return rows.length
  }

  /** The trend: per caregiver their scores by day; for the agency the average score and the number at risk by day. */
  async function trend(companyId: string, days = 90, caregiverId: string | null = null): Promise<any[]> {
    const today = await deps.time.today(companyId)
    const rows = await riskHistory(d.db, companyId, addDays(today, -(days - 1)), caregiverId)
    if (caregiverId) return rows.map((r: any) => ({ asOf: r.asOf, score: Number(r.score), band: r.band, bandLabel: BAND_LABELS[r.band as Band] ?? r.band }))
    const byDay = new Map<string, { scores: number[]; high: number; watch: number }>()
    for (const r of rows) { const k = String(r.asOf); const cur = byDay.get(k) ?? { scores: [], high: 0, watch: 0 }; cur.scores.push(Number(r.score)); if (r.band === 'high') cur.high++; if (r.band === 'watch') cur.watch++; byDay.set(k, cur) }
    return [...byDay].map(([asOf, v]) => ({ asOf, averageScore: Math.round(v.scores.reduce((t, x) => t + x, 0) / v.scores.length), atRisk: v.high, watch: v.watch, caregivers: v.scores.length }))
  }

  /** Clear old snapshots (kept for a year). */
  async function prune(companyId: string, today: string) {
    await d.db.delete(caregiverRiskSnapshot).where(and(eq(caregiverRiskSnapshot.companyId, companyId), lt(caregiverRiskSnapshot.asOf, addDays(today, -366))))
  }

  return { current, snapshot, trend, prune }
}
export type RetentionRisk = ReturnType<typeof createRetentionRisk>
