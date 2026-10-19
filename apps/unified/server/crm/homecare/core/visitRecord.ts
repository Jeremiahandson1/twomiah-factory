// One record per scheduled visit — the visit's note and its care-task statuses — and how the caregiver's own entries
// reach it. Moved from templates/crm-homecare/backend/src/services/visitRecord.ts; the SQL is in
// server/data/homecareEvv.ts.
//
//   · A visit is client + agency date + scheduled start + caregiver (the shared schedule engine).
//   · Its NOTE lives in ONE place: visit_documentation.note. A caregiver who adds a note while CLOCKED IN for that
//     client writes it to the same row (appendVisitNote); a note with no visit to belong to is a general client note.
//   · Its TASK STATUSES are what the caregiver recorded on the punch (shift_task_completions). Those are facts from the
//     visit: the office's bulk fill and saved snapshot carry them and never overwrite them.
//   · The punch that belongs to a visit is the payroll / Client Hours rule: same caregiver and client, clocked in on
//     the visit's agency day, the visit's schedule when the punch names one, else the nearest scheduled start.
//
// Changes: every read and write is the company's (its id comes first; the visit note row carries company_id); the rows
// are camelCase (visitDate, startTime, caregiverId, scheduleId, startLocal, taskName …).
import {
  scheduledVisitRows, clientPunchRows, openPunchRow, recordedTaskRows, appendVisitNoteRow,
} from '../../../data/homecareEvv.ts'
import type { Q } from '../../../data/homecareCore.ts'
import type { CrmDeps } from '../../deps.ts'
import { hms } from './scheduleOccurrences.ts'
import type { AgencyTime } from './agencyTime.ts'

// The system's own markers in time_entries.notes are not a caregiver's words.
export const SYSTEM_NOTE_MARKERS = ['(Auto-transition: schedule shift change)', '(Auto-closed: caregiver clocked into new client)']

export const RECORDED_STATUSES = ['completed', 'skipped', 'refused']

export const visitKey = (v: any) => `${v.visitDate}|${hms(v.startTime)}|${v.caregiverId}`

const secs = (t: unknown) => { const h = hms(t); if (!h) return 0; const [a, b, c] = h.split(':').map(Number); return a * 3600 + b * 60 + c }

/** The punch that belongs to `visit` (see header), or null. Each punch answers one visit. */
export function matchPunch(visit: any, punches: any[], taken: Set<string> = new Set()) {
  const cands = punches.filter((p) => !taken.has(p.id) && p.caregiverId === visit.caregiverId && p.day === visit.visitDate
    && (!p.scheduleId || p.scheduleId === visit.scheduleId))
  if (!cands.length) return null
  const want = secs(visit.startTime)
  cands.sort((a, b) => (Number(b.scheduleId === visit.scheduleId) - Number(a.scheduleId === visit.scheduleId))
    || (Math.abs(secs(a.startLocal) - want) - Math.abs(secs(b.startLocal) - want)))
  return cands[0]
}

/** A clock-out note in the caregiver's words, without the system's markers. */
export function clockOutNote(notes: unknown): string | null {
  let s = String(notes ?? '')
  for (const m of SYSTEM_NOTE_MARKERS) s = s.split(m).join('')
  s = s.trim()
  return s || null
}

/**
 * The task snapshot for a visit's documentation: every task, with the caregiver's recorded status where there is one
 * (never changed), else the office's choice (`officeDone(taskId)`).
 */
export function mergeTasks(
  tasks: { id: string; taskName: string }[],
  recorded: Map<string, { status: string; notes: string | null }> | undefined,
  officeDone: (taskId: string) => boolean,
  extra: { taskId: string; taskName: string; done: boolean }[] = [],
) {
  const list = tasks.map((t) => {
    const rec = recorded?.get(t.id)
    if (rec) return { taskId: t.id, taskName: t.taskName, done: rec.status === 'completed', status: rec.status, notes: rec.notes, recordedBy: 'caregiver' }
    const done = officeDone(t.id)
    return { taskId: t.id, taskName: t.taskName, done, status: done ? 'completed' : 'not_done', notes: null, recordedBy: 'office' }
  })
  for (const e of extra) if (!list.some((t) => t.taskId === e.taskId)) list.push({ ...e, status: e.done ? 'completed' : 'not_done', notes: null, recordedBy: 'office' })
  return list
}

export function createVisitRecord(d: CrmDeps, deps: { time: AgencyTime }) {
  const { time } = deps

  /** Scheduled (non-cancelled) visits for one client in a range, with the caregiver's name. */
  function scheduledVisits(companyId: string, clientId: string, from: string, to: string) {
    return scheduledVisitRows(d.db, companyId, clientId, from, to)
  }

  /** The client's punches whose clock-in falls in the range on the agency's calendar. */
  async function clientPunches(companyId: string, clientId: string, from: string, to: string) {
    const tz = await time.timezone(companyId)
    return clientPunchRows(d.db, companyId, clientId, from, to, tz)
  }

  /** Recorded task statuses per punch: Map(timeEntryId → Map(taskId → { status, notes })). Pending is not a record. */
  async function recordedTasks(companyId: string, timeEntryIds: string[]) {
    const out = new Map<string, Map<string, { status: string; notes: string | null }>>()
    if (!timeEntryIds.length) return out
    for (const x of await recordedTaskRows(d.db, companyId, timeEntryIds)) {
      if (!out.has(x.timeEntryId)) out.set(x.timeEntryId, new Map())
      out.get(x.timeEntryId)!.set(x.taskTemplateId, { status: x.status, notes: x.notes || null })
    }
    return out
  }

  /** The scheduled visit a caregiver's OPEN punch at this client belongs to, or null. */
  async function visitOfOpenPunch(companyId: string, caregiverId: string, clientId: string) {
    const tz = await time.timezone(companyId)
    const open = await openPunchRow(d.db, companyId, caregiverId, clientId, tz)
    if (!open) return null
    const visits = (await scheduledVisits(companyId, clientId, open.day, open.day)).filter((v) => v.caregiverId === caregiverId)
    // The visit whose matched punch is this one.
    for (const v of visits.sort((a, b) => Math.abs(secs(a.startTime) - secs(open.startLocal)) - Math.abs(secs(b.startTime) - secs(open.startLocal)))) {
      if (matchPunch(v, [open])?.id === open.id) return { visit: v, timeEntryId: open.id as string }
    }
    return null
  }

  /** Add a note to a visit's documentation (creating the row), after any note already there. Runs on `q` (db or a transaction). */
  function appendVisitNote(q: Q, companyId: string, clientId: string, visit: any, authorId: string, note: string) {
    return appendVisitNoteRow(q, companyId, clientId, {
      caregiverId: visit.caregiverId, visitDate: visit.visitDate, startTime: hms(visit.startTime),
      endTime: visit.endTime, scheduleId: visit.scheduleId,
    }, authorId, note)
  }

  return { scheduledVisits, clientPunches, recordedTasks, visitOfOpenPunch, appendVisitNote }
}

export type VisitRecord = ReturnType<typeof createVisitRecord>
