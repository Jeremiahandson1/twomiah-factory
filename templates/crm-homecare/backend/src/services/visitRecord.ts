// One record per scheduled visit — the visit's note and its care-task statuses — and how the
// caregiver's own entries reach it.
//
//   · A visit is client + agency date + scheduled start + caregiver (the shared schedule engine).
//   · Its NOTE lives in ONE place: visit_documentation.note. The office writes it on Visit
//     Documentation; a caregiver who adds a note on the client's Notes tab WHILE CLOCKED IN for
//     that client writes it to the same row (appendVisitNote), so the office, the care-notes PDF
//     and the invoice all read the caregiver's words. A note written with no visit to belong to
//     (not clocked in, or an unscheduled punch) is a general client note (client_visit_notes).
//   · Its TASK STATUSES are what the caregiver recorded on the punch (shift_task_completions:
//     completed / skipped / refused, with any note). Those are facts from the visit: the office's
//     bulk fill and its saved snapshot carry them and never overwrite them. Only a task the
//     caregiver left unrecorded takes the office's tick.
//   · The punch that belongs to a visit is the payroll / Client Hours rule: same caregiver and
//     client, clocked in on the visit's agency day, the visit's schedule when the punch names one,
//     else the nearest scheduled start.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { rows, one, inList } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms } from './scheduleOccurrences.ts'
import { agencyTimezone, dayStartUtc, dayEndUtc, localDate, localTs } from './agencyTime.ts'

// The system's own markers in time_entries.notes are not a caregiver's words.
export const SYSTEM_NOTE_MARKERS = ['(Auto-transition: schedule shift change)', '(Auto-closed: caregiver clocked into new client)']

export const RECORDED_STATUSES = ['completed', 'skipped', 'refused']

/** Scheduled (non-cancelled) visits for one client in a range, with the caregiver's name. */
export async function scheduledVisits(clientId: string, from: string, to: string) {
  return rows<any>(sql`WITH ${occurrencesCte(from, to)}
    SELECT to_char(o.occ_date, 'YYYY-MM-DD') AS visit_date, to_char(o.start_time, 'HH24:MI:SS') AS start_time,
           to_char(o.end_time, 'HH24:MI:SS') AS end_time, o.minutes, o.caregiver_id, o.schedule_id,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM occ o LEFT JOIN users u ON u.id = o.caregiver_id
     WHERE o.client_id = ${clientId}
     ORDER BY o.occ_date, o.start_time`)
}

export const visitKey = (v: any) => `${v.visit_date}|${hms(v.start_time)}|${v.caregiver_id}`

const secs = (t: unknown) => { const h = hms(t); if (!h) return 0; const [a, b, c] = h.split(':').map(Number); return a * 3600 + b * 60 + c }

/** The client's punches whose clock-in falls in the range on the agency's calendar. */
export async function clientPunches(clientId: string, from: string, to: string) {
  const tz = await agencyTimezone()
  return rows<any>(sql`SELECT te.id, te.caregiver_id, te.schedule_id, te.notes,
      to_char(${localDate(sql`te.start_time`, tz)}, 'YYYY-MM-DD') AS day,
      to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI:SS') AS start_local,
      to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_in,
      to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_out
    FROM time_entries te
    WHERE te.client_id = ${clientId}
      AND te.start_time >= ${dayStartUtc(from, tz)} AND te.start_time < ${dayEndUtc(to, tz)}
    ORDER BY te.start_time`)
}

/** The punch that belongs to `visit` (see header), or null. Each punch answers one visit. */
export function matchPunch(visit: any, punches: any[], taken: Set<string> = new Set()) {
  const cands = punches.filter((p) => !taken.has(p.id) && p.caregiver_id === visit.caregiver_id && p.day === visit.visit_date
    && (!p.schedule_id || p.schedule_id === visit.schedule_id))
  if (!cands.length) return null
  const want = secs(visit.start_time)
  cands.sort((a, b) => (Number(b.schedule_id === visit.schedule_id) - Number(a.schedule_id === visit.schedule_id))
    || (Math.abs(secs(a.start_local) - want) - Math.abs(secs(b.start_local) - want)))
  return cands[0]
}

