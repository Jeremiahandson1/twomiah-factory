// The EVV task report (row 5, care_required_tasks): for every finished visit in a window, was every task assigned to that visit done,
// or skipped / refused with a reason? A visit's assigned tasks are the client's active tasks that BELONG to it — a Tuesday task
// belongs only to a Tuesday visit, an AM task to a morning visit (core/taskDays.ts); a weekly task already done on another visit that
// week is accounted for ("done earlier this week"). Each visit says "complete" or names what is missing, so the office (or an auditor)
// sees at a glance which visits have gaps — and the CSV is the same list.
import { and, asc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { clients, clientTaskTemplates, shiftTaskCompletions, timeEntries, user as users, visitSignature } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, isYmd, ymdIn, type AgencyTime } from './agencyTime.ts'
import { taskBelongsTo, visitWhen } from './taskDays.ts'
import { reasonLabel } from './visitSignature.ts'

export const TASK_REPORT_MAX_DAYS = 92
export const TASK_REPORT_MAX_VISITS = 2000

export type TaskState = 'done' | 'done_earlier' | 'skipped' | 'refused' | 'not_recorded'
export const STATE_LABELS: Record<TaskState, string> = {
  done: 'Done', done_earlier: 'Done earlier this week', skipped: 'Skipped (with reason)', refused: 'Client refused (with reason)', not_recorded: 'Not recorded',
}
/** Is a task accounted for? Done, done earlier this week, or skipped / refused with a written reason. */
export const accountedFor = (s: TaskState) => s !== 'not_recorded'

export interface ReportTask { taskId: string; taskName: string; required: boolean; state: TaskState; stateLabel: string; reason: string | null }
export interface ReportVisit {
  timeEntryId: string; visitDate: string; startTime: Date; endTime: Date | null; clientId: string; clientName: string; caregiverId: string; caregiverName: string
  tasks: ReportTask[]; assigned: number; accounted: number; missing: number; complete: boolean
  signature: 'signed' | 'reason' | 'none'; signatureReason: string | null
}

/** Monday-start week key of a local date, to find "another visit this week". */
function weekKey(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(ymd, -((dow + 6) % 7))
}

