// Caregiver satisfaction surveys (row 13, care_caregiver_surveys, not ready until the owner has tried it; docs/parity/homecare-margin-turnover.md).
//
// The agency writes a survey (its own questions: a 1–5 scale, yes/no, free text) and says WHEN it is asked: after a caregiver's
// first visit with a client, N days after they were hired (90 by default), or every N days. The scan (with the visit jobs, every
// 5 minutes) finds the points that fell due, asks each once (the request's key is unique per point), and tells the caregiver on the
// phone — a push through the one door every caregiver alert goes through (their own notification settings apply) and a notice in
// the app. The caregiver answers from the phone (More › "How is it going?"). A score under the survey's alert line tells the office
// at once. Results read by branch, manager or caregiver, and as a trend. The same scan writes the day's retention-risk snapshot.
import { and, desc, eq, isNull } from 'drizzle-orm'
import { caregiverSurvey, caregiverSurveyRequest } from '../../../db/schema/index.ts'
import { activeCaregivers, firstVisitsWithClients, surveyAnswers, surveyCounts } from '../../../data/homecareSurveys.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'
import type { RetentionRisk } from './retentionRisk.ts'

export const SURVEY_FEATURE = 'care_caregiver_surveys'
/** How far back a point that fell due is still asked (a scan that was off for a week catches up; an old point is not asked out of the blue). */
export const CATCH_UP_DAYS = 14
export const TRIGGERS = [
  { trigger: 'first_visit_with_client', label: 'After the first visit with a client' },
  { trigger: 'days_after_hire', label: 'A number of days after they were hired' },
  { trigger: 'every_days', label: 'Every so many days' },
] as const
export const triggerLabel = (t: string, days?: number | null) => t === 'first_visit_with_client' ? 'After the first visit with a client' : t === 'days_after_hire' ? `${days ?? 90} days after they were hired` : t === 'every_days' ? `Every ${days ?? 90} days` : t
export const QUESTION_KINDS = [{ kind: 'scale', label: '1 to 5' }, { kind: 'yes_no', label: 'Yes or no' }, { kind: 'text', label: 'In their own words' }] as const
export interface Question { id: string; text: string; kind: 'scale' | 'yes_no' | 'text' }
/** The survey the office can start from with one click (AxisCare's asks much the same). */
export const STANDARD_QUESTIONS: Question[] = [
  { id: 'q1', text: 'How happy are you working with us?', kind: 'scale' },
  { id: 'q2', text: 'Do you feel supported by the office?', kind: 'scale' },
  { id: 'q3', text: 'Are your hours and schedule what you want?', kind: 'scale' },
  { id: 'q4', text: 'Do you feel safe and respected on your visits?', kind: 'scale' },
  { id: 'q5', text: 'Would you recommend working here to a friend?', kind: 'yes_no' },
  { id: 'q6', text: 'Anything we should know?', kind: 'text' },
]

export interface SurveyInput { name: string; trigger: string; days: number | null; questions: Question[]; alertBelow: number; isActive: boolean }
/** A survey body checked. A problem names the box. */
export function checkSurvey(raw: any): { input: SurveyInput } | { problem: string; fields: Record<string, string> } {
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : ''
  if (!name) return { problem: 'Give the survey a name.', fields: { name: 'Name it' } }
  if (!TRIGGERS.some((t) => t.trigger === raw.trigger)) return { problem: 'Pick when the survey is asked.', fields: { trigger: 'Pick one' } }
  let days: number | null = null
  if (raw.trigger !== 'first_visit_with_client') {
    days = Number(raw.days ?? 90)
    if (!(Number.isInteger(days) && days >= 1 && days <= 730)) return { problem: 'Days must be a whole number from 1 to 730.', fields: { days: '1 to 730' } }
  }
  const questions: Question[] = []
  for (const [i, q] of (Array.isArray(raw.questions) ? raw.questions : []).entries()) {
    const text = typeof q?.text === 'string' ? q.text.trim().slice(0, 300) : ''
    if (!text) return { problem: `Question ${i + 1} has no wording.`, fields: { questions: `Question ${i + 1}: write it` } }
    if (!QUESTION_KINDS.some((k) => k.kind === q.kind)) return { problem: `Question ${i + 1}: pick how it is answered.`, fields: { questions: `Question ${i + 1}: pick a kind` } }
    questions.push({ id: typeof q.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(q.id) ? q.id : `q${i + 1}`, text, kind: q.kind })
  }
  if (!questions.length) return { problem: 'Add at least one question.', fields: { questions: 'Add a question' } }
  if (new Set(questions.map((q) => q.id)).size !== questions.length) return { problem: 'Two questions share an id.', fields: { questions: 'Ids must differ' } }
  const alertBelow = Number(raw.alertBelow ?? 3)
  if (!(Number.isInteger(alertBelow) && alertBelow >= 1 && alertBelow <= 5)) return { problem: 'The alert line is a score from 1 to 5.', fields: { alertBelow: '1 to 5' } }
  return { input: { name, trigger: raw.trigger, days, questions, alertBelow, isActive: raw.isActive !== false } }
}

