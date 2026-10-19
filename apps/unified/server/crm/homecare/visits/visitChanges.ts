// Visit change requests' rules — a cancel or reschedule asked for by the client (portal), the caregiver (their phone)
// or the office, in one queue the office resolves. Moved from the exported helpers of
// templates/crm-homecare/backend/src/routes/visitChangeRequests.ts, which its routes/portalVisits.ts (the family's side,
// the portals group) imported; the staff router is ./visitChangeRequests.ts. The SQL is in server/data/homecareVisits.ts.
//
// Whatever is approved is written into `schedules` / `schedule_exceptions`, because that is what the caregiver's phone,
// the Schedule Hub, payroll and billing all expand. A visit that was already worked is never moved — that is a
// time-entry correction, not a schedule change.
//
// Changes: every read and write is the company's (its id comes first); rows are camelCase (visitDate, caregiverId,
// requestedBy, originalStartTime …).
import { and, eq } from 'drizzle-orm'
import { clients } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { hms, schedTs } from '../core/scheduleOccurrences.ts'
import {
  changeRequestById, workedOnDay, scheduleForMove, moveOneTimeSchedule, upsertModifiedTimes, upsertCancelledDay,
  sameOneTimeShift, insertOneTimeShift, materializedVisitOf, insertMaterializedVisit, clientHasOccurrence,
} from '../../../data/homecareVisits.ts'

// ── What a client may still change, and how a client's cancel is handled (Run 3 HIGH 6) ──────────
//
// THE RULE for a cancel asked for in the client portal:
//   1. A reason is required. The office and the caregiver both read it; an empty one tells them nothing.
//   2. A visit that has started, is over, or was worked (a time entry that day) cannot be cancelled or moved from the
//      portal at all (409, "call the office"): it happened, and changing it is a time-entry / billing matter.
//   3. With at least CANCEL_NOTICE_HOURS' notice before the visit starts, the cancel is applied at once.
//   4. With less notice it is a LATE cancellation and waits for the office.
//   Either way, when the office later approves or denies, the caregiver is told the outcome.
export const CANCEL_NOTICE_HOURS = 24

/** Hours from the agency's wall clock `now` to a visit's wall-clock start (negative once started). */
export function hoursUntilVisit(visitDate: string, startTime: string, now: { date: string; time: string }): number {
  const at = Date.parse(`${visitDate}T${hms(startTime) || '00:00:00'}Z`)
  const from = Date.parse(`${now.date}T${hms(now.time) || '00:00:00'}Z`)
  return (at - from) / 3600000
}

/** The identity of a visit the family names, from a request body. */
export function visitIdentity(b: any) {
  return {
    source: b.source, visitId: b.visitId || null, scheduleId: b.scheduleId || null,
    visitDate: b.visitDate, caregiverId: b.caregiverId, startTime: hms(b.startTime), endTime: hms(b.endTime),
  }
}