export function createTaskReport(d: CrmDeps, deps: { time: AgencyTime }) {
  async function run(companyId: string, q: { from: string; to: string; clientId?: string; caregiverId?: string; onlyGaps?: boolean }): Promise<{ visits: ReportVisit[]; summary: any; truncated: boolean }> {
    const tz = await deps.time.timezone(companyId)
    const { from, before } = await deps.time.range(companyId, q.from, q.to)
    const visitRows = await d.db.select({
      id: timeEntries.id, clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId, startTime: timeEntries.startTime, endTime: timeEntries.endTime,
      cf: clients.firstName, cl: clients.lastName, uf: users.firstName, ul: users.lastName,
    }).from(timeEntries)
      .innerJoin(clients, eq(clients.id, timeEntries.clientId)).innerJoin(users, eq(users.id, timeEntries.caregiverId))
      .where(and(eq(timeEntries.companyId, companyId), isNotNull(timeEntries.endTime), gte(timeEntries.startTime, from!), lt(timeEntries.startTime, before!),
        q.clientId ? eq(timeEntries.clientId, q.clientId) : undefined, q.caregiverId ? eq(timeEntries.caregiverId, q.caregiverId) : undefined))
      .orderBy(asc(timeEntries.startTime)).limit(TASK_REPORT_MAX_VISITS + 1)
    const truncated = visitRows.length > TASK_REPORT_MAX_VISITS
    const visits = visitRows.slice(0, TASK_REPORT_MAX_VISITS)
    if (!visits.length) return { visits: [], summary: summarise([]), truncated }

    const clientIds: string[] = [...new Set<string>(visits.map((v: any) => String(v.clientId)))]
    const tasks = await d.db.select().from(clientTaskTemplates)
      .where(and(eq(clientTaskTemplates.companyId, companyId), eq(clientTaskTemplates.isActive, true), inArray(clientTaskTemplates.clientId, clientIds)))
      .orderBy(asc(clientTaskTemplates.sortOrder), asc(clientTaskTemplates.createdAt))
    const byClient = new Map<string, any[]>()
    for (const t of tasks) byClient.set(t.clientId, [...(byClient.get(t.clientId) || []), t])

    const entryIds = visits.map((v: any) => v.id)
    const marks = entryIds.length ? await d.db.select().from(shiftTaskCompletions).where(and(eq(shiftTaskCompletions.companyId, companyId), inArray(shiftTaskCompletions.timeEntryId, entryIds))) : []
    const markOf = new Map<string, any>(marks.map((m: any) => [`${m.timeEntryId}|${m.taskTemplateId}`, m]))
    // For weekly tasks: every completed mark on any visit of these clients in the (wider) window, to see "done earlier this week".
    const weeklyIds = tasks.filter((t: any) => t.cadence === 'weekly').map((t: any) => t.id)
    const doneWeeks = new Map<string, Set<string>>() // taskId → week keys
    if (weeklyIds.length) {
      const wide = await d.db.select({ taskId: shiftTaskCompletions.taskTemplateId, at: timeEntries.startTime }).from(shiftTaskCompletions)
        .innerJoin(timeEntries, eq(timeEntries.id, shiftTaskCompletions.timeEntryId))
        .where(and(eq(shiftTaskCompletions.companyId, companyId), eq(shiftTaskCompletions.status, 'completed'), inArray(shiftTaskCompletions.taskTemplateId, weeklyIds),
          gte(timeEntries.startTime, new Date(from!.getTime() - 7 * 86_400_000)), lt(timeEntries.startTime, new Date(before!.getTime() + 7 * 86_400_000))))
      for (const w of wide) doneWeeks.set(w.taskId, (doneWeeks.get(w.taskId) || new Set()).add(weekKey(ymdIn(new Date(w.at), tz))))
    }
    const sigs = await d.db.select().from(visitSignature).where(and(eq(visitSignature.companyId, companyId), inArray(visitSignature.timeEntryId, entryIds)))
    const sigOf = new Map<string, any>(sigs.map((s: any) => [s.timeEntryId, s]))

    const out: ReportVisit[] = []
    for (const v of visits as any[]) {
      const when = visitWhen(new Date(v.startTime), v.endTime ? new Date(v.endTime) : null, tz)
      const visitDate = ymdIn(new Date(v.startTime), tz)
      const rows: ReportTask[] = []
      for (const t of byClient.get(v.clientId) || []) {
        const m = markOf.get(`${v.id}|${t.id}`)
        const belongs = taskBelongsTo(t, when)
        // A task that does not belong to this visit is not assigned to it — unless the caregiver recorded it anyway.
        if (!belongs && !m) continue
        let state: TaskState = 'not_recorded'
        let reason: string | null = null
        const note = m?.notes && String(m.notes).trim() ? String(m.notes).trim() : null
        if (m?.status === 'completed') state = 'done'
        else if ((m?.status === 'skipped' || m?.status === 'refused') && note) { state = m.status; reason = note }
        else if (t.cadence === 'weekly' && doneWeeks.get(t.id)?.has(weekKey(visitDate))) state = 'done_earlier'
        rows.push({ taskId: t.id, taskName: t.taskName, required: t.isRequired, state, stateLabel: STATE_LABELS[state], reason })
      }
      const accounted = rows.filter((r) => accountedFor(r.state)).length
      const s = sigOf.get(v.id)
      const rec: ReportVisit = {
        timeEntryId: v.id, visitDate, startTime: v.startTime, endTime: v.endTime, clientId: v.clientId, clientName: `${v.cf} ${v.cl}`.trim(), caregiverId: v.caregiverId, caregiverName: `${v.uf} ${v.ul}`.trim(),
        tasks: rows, assigned: rows.length, accounted, missing: rows.length - accounted, complete: accounted === rows.length,
        signature: s?.signatureImage ? 'signed' : s?.reasonCode ? 'reason' : 'none', signatureReason: s?.reasonCode ? reasonLabel(s.reasonCode) : null,
      }
      if (!q.onlyGaps || !rec.complete) out.push(rec)
    }
    return { visits: out, summary: summarise(out), truncated }
  }

  function summarise(visits: ReportVisit[]) {
    return {
      visits: visits.length, visitsComplete: visits.filter((v) => v.complete).length, visitsWithGaps: visits.filter((v) => !v.complete).length,
      tasksAssigned: visits.reduce((a, v) => a + v.assigned, 0), tasksAccountedFor: visits.reduce((a, v) => a + v.accounted, 0),
      tasksNotRecorded: visits.reduce((a, v) => a + v.missing, 0),
    }
  }

  return { run }
}
export type TaskReport = ReturnType<typeof createTaskReport>

/** One line per task on every visit (a visit with no assigned tasks is one line saying so), as CSV. */
export function reportCsv(visits: ReportVisit[], tz: string): string {
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe }
  const head = ['Visit date', 'Start', 'End', 'Client', 'Caregiver', 'Task', 'Required', 'Result', 'Reason', 'Visit complete', 'Client signature']
  const t = (x: Date | null) => (x ? new Date(x).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : '')
  const lines = [head.map(cell).join(',')]
  for (const v of visits) {
    const sig = v.signature === 'signed' ? 'Signed' : v.signature === 'reason' ? `Not signed: ${v.signatureReason}` : 'None'
    const base = [v.visitDate, t(v.startTime), t(v.endTime), v.clientName, v.caregiverName]
    if (!v.tasks.length) lines.push([...base, '(no tasks assigned)', '', '', '', 'Yes', sig].map(cell).join(','))
    for (const r of v.tasks) lines.push([...base, r.taskName, r.required ? 'Yes' : 'No', r.stateLabel, r.reason ?? '', v.complete ? 'Yes' : 'No', sig].map(cell).join(','))
  }
  return lines.join('\n') + '\n'
}

export const isRangeOk = (from?: string, to?: string) => isYmd(from) && isYmd(to) && from! <= to! && addDays(from!, TASK_REPORT_MAX_DAYS - 1) >= to!