/** A caregiver's answers checked against the questions: every question answered in its kind. Returns the answers, the score and the comment. */
export function checkAnswers(questions: Question[], raw: any): { answers: Record<string, number | boolean | string>; score: number | null; comment: string | null } | { problem: string; fields: Record<string, string> } {
  const src = raw && typeof raw === 'object' ? raw : {}
  const answers: Record<string, number | boolean | string> = {}
  const scales: number[] = []
  let comment: string | null = null
  for (const q of questions) {
    const v = src[q.id]
    if (q.kind === 'scale') {
      const n = Number(v)
      if (!(Number.isInteger(n) && n >= 1 && n <= 5)) return { problem: `Answer "${q.text}" with 1 to 5.`, fields: { [q.id]: 'Pick 1 to 5' } }
      answers[q.id] = n; scales.push(n)
    } else if (q.kind === 'yes_no') {
      if (v !== true && v !== false && v !== 'yes' && v !== 'no') return { problem: `Answer "${q.text}" yes or no.`, fields: { [q.id]: 'Yes or no' } }
      answers[q.id] = v === true || v === 'yes'
    } else {
      const text = typeof v === 'string' ? v.trim().slice(0, 2000) : ''
      answers[q.id] = text
      if (text && !comment) comment = text
    }
  }
  return { answers, score: scales.length ? Math.round((scales.reduce((t, n) => t + n, 0) / scales.length) * 100) : null, comment }
}

