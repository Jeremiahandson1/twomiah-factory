// Supervisory visits (item 11, row 24): a check-in on each client's care on a regular cycle.
//
//   · THE CYCLE — the AGENCY picks 60 or 90 days (company.settings.supervisoryVisitDays; 90 until it picks); a SERVICE CODE
//     can carry its own days (service_codes.supervisory_interval_days — the shortest among the codes a client is authorised
//     for today wins); one CLIENT can have their own days, or none at all, and that beats both. The next visit is due that
//     many days after the last DONE one — or, before the first, after the client's start date.
//   · WHO DOES IT — whoever the office names when it plans the visit: any active member of the agency's staff (a nurse, a
//     care manager, the owner). The office can also record a visit it did not plan.
//   · PLANNED → DONE — a planned visit sits on the schedule calendar on its day and time; the supervisor named on it is
//     reminded once, in the 24 hours before (in the app, by push, by text and by email); they open it on their phone, start
//     it, fill in the form — the fixed questions plus the agency's own (company.settings.supervisory.questions) — and sign;
//     the client signs too, or the supervisor says why they could not (a phone visit needs no client signature). The agency
//     can require both signatures (company.settings.supervisory.requireSignatures).
//
// Only for a company with the care_supervisory_visits feature (not ready until the owner has tested it).
import { and, eq } from 'drizzle-orm'
import { company, supervisoryVisit, user } from '../../../db/schema/index.ts'
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { claimDueReminders, supervisoryRows } from '../../../data/homecareSupervisory.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import { addDays, fmtClock, hmsIn, ymdIn } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'

export const SUPERVISORY_FEATURE = 'care_supervisory_visits'
export const AGENCY_RULES = [60, 90] as const
export const DEFAULT_RULE = 90
/** "Due soon" starts this many days before the due date. */
export const DUE_SOON_DAYS = 14
/** The agency's own questions: at most this many, each this long. */
export const MAX_QUESTIONS = 20
export const MAX_QUESTION_CHARS = 200
const MAX_ANSWER_CHARS = 2000
export const MAX_SIGNATURE_CHARS = 200_000
/** A planned visit is reminded once, this many hours before it starts. */
export const REMINDER_HOURS = 24

export type SupervisoryStatus = 'overdue' | 'due_soon' | 'ok'
export interface Question { id: string; label: string; kind: 'yes_no' | 'text'; required: boolean }
export interface SupervisorySettings { questions: Question[]; requireSignatures: boolean }