export function createVisitChanges(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { notify } = core

  /** A caregiver hears about a change to their visit in the app AND on their phone (best-effort push). */
  async function tellCaregiver(companyId: string, caregiverId: string | null | undefined, type: string, title: string, message: string) {
    if (!caregiverId) return
    await notify.notifyUser(companyId, caregiverId, type, title, message)
    await notify.sendPush(caregiverId, { title, body: message, data: { type } })
  }

  const getRequest = (companyId: string, id: string) => changeRequestById(db, companyId, id)

  /**
   * A visit that has already been worked must not be moved: cancelling its date would pull the punch out of payroll's
   * cap (an "unscheduled" punch pays uncapped) and out of billing. The sentence to refuse with, or null.
   */
  async function workedVisitBlocker(companyId: string, { caregiverId, clientId, visitDate }: { caregiverId: string; clientId: string; visitDate: string }): Promise<string | null> {
    const tz = await core.time.timezone(companyId)
    if (!(await workedOnDay(db, companyId, caregiverId, clientId, visitDate, tz))) return null
    return `That visit was already worked — there is a time entry on ${visitDate}. Moving it now would pull the punch out of payroll's cap and out of billing. Correct the time entry instead.`
  }

  /** Why the client can no longer cancel or move this visit from the portal — or null when they can. */
  async function clientChangeBlocker(companyId: string, { caregiverId, clientId, visitDate, startTime }: {
    caregiverId: string; clientId: string; visitDate: string; startTime: string
  }): Promise<string | null> {
    const now = await core.time.now(companyId)
    if (hoursUntilVisit(visitDate, startTime, now) <= 0) {
      return 'This visit has already started or is over, so it can no longer be cancelled or moved here. Please call the office.'
    }
    if (await workedVisitBlocker(companyId, { caregiverId, clientId, visitDate })) {
      return 'Your caregiver has already clocked in for this visit, so it can no longer be cancelled or moved here. Please call the office.'
    }
    return null
  }

  /**
   * Make an approved reschedule real on the SCHEDULE. Returns the schedule id the move landed on.
   *  - one-time row: moved in place (it IS its own occurrence);
   *  - recurring, same day, new times: one 'modified' exception carrying the times;
   *  - recurring, another date: cancel the old date + a one-time shift on the new one (an exception can say "not that
   *    day" but never "that day instead").
   */
  async function applyRescheduleToSchedule(companyId: string, { scheduleId, caregiverId, clientId, visitDate, newDate, newStart, newEnd, userId }: {
    scheduleId: string; caregiverId: string; clientId: string; visitDate: string; newDate: string; newStart: string; newEnd: string; userId: string
  }): Promise<string | null> {
    const s = await scheduleForMove(db, companyId, scheduleId)
    if (!s) return null
    const start = hms(newStart)!, end = hms(newEnd)!
    if (s.dayOfWeek === null || s.dayOfWeek === undefined) {
      await moveOneTimeSchedule(db, companyId, scheduleId, newDate, schedTs(start, newDate)!, schedTs(end, newDate)!)
      return scheduleId
    }
    if (visitDate === newDate) {
      await upsertModifiedTimes(db, companyId, scheduleId, visitDate, start, end, userId)
      return scheduleId
    }
    await upsertCancelledDay(db, companyId, scheduleId, visitDate, userId)
    // Same duplicate guard the schedule POST uses — a retried approval must not insert the move twice.
    const dup = await sameOneTimeShift(db, companyId, caregiverId, clientId, newDate, start, end)
    if (dup) return dup.id
    return insertOneTimeShift(db, companyId, {
      caregiverId, clientId, date: newDate, startTs: schedTs(start, newDate)!, endTs: schedTs(end, newDate)!,
      notes: `Rescheduled from ${visitDate}`, isTraining: s.isTraining === true,
    })
  }

  /** A schedule-sourced visit becomes a real scheduled_visits row the first time the family acts on it. */
  async function materializeVisit(companyId: string, { scheduleId, visitDate, clientId, caregiverId, startTime, endTime }: any): Promise<string> {
    const ex = await materializedVisitOf(db, companyId, scheduleId, visitDate, clientId)
    if (ex) return ex.id
    return insertMaterializedVisit(db, companyId, { scheduleId, visitDate, clientId, caregiverId, startTime: hms(startTime), endTime: hms(endTime) })
  }

  /** The schedule-sourced visit the family names must be one of THEIR visits on that day. */
  async function ownsScheduleVisit(companyId: string, clientId: string, scheduleId: string | null, visitDate: string): Promise<boolean> {
    if (!scheduleId) return true
    return clientHasOccurrence(db, companyId, clientId, scheduleId, visitDate)
  }

  /** The client's name for a message ('The client' when unknown). */
  async function clientName(companyId: string, clientId: string): Promise<string> {
    const [c] = await db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    return c ? `${c.firstName} ${c.lastName}` : 'The client'
  }

  return {
    tellCaregiver, getRequest, workedVisitBlocker, clientChangeBlocker, applyRescheduleToSchedule, materializeVisit,
    ownsScheduleVisit, clientName, visitIdentity, hoursUntilVisit, CANCEL_NOTICE_HOURS,
  }
}

export type VisitChanges = ReturnType<typeof createVisitChanges>
