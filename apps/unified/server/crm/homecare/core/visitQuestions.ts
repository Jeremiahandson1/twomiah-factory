// Questions at clock-in and clock-out (item 3, care_visit_questions; not ready until the owner has tried it on a phone): the
// agency writes them (safety at the door, how the client is, did you take a break), the caregiver answers them as they clock in
// or out, the answers are kept on the visit, and an answer the agency marked as worrying tells the office.
//
//   · A question is yes/no, a short text, or one pick from a list; it applies at clock-in, clock-out, or both; it may be required.
//   · A required question must be answered before a LIVE clock-in or clock-out is accepted (409 questions_required, naming each).
//     A punch saved on the phone without signal is already a fact: it is recorded, and what was answered is kept, never refused.
//   · The prompt is copied onto the answer, so a visit reads the same after the question is edited or deleted.
//   · An answer equal to the question's "tell the office" answer is flagged on the record and told to the office, once.
import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { clients, user as users, visitAnswer, visitQuestion } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { VisitNotify } from './visitNotify.ts'

export const VISIT_QUESTIONS_FEATURE = 'care_visit_questions'
export const KINDS = ['yes_no', 'text', 'choice'] as const
export const PHASES = ['clock_in', 'clock_out', 'both'] as const
export type Phase = 'clock_in' | 'clock_out'
export const MAX_ANSWER = 1000

export interface Question { id: string; prompt: string; kind: string; options: unknown; phase: string; required: boolean; flagOn: string | null }
export interface CleanAnswer { questionId: string; answer: string }

const norm = (v: unknown) => String(v ?? '').trim()

/** What a question says is wrong with a given answer (null when fine) and the tidied answer. Pure. */
export function tidyAnswer(q: Pick<Question, 'kind' | 'options'>, raw: unknown): { answer: string } | { problem: string } {
  if (q.kind === 'yes_no') {
    const v = raw === true ? 'yes' : raw === false ? 'no' : norm(raw).toLowerCase()
    return v === 'yes' || v === 'no' ? { answer: v } : { problem: 'Answer yes or no.' }
  }
  if (q.kind === 'choice') {
    const opts = Array.isArray(q.options) ? q.options.map(String) : []
    const v = opts.find((o) => o.toLowerCase() === norm(raw).toLowerCase())
    return v ? { answer: v } : { problem: 'Pick one of the choices.' }
  }
  const v = norm(raw)
  if (!v) return { problem: 'Write an answer.' }
  return v.length > MAX_ANSWER ? { problem: `Keep the answer under ${MAX_ANSWER} characters.` } : { answer: v }
}

/**
 * The answers given against the questions asked. `problems` is { questionId: sentence } — a bad answer, or (when `enforce`)
 * a required question left blank. Answers to questions not asked now are ignored. Pure.
 */
export function checkAnswers(questions: Question[], given: unknown, enforce: boolean): { clean: CleanAnswer[]; problems: Record<string, string> } {
  const byId = new Map<string, unknown>()
  for (const a of Array.isArray(given) ? given : []) if (a && typeof a === 'object' && (a as any).questionId) byId.set(String((a as any).questionId), (a as any).answer)
  const clean: CleanAnswer[] = []
  const problems: Record<string, string> = {}
  for (const q of questions) {
    const raw = byId.get(q.id)
    const blank = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())
    if (blank) { if (q.required && enforce) problems[q.id] = 'This question needs an answer.'; continue }
    const t = tidyAnswer(q, raw)
    if ('problem' in t) { if (enforce || q.required) problems[q.id] = t.problem; continue }
    clean.push({ questionId: q.id, answer: t.answer })
  }
  return { clean, problems }
}

export const isFlagged = (q: Pick<Question, 'flagOn'>, answer: string) => !!q.flagOn && q.flagOn.trim().toLowerCase() === answer.trim().toLowerCase()

export function createVisitQuestions(d: CrmDeps, deps: { notify: VisitNotify }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, VISIT_QUESTIONS_FEATURE)

  /** The questions asked at this clock event, in the agency's order ([] when the agency does not have the feature). */
  async function activeFor(companyId: string, phase: Phase): Promise<Question[]> {
    if (!(await enabled(companyId))) return []
    return d.db.select({ id: visitQuestion.id, prompt: visitQuestion.prompt, kind: visitQuestion.kind, options: visitQuestion.options, phase: visitQuestion.phase, required: visitQuestion.required, flagOn: visitQuestion.flagOn })
      .from(visitQuestion)
      .where(and(eq(visitQuestion.companyId, companyId), eq(visitQuestion.isActive, true), or(eq(visitQuestion.phase, phase), eq(visitQuestion.phase, 'both'))))
      .orderBy(asc(visitQuestion.sortOrder), asc(visitQuestion.createdAt))
  }

  /** Check what came with a punch. `enforce` is false for a punch saved offline. */
  async function gate(companyId: string, phase: Phase, given: unknown, enforce: boolean) {
    const questions = await activeFor(companyId, phase)
    return { questions, ...checkAnswers(questions, given, enforce) }
  }

  /** Keep the answers on the visit; tell the office of each flagged one (once: a repeat of the same answer is not stored again). */
  async function record(companyId: string, entry: { id: string; clientId: string; caregiverId: string }, phase: Phase, questions: Question[], clean: CleanAnswer[], answeredById: string | null) {
    if (!clean.length) return
    const byId = new Map(questions.map((q) => [q.id, q]))
    const [cl] = await d.db.select({ f: clients.firstName, l: clients.lastName }).from(clients).where(eq(clients.id, entry.clientId)).limit(1)
    const [cg] = await d.db.select({ f: users.firstName, l: users.lastName }).from(users).where(eq(users.id, entry.caregiverId)).limit(1)
    for (const a of clean) {
      const q = byId.get(a.questionId)!
      const flagged = isFlagged(q, a.answer)
      const [row] = await d.db.insert(visitAnswer).values({
        companyId, timeEntryId: entry.id, questionId: q.id, prompt: q.prompt, phase, answer: a.answer, flagged, answeredById,
      }).onConflictDoNothing().returning({ id: visitAnswer.id })
      if (row && flagged) {
        await deps.notify.notifyAdmins(companyId, 'visit_answer_flag', 'A visit answer needs a look',
          `${cg ? `${cg.f} ${cg.l}` : 'A caregiver'} at ${cl ? `${cl.f} ${cl.l}` : 'a client'}'s ${phase === 'clock_in' ? 'clock-in' : 'clock-out'}: "${q.prompt}" — ${a.answer}.`)
      }
    }
  }

  const answersFor = (companyId: string, timeEntryIds: string[]) => timeEntryIds.length
    ? d.db.select().from(visitAnswer).where(and(eq(visitAnswer.companyId, companyId), inArray(visitAnswer.timeEntryId, timeEntryIds)))
    : Promise.resolve([] as any[])

  return { enabled, activeFor, gate, record, answersFor }
}
export type VisitQuestions = ReturnType<typeof createVisitQuestions>