/** Recorded task statuses per punch: Map(timeEntryId → Map(taskId → { status, notes })). Pending is not a record. */
export async function recordedTasks(timeEntryIds: string[]) {
  const out = new Map<string, Map<string, { status: string; notes: string | null }>>()
  if (!timeEntryIds.length) return out
  const r = await rows<any>(sql`SELECT time_entry_id, task_template_id, status, notes FROM shift_task_completions
    WHERE time_entry_id IN (${inList(timeEntryIds)}) AND status IN ('completed', 'skipped', 'refused')`)
  for (const x of r) {
    if (!out.has(x.time_entry_id)) out.set(x.time_entry_id, new Map())
    out.get(x.time_entry_id)!.set(x.task_template_id, { status: x.status, notes: x.notes || null })
  }
  return out
}

/** A clock-out note in the caregiver's words, without the system's markers. */
export function clockOutNote(notes: unknown): string | null {
  let s = String(notes ?? '')
  for (const m of SYSTEM_NOTE_MARKERS) s = s.split(m).join('')
  s = s.trim()
  return s || null
}

/**
 * The task snapshot for a visit's documentation: every task, with the caregiver's recorded status
 * where there is one (never changed), else the office's choice (`officeDone(taskId)`).
 */
export function mergeTasks(
  tasks: { id: string; task_name: string }[],
  recorded: Map<string, { status: string; notes: string | null }> | undefined,
  officeDone: (taskId: string) => boolean,
  extra: { taskId: string; taskName: string; done: boolean }[] = [],
) {
  const list = tasks.map((t) => {
    const rec = recorded?.get(t.id)
    if (rec) return { taskId: t.id, taskName: t.task_name, done: rec.status === 'completed', status: rec.status, notes: rec.notes, recordedBy: 'caregiver' }
    const done = officeDone(t.id)
    return { taskId: t.id, taskName: t.task_name, done, status: done ? 'completed' : 'not_done', notes: null, recordedBy: 'office' }
  })
  for (const e of extra) if (!list.some((t) => t.taskId === e.taskId)) list.push({ ...e, status: e.done ? 'completed' : 'not_done', notes: null, recordedBy: 'office' })
  return list
}

/**
 * The scheduled visit a caregiver's OPEN punch at this client belongs to, or null (not clocked in
 * here, or the punch matches no scheduled visit).
 */
export async function visitOfOpenPunch(caregiverId: string, clientId: string) {
  const tz = await agencyTimezone()
  const open = await one<any>(sql`SELECT te.id, te.caregiver_id, te.schedule_id, te.notes,
      to_char(${localDate(sql`te.start_time`, tz)}, 'YYYY-MM-DD') AS day,
      to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI:SS') AS start_local
    FROM time_entries te
    WHERE te.caregiver_id = ${caregiverId} AND te.client_id = ${clientId} AND te.end_time IS NULL
    ORDER BY te.start_time DESC LIMIT 1`)
  if (!open) return null
  const visits = (await scheduledVisits(clientId, open.day, open.day)).filter((v) => v.caregiver_id === caregiverId)
  // The visit whose matched punch is this one.
  for (const v of visits.sort((a, b) => Math.abs(secs(a.start_time) - secs(open.start_local)) - Math.abs(secs(b.start_time) - secs(open.start_local)))) {
    if (matchPunch(v, [open])?.id === open.id) return { visit: v, timeEntryId: open.id as string }
  }
  return null
}

/** Add a note to a visit's documentation (creating the row), after any note already there. */
export async function appendVisitNote(q: { execute: (s: any) => Promise<any> }, clientId: string, visit: any, authorId: string, note: string) {
  const r: any = await q.execute(sql`
    INSERT INTO visit_documentation (id, client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note, entered_by_id, created_at, updated_at)
    VALUES (${createId()}, ${clientId}, ${visit.caregiver_id}, ${visit.visit_date}::date, ${hms(visit.start_time)}::time, ${visit.end_time}::time,
            ${visit.schedule_id}, '[]'::json, ${note}, ${authorId}, NOW(), NOW())
    ON CONFLICT (client_id, visit_date, start_time, caregiver_id) DO UPDATE
      SET note = CASE WHEN COALESCE(TRIM(visit_documentation.note), '') = '' THEN EXCLUDED.note
                      ELSE visit_documentation.note || E'\n' || EXCLUDED.note END,
          updated_at = NOW()
    RETURNING id, client_id, caregiver_id, note, created_at, updated_at`)
  return (r?.rows ?? r)[0]
}