/** overdue = the due date has passed; due_soon = within DUE_SOON_DAYS; otherwise ok. Dates are 'YYYY-MM-DD'. */
export function supervisoryStatus(dueDate: string, today: string): SupervisoryStatus {
  if (dueDate < today) return 'overdue'
  return dueDate <= addDays(today, DUE_SOON_DAYS) ? 'due_soon' : 'ok'
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const text = (v: unknown, max = MAX_ANSWER_CHARS) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const yesNo = (v: unknown): boolean | null => (v === true || v === 'true' || v === 'yes' ? true : v === false || v === 'false' || v === 'no' ? false : null)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'q'

/** The agency's question list, checked: each needs words, a kind (yes/no or written) and a unique id. */
export function checkQuestions(raw: unknown): { questions: Question[] } | { problem: string } {
  if (!Array.isArray(raw)) return { problem: 'Send the questions as a list.' }
  if (raw.length > MAX_QUESTIONS) return { problem: `At most ${MAX_QUESTIONS} questions.` }
  const out: Question[] = []
  const ids = new Set<string>()
  for (const [i, q] of raw.entries()) {
    const label = text((q as any)?.label, 10_000)
    if (!label) return { problem: `Question ${i + 1} has no words.` }
    if (label.length > MAX_QUESTION_CHARS) return { problem: `Question ${i + 1} is too long (at most ${MAX_QUESTION_CHARS} characters).` }
    const kind = (q as any)?.kind
    if (kind !== 'yes_no' && kind !== 'text') return { problem: `Question ${i + 1}: choose "yes or no" or "written answer".` }
    let id = typeof (q as any)?.id === 'string' && /^[a-z0-9_]{1,40}$/.test((q as any).id) ? (q as any).id : slug(label)
    for (let n = 2; ids.has(id); n++) id = `${slug(label).slice(0, 36)}_${n}`
    ids.add(id)
    out.push({ id, label, kind, required: (q as any)?.required === true })
  }
  return { questions: out }
}

const goodSignature = (s: string) => /^data:image\/(svg\+xml|png|jpeg);/.test(s) && s.length <= MAX_SIGNATURE_CHARS

export interface VisitForm {
  visitType: 'home' | 'phone'
  caregiverId: string | null
  clientFeedback: string | null; carePlanFollowed: boolean | null; caregiverFeedback: string | null; concerns: string | null; followUpNotes: string | null
  answers: Array<{ id: string; label: string; kind: string; answer: string | boolean | null }>
  supervisorSignature: string | null; clientSignature: string | null; clientSignReason: string | null
}

/**
 * The visit form, checked against the agency's settings: the fixed questions, the agency's own (a required one must be
 * answered), and the signatures — the supervisor's, and the client's or why not (a phone visit needs no client signature).
 * Something from the visit must be written down.
 */
export function checkVisitForm(b: any, s: SupervisorySettings): { value: VisitForm } | { problem: string; code: string; field?: string } {
  const visitType = b?.visitType === 'phone' ? 'phone' : 'home'
  const given = b?.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : {}
  const answers: VisitForm['answers'] = []
  for (const q of s.questions) {
    const answer = q.kind === 'yes_no' ? yesNo(given[q.id]) : text(given[q.id])
    if (q.required && answer === null) return { problem: `Answer "${q.label}".`, code: 'answer_required', field: `answers.${q.id}` }
    answers.push({ id: q.id, label: q.label, kind: q.kind, answer })
  }
  const value: VisitForm = {
    visitType, caregiverId: b?.caregiverId ? String(b.caregiverId) : null,
    clientFeedback: text(b?.clientFeedback), carePlanFollowed: yesNo(b?.carePlanFollowed), caregiverFeedback: text(b?.caregiverFeedback),
    concerns: text(b?.concerns), followUpNotes: text(b?.followUpNotes), answers,
    supervisorSignature: text(b?.supervisorSignature, MAX_SIGNATURE_CHARS + 1), clientSignature: text(b?.clientSignature, MAX_SIGNATURE_CHARS + 1),
    clientSignReason: text(b?.clientSignReason, 300),
  }
  if (!value.clientFeedback && !value.caregiverFeedback && !value.concerns && !value.followUpNotes && value.carePlanFollowed === null && !answers.some((a) => a.answer !== null)) {
    return { problem: 'Fill in at least one thing from the visit: what the client said, how the caregiver is doing, a concern, or whether the plan is being followed.', code: 'empty_visit' }
  }
  for (const k of ['supervisorSignature', 'clientSignature'] as const) {
    if (value[k] && !goodSignature(value[k]!)) return { problem: 'That signature could not be read. Sign again.', code: 'bad_signature', field: k }
  }
  if (value.clientSignature && value.clientSignReason) return { problem: 'Record either the client\'s signature or why they could not sign, not both.', code: 'signature_or_reason', field: 'clientSignReason' }
  if (visitType === 'phone' && !value.clientSignature && !value.clientSignReason) value.clientSignReason = 'Visit by phone'
  if (s.requireSignatures) {
    if (!value.supervisorSignature) return { problem: 'Sign the visit before saving it.', code: 'signature_required', field: 'supervisorSignature' }
    if (!value.clientSignature && !value.clientSignReason) return { problem: 'Have the client sign, or say why they could not.', code: 'signature_required', field: 'clientSignature' }
  }
  return { value }
}

export function createSupervisory(d: CrmDeps, deps: { time: AgencyTime; notify?: VisitNotify }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, SUPERVISORY_FEATURE)

  async function settingsBlob(companyId: string): Promise<any> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return (row?.settings as any) || {}
  }
  async function writeSettings(companyId: string, patch: (s: any) => any) {
    const s = await settingsBlob(companyId)
    await d.db.update(company).set({ settings: patch(s), updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  /** The agency's rule in days: 60 or 90. */
  async function rule(companyId: string): Promise<number> {
    const n = Number((await settingsBlob(companyId)).supervisoryVisitDays)
    return (AGENCY_RULES as readonly number[]).includes(n) ? n : DEFAULT_RULE
  }

  async function setRule(companyId: string, days: number): Promise<void> {
    await writeSettings(companyId, (s) => ({ ...s, supervisoryVisitDays: days }))
  }

  /** The agency's own questions and whether both signatures are required. */
  async function settings(companyId: string): Promise<SupervisorySettings> {
    const own = (await settingsBlob(companyId)).supervisory || {}
    const checked = checkQuestions(own.questions ?? [])
    return { questions: 'questions' in checked ? checked.questions : [], requireSignatures: own.requireSignatures === true }
  }

  async function setSettings(companyId: string, b: any): Promise<{ problem: string } | SupervisorySettings> {
    const now = await settings(companyId)
    let questions = now.questions
    if (b?.questions !== undefined) {
      const checked = checkQuestions(b.questions)
      if ('problem' in checked) return checked
      questions = checked.questions
    }
    const requireSignatures = b?.requireSignatures !== undefined ? b.requireSignatures === true : now.requireSignatures
    await writeSettings(companyId, (s) => ({ ...s, supervisory: { ...(s.supervisory || {}), questions, requireSignatures } }))
    return { questions, requireSignatures }
  }

  /** Each client with a rule: status, due date, how many days over / until, and the next planned visit. Most overdue first. */
  async function dueList(companyId: string) {
    const [days, today] = await Promise.all([rule(companyId), deps.time.today(companyId)])
    const tz = await deps.time.timezone(companyId)
    const rows = await supervisoryRows(d.db, companyId, days, today)
    return {
      ruleDays: days, today,
      clients: rows.map((r: any) => {
        const status = supervisoryStatus(r.dueDate, today)
        const { plannedAt, ...rest } = r
        return {
          ...rest, status, daysOverdue: status === 'overdue' ? daysBetween(r.dueDate, today) : 0, daysUntilDue: status === 'overdue' ? 0 : daysBetween(today, r.dueDate),
          plannedTime: plannedAt ? fmtClock(new Date(plannedAt), tz) : null, plannedHm: plannedAt ? hmsIn(new Date(plannedAt), tz).slice(0, 5) : null,
        }
      }),
    }
  }

  /** The dashboard's two numbers ({0,0} when the agency does not have the feature). */
  async function counts(companyId: string): Promise<{ overdue: number; dueSoon: number }> {
    if (!(await enabled(companyId))) return { overdue: 0, dueSoon: 0 }
    const { clients } = await dueList(companyId)
    return { overdue: clients.filter((c: any) => c.status === 'overdue').length, dueSoon: clients.filter((c: any) => c.status === 'due_soon').length }
  }

  /** A day and a time on the agency's clock, checked: today or later, and not already past. */
  async function when(companyId: string, date: unknown, time: unknown): Promise<{ problem: string; field: string } | { date: string; at: Date }> {
    if (typeof date !== 'string' || !DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { problem: 'Choose the day of the visit.', field: 'date' }
    if (typeof time !== 'string' || !TIME_RE.test(time)) return { problem: 'Choose the time of the visit (like 10:00).', field: 'time' }
    const tz = await deps.time.timezone(companyId)
    const at = zonedWallTimeToUtc(date, time, tz)
    if (at.getTime() < Date.now()) return { problem: 'That time has already passed. Choose a later one.', field: 'time' }
    return { date, at }
  }

  /** The person who will do the visit: an active member of this agency. */
  async function supervisorOf(companyId: string, id: unknown) {
    if (typeof id !== 'string' || !id) return null
    const [row] = await d.db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive }).from(user)
      .where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    return row && row.isActive !== false ? row : null
  }

  /**
   * The supervisor named on a planned visit, reminded once in the 24 hours before it (claimed first, so never twice): a notice
   * in the app, a push and a text (their own notification settings apply), and an email. Returns how many visits were reminded.
   */
  async function scanReminders(at: Date = new Date()): Promise<number> {
    if (!deps.notify) return 0
    let sent = 0
    for (const v of await claimDueReminders(d.db, at, REMINDER_HOURS)) {
      try {
        if (!(await enabled(v.companyId))) continue
        const tz = await deps.time.timezone(v.companyId)
        const [who] = await d.db.select({ phone: user.phone, email: user.email, firstName: user.firstName }).from(user).where(eq(user.id, v.supervisorId)).limit(1)
        const day = ymdIn(new Date(v.plannedAt), tz) === ymdIn(at, tz) ? 'today' : 'tomorrow'
        const what = `${v.visitType === 'phone' ? 'Supervisory call' : 'Supervisory visit'} with ${v.clientFirstName} ${v.clientLastName} ${day} at ${fmtClock(new Date(v.plannedAt), tz)}`
        await deps.notify.notifyUser(v.companyId, v.supervisorId, 'supervisory_visit', 'Supervisory visit coming up', `${what}.`)
        await deps.notify.sendCaregiverAlert({ companyId: v.companyId, userId: v.supervisorId, alertType: 'supervisory_reminder', channel: 'push', body: what, payload: { title: 'Supervisory visit', body: what, tag: `supervisory-${v.id}`, data: { type: 'supervisory_visit', visitId: v.id } } })
        await deps.notify.sendCaregiverAlert({ companyId: v.companyId, userId: v.supervisorId, alertType: 'supervisory_reminder', channel: 'sms', phone: who?.phone, body: `${what}. Open it in the app to start.` })
        if (who?.email) {
          try { await d.services.emailService.sendRaw({ to: who.email, subject: 'Supervisory visit coming up', html: `<p>${esc(what)}.</p><p>Open it in the app to start the visit and fill in the form.</p>` }) }
          catch (e: any) { d.logger.error('[supervisory] reminder email', { error: e?.message }) }
        }
        sent++
      } catch (e: any) { d.logger.error('[supervisory] reminder', { error: e?.message }) }
    }
    return sent
  }

  /** Mark a done visit's form onto the row: the values to write. */
  function doneValues(f: VisitForm, visitDate: string, from: 'office' | 'phone') {
    const now = new Date()
    return {
      status: 'done', visitDate, visitType: f.visitType, caregiverId: f.caregiverId, clientFeedback: f.clientFeedback, carePlanFollowed: f.carePlanFollowed,
      caregiverFeedback: f.caregiverFeedback, concerns: f.concerns, followUpNotes: f.followUpNotes, answers: f.answers,
      supervisorSignature: f.supervisorSignature, clientSignature: f.clientSignature, clientSignReason: f.clientSignature ? null : f.clientSignReason,
      signedAt: f.supervisorSignature || f.clientSignature ? now : null, completedAt: now, recordedFrom: from,
    }
  }

  return { enabled, rule, setRule, settings, setSettings, dueList, counts, when, supervisorOf, scanReminders, doneValues, table: supervisoryVisit }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export type Supervisory = ReturnType<typeof createSupervisory>