/** The points of one survey that are due for one caregiver as of `today`: { pointKey, dueOn, reason, clientId }. Pure. */
export function duePoints(survey: { trigger: string; days: number | null }, cg: { hired: string }, today: string, firstVisits: { clientId: string; firstVisit: string; clientName: string }[]): { pointKey: string; dueOn: string; reason: string; clientId: string | null }[] {
  const floor = addDays(today, -CATCH_UP_DAYS)
  if (survey.trigger === 'first_visit_with_client') {
    return firstVisits.filter((v) => v.firstVisit <= today && v.firstVisit >= floor).map((v) => ({ pointKey: `client:${v.clientId}`, dueOn: v.firstVisit, reason: `Your first visit with ${v.clientName}`, clientId: v.clientId }))
  }
  const n = survey.days ?? 90
  if (survey.trigger === 'days_after_hire') {
    const dueOn = addDays(cg.hired, n)
    return dueOn <= today && dueOn >= floor ? [{ pointKey: `hire:${n}`, dueOn, reason: `${n} days with the agency`, clientId: null }] : []
  }
  if (survey.trigger === 'every_days') {
    const elapsed = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cg.hired}T00:00:00Z`)) / 86_400_000)
    if (elapsed < n) return []
    const dueOn = addDays(cg.hired, Math.floor(elapsed / n) * n)
    return dueOn >= floor ? [{ pointKey: `cycle:${dueOn}`, dueOn, reason: 'Your regular check-in', clientId: null }] : []
  }
  return []
}

export function createCaregiverSurveys(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify; risk: RetentionRisk }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, SURVEY_FEATURE)
  const mine = (companyId: string, id: string) => and(eq(caregiverSurvey.companyId, companyId), eq(caregiverSurvey.id, id))
  const present = (s: any) => ({ ...s, triggerLabel: triggerLabel(s.trigger, s.days) })

  const list = async (companyId: string): Promise<any[]> => (await d.db.select().from(caregiverSurvey).where(eq(caregiverSurvey.companyId, companyId)).orderBy(caregiverSurvey.name)).map(present)
  const get = async (companyId: string, id: string) => { const [s] = await d.db.select().from(caregiverSurvey).where(mine(companyId, id)).limit(1); return s ? present(s) : null }
  async function save(companyId: string, by: string, input: SurveyInput, id?: string) {
    if (id) { const [row] = await d.db.update(caregiverSurvey).set({ ...input, updatedAt: new Date() }).where(mine(companyId, id)).returning(); return row ? present(row) : null }
    const [row] = await d.db.insert(caregiverSurvey).values({ companyId, createdById: by, ...input }).returning()
    return present(row)
  }
  const remove = (companyId: string, id: string) => d.db.delete(caregiverSurvey).where(mine(companyId, id))

  /** Ask one caregiver one survey at one point: the row (once per point), the push and the in-app notice. Returns whether it was new. */
  async function ask(companyId: string, survey: any, caregiverId: string, point: { pointKey: string; dueOn: string; reason: string; clientId: string | null }): Promise<boolean> {
    const inserted = await d.db.insert(caregiverSurveyRequest).values({ companyId, surveyId: survey.id, caregiverId, clientId: point.clientId, pointKey: point.pointKey, reason: point.reason, dueOn: point.dueOn, sentAt: new Date() })
      .onConflictDoNothing({ target: [caregiverSurveyRequest.surveyId, caregiverSurveyRequest.caregiverId, caregiverSurveyRequest.pointKey] }).returning({ id: caregiverSurveyRequest.id })
    if (!inserted.length) return false
    const id = inserted[0].id
    const body = `${point.reason} — a few questions about how it is going (${survey.name}).`
    await deps.notify.notifyUser(companyId, caregiverId, 'caregiver_survey', 'How is it going?', `${body} Open More › How is it going? in the app.`)
    const pushed = await deps.notify.sendCaregiverAlert({ companyId, userId: caregiverId, alertType: 'survey', channel: 'push', body, payload: { title: 'How is it going?', body, tag: `survey-${id}`, data: { type: 'caregiver_survey', id } } })
    if (pushed) await d.db.update(caregiverSurveyRequest).set({ pushed: true }).where(eq(caregiverSurveyRequest.id, id))
    return true
  }

  /** One company's due survey points, and the day's risk snapshot. Returns how many surveys were sent. */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    if (!(await enabled(companyId))) return 0
    const { date: today } = await deps.time.now(companyId, at)
    const surveys = (await list(companyId)).filter((s) => s.isActive)
    let sent = 0
    if (surveys.length) {
      const tz = await deps.time.timezone(companyId)
      const people = await activeCaregivers(d.db, companyId)
      const needFirst = surveys.some((s) => s.trigger === 'first_visit_with_client')
      const firsts = needFirst ? await firstVisitsWithClients(d.db, companyId, addDays(today, -CATCH_UP_DAYS), tz) : []
      for (const s of surveys) {
        for (const p of people) {
          const mineFirsts = firsts.filter((f: any) => String(f.caregiverId) === String(p.id)).map((f: any) => ({ clientId: String(f.clientId), firstVisit: String(f.firstVisit).slice(0, 10), clientName: `${f.clientFirst} ${f.clientLast}`.trim() }))
          for (const point of duePoints(s, { hired: String(p.hired) }, today, mineFirsts)) {
            try { if (await ask(companyId, s, String(p.id), point)) sent++ } catch (e: any) { d.logger.error('[caregiver-surveys] ask', { error: e?.message }) }
          }
        }
      }
    }
    try { await deps.risk.snapshot(companyId, today); await deps.risk.prune(companyId, today) } catch (e: any) { d.logger.error('[caregiver-surveys] risk snapshot', { error: e?.message }) }
    return sent
  }
  async function scanCaregiverSurveys(at: Date = new Date()): Promise<number> {
    const rows = await d.db.selectDistinct({ companyId: caregiverSurvey.companyId }).from(caregiverSurvey).where(eq(caregiverSurvey.isActive, true))
    let sent = 0
    for (const r of rows) { try { sent += await scanCompany(String(r.companyId), at) } catch (e: any) { d.logger.error('[caregiver-surveys] one company', { companyId: r.companyId, error: e?.message }) } }
    return sent
  }

  /** The caregiver's own: what is waiting for them (with the questions) and what they answered lately. */
  async function mine_(companyId: string, caregiverId: string) {
    const rows = await d.db.select({ r: caregiverSurveyRequest, s: caregiverSurvey }).from(caregiverSurveyRequest).innerJoin(caregiverSurvey, eq(caregiverSurvey.id, caregiverSurveyRequest.surveyId))
      .where(and(eq(caregiverSurveyRequest.companyId, companyId), eq(caregiverSurveyRequest.caregiverId, caregiverId))).orderBy(desc(caregiverSurveyRequest.dueOn)).limit(50)
    return {
      pending: rows.filter((x: any) => !x.r.answeredAt).map((x: any) => ({ id: x.r.id, surveyName: x.s.name, reason: x.r.reason, dueOn: x.r.dueOn, questions: x.s.questions })),
      answered: rows.filter((x: any) => x.r.answeredAt).slice(0, 10).map((x: any) => ({ id: x.r.id, surveyName: x.s.name, reason: x.r.reason, answeredAt: x.r.answeredAt, score: x.r.score })),
    }
  }

  /** The caregiver answers one request. A low score tells the office at once. */
  async function answer(companyId: string, caregiverId: string, requestId: string, raw: any): Promise<{ ok: true; score: number | null; alerted: boolean } | { ok: false; status: 400 | 404 | 409; problem: string; fields?: Record<string, string> }> {
    const [row] = await d.db.select({ r: caregiverSurveyRequest, s: caregiverSurvey }).from(caregiverSurveyRequest).innerJoin(caregiverSurvey, eq(caregiverSurvey.id, caregiverSurveyRequest.surveyId))
      .where(and(eq(caregiverSurveyRequest.companyId, companyId), eq(caregiverSurveyRequest.id, requestId), eq(caregiverSurveyRequest.caregiverId, caregiverId))).limit(1)
    if (!row) return { ok: false, status: 404, problem: 'That survey is not yours or does not exist.' }
    if (row.r.answeredAt) return { ok: false, status: 409, problem: 'You already answered this one. Thank you.' }
    const checked = checkAnswers(row.s.questions as Question[], raw)
    if ('problem' in checked) return { ok: false, status: 400, problem: checked.problem, fields: checked.fields }
    const low = checked.score !== null && checked.score < Number(row.s.alertBelow) * 100
    await d.db.update(caregiverSurveyRequest).set({ answeredAt: new Date(), answers: checked.answers, score: checked.score, comment: checked.comment, alertedAt: low ? new Date() : null }).where(eq(caregiverSurveyRequest.id, requestId))
    if (low) {
      const people = await activeCaregivers(d.db, companyId)
      const p = people.find((x: any) => String(x.id) === caregiverId)
      const name = p ? `${p.firstName} ${p.lastName}`.trim() : 'A caregiver'
      await deps.notify.notifyAdmins(companyId, 'caregiver_survey_low', 'A caregiver scored low on their survey', `${name} scored ${((checked.score as number) / 100).toFixed(1)} of 5 on "${row.s.name}" (${row.r.reason}).${checked.comment ? ` They wrote: "${checked.comment.slice(0, 200)}"` : ''} Open Caregiver satisfaction & retention.`)
    }
    return { ok: true, score: checked.score, alerted: low }
  }

  /** Results over a window: by branch, by manager, by caregiver, the monthly trend, the response rate, every answer. */
  async function results(companyId: string, start: string, end: string) {
    const [rows, counts] = await Promise.all([surveyAnswers(d.db, companyId, start, end), surveyCounts(d.db, companyId, start, end)])
    const scored = rows.filter((r: any) => r.score !== null && r.score !== undefined)
    const avg = (list: any[]) => (list.length ? Math.round(list.reduce((t: number, r: any) => t + Number(r.score), 0) / list.length) / 100 : null)
    const group = (key: (r: any) => { id: string | null; name: string }) => {
      const m = new Map<string, { id: string | null; name: string; rows: any[] }>()
      for (const r of scored) { const k = key(r); const id = k.id ?? ''; if (!m.has(id)) m.set(id, { id: k.id, name: k.name, rows: [] }); m.get(id)!.rows.push(r) }
      return [...m.values()].map((g) => ({ id: g.id, name: g.name, answered: g.rows.length, averageScore: avg(g.rows), low: g.rows.filter((r) => r.alerted).length })).sort((a, b) => (a.averageScore ?? 9) - (b.averageScore ?? 9))
    }
    const byMonth = new Map<string, any[]>()
    for (const r of scored) { const k = String(r.answeredOn).slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), r]) }
    return {
      period: { start, end },
      summary: { sent: counts.sent, answered: counts.answered, responseRatePercent: counts.sent ? Math.round((counts.answered / counts.sent) * 1000) / 10 : null, averageScore: avg(scored), low: scored.filter((r: any) => r.alerted).length },
      byBranch: group((r) => ({ id: r.branchId ?? null, name: r.branchName ?? 'No branch' })),
      byManager: group((r) => ({ id: r.managerUserId ?? null, name: r.managerFirst ? `${r.managerFirst} ${r.managerLast ?? ''}`.trim() : 'No manager' })),
      byCaregiver: group((r) => ({ id: String(r.caregiverId), name: `${r.firstName} ${r.lastName}`.trim() })),
      trend: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => ({ month, answered: list.length, averageScore: avg(list), low: list.filter((r) => r.alerted).length })),
      answers: rows.map((r: any) => ({ id: r.id, surveyName: r.surveyName, caregiverId: String(r.caregiverId), name: `${r.firstName} ${r.lastName}`.trim(), reason: r.reason, answeredOn: r.answeredOn, score: r.score === null ? null : Number(r.score) / 100, comment: r.comment, alerted: !!r.alerted, branchName: r.branchName ?? null, managerName: r.managerFirst ? `${r.managerFirst} ${r.managerLast ?? ''}`.trim() : null, answers: r.answers })),
    }
  }

  /** The retention dashboard: the satisfaction trend, the response rate, who is at risk and the risk trend. */
  async function dashboard(companyId: string, days = 180) {
    const today = await deps.time.today(companyId)
    const start = addDays(today, -(days - 1))
    const [res, risk, riskTrend] = await Promise.all([results(companyId, start, today), deps.risk.current(companyId, today), deps.risk.trend(companyId, Math.min(days, 90))])
    return {
      period: { start, end: today }, satisfaction: { summary: res.summary, trend: res.trend, byBranch: res.byBranch, byManager: res.byManager },
      risk: { atRisk: risk.filter((r) => r.band === 'high').length, watch: risk.filter((r) => r.band === 'watch').length, caregivers: risk.length, list: risk.filter((r) => r.band !== 'low'), all: risk, trend: riskTrend },
    }
  }
  /** What the Reports & dashboards "retention" tile shows. */
  async function dashboardTile(companyId: string, today: string) {
    if (!(await enabled(companyId))) return { withheld: 'feature' }
    const [res, risk] = await Promise.all([results(companyId, addDays(today, -89), today), deps.risk.current(companyId, today)])
    return { latestAverage: res.summary.averageScore, responseRatePercent: res.summary.responseRatePercent, atRisk: risk.filter((r) => r.band === 'high').length, watch: risk.filter((r) => r.band === 'watch').length, topReasons: risk.filter((r) => r.band === 'high').slice(0, 5).map((r) => ({ name: r.name, score: r.score, reason: r.reasons[0]?.detail ?? '' })) }
  }

  /** Pending requests the office may see (who has not answered). */
  async function outstanding(companyId: string) {
    const rows = await d.db.select({ r: caregiverSurveyRequest, s: caregiverSurvey }).from(caregiverSurveyRequest).innerJoin(caregiverSurvey, eq(caregiverSurvey.id, caregiverSurveyRequest.surveyId))
      .where(and(eq(caregiverSurveyRequest.companyId, companyId), isNull(caregiverSurveyRequest.answeredAt))).orderBy(desc(caregiverSurveyRequest.dueOn)).limit(200)
    const ids = [...new Set(rows.map((x: any) => String(x.r.caregiverId)))]
    const people = ids.length ? (await activeCaregivers(d.db, companyId)).filter((p: any) => ids.includes(String(p.id))) : []
    const name = new Map(people.map((p: any) => [String(p.id), `${p.firstName} ${p.lastName}`.trim()]))
    return rows.map((x: any) => ({ id: x.r.id, surveyName: x.s.name, caregiverId: String(x.r.caregiverId), name: name.get(String(x.r.caregiverId)) ?? 'Caregiver', reason: x.r.reason, dueOn: x.r.dueOn, sentAt: x.r.sentAt, pushed: x.r.pushed }))
  }
  /** Ask a caregiver a survey now, by hand (the office's "Send now"). */
  async function askNow(companyId: string, surveyId: string, caregiverIds: string[]): Promise<{ problem: string } | { sent: number }> {
    const survey = await get(companyId, surveyId)
    if (!survey) return { problem: 'That survey does not exist.' }
    const today = await deps.time.today(companyId)
    const people = (await activeCaregivers(d.db, companyId)).filter((p: any) => caregiverIds.includes(String(p.id)))
    let sent = 0
    for (const p of people) if (await ask(companyId, survey, String(p.id), { pointKey: `manual:${today}`, dueOn: today, reason: 'The office would like to hear from you', clientId: null })) sent++
    return { sent }
  }
  return { enabled, list, get, save, remove, scanCompany, scanCaregiverSurveys, mine: mine_, answer, results, dashboard, dashboardTile, outstanding, askNow }
}
export type CaregiverSurveys = ReturnType<typeof createCaregiverSurveys>
