// /api/visit-change-requests — the staff side of visit change requests: the office's queue, a caregiver asking to move
// their own visit, and resolving (approve / deny / counter). Moved from
// templates/crm-homecare/backend/src/routes/visitChangeRequests.ts (ported there from the CVHC home care CRM,
// clientPortalRoutes.js); the rules are ./visitChanges.ts, the family's side is the portals group's.
//
// Permissions: the template let any signed-in caregiver or office user in, and narrowed a caregiver to their own
// requests and visits. Here every action needs care-schedule:read (the caregiver holds it; a request moves nothing on
// the caregiver's say-so — the office approves), plus the template's narrowing. Resolving: the office resolves anything;
// a caregiver may answer a request a CLIENT made about their visit, never their own.
//
// Changes: every read and write is the company's; replies are camelCase (RULEBOOK §2) and the list is
// { data, pagination } (§3).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { hms, DATE_RE } from '../core/scheduleOccurrences.ts'
import {
  changeRequestList, occurrenceOfSchedule, openRescheduleFor, insertRescheduleRequest, cancelScheduledVisit,
  insertClientCancelException, rescheduleScheduledVisit, setAppliedSchedule, resolveChangeRequest, counterChangeRequest,
} from '../../../data/homecareVisits.ts'
import { createVisitChanges } from './visitChanges.ts'
import { isCaregiver, who } from './shared.ts'

export function createVisitChangeRequestRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const { notify } = core
  const vc = createVisitChanges(core, d)
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('care-schedule:read'))

  // GET /?status&caregiverId — open requests (pending / counter-offered) by default. A caregiver sees only their own.
  app.get('/', async (c) => {
    const { user: u, companyId, me } = who(c)
    const rows = await changeRequestList(db, companyId, {
      caregiverId: isCaregiver(d, u) ? me : (c.req.query('caregiverId') || null),
      status: c.req.query('status') || null,
    })
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // POST /reschedule-request — the caregiver asks to move one of their own visits. Nothing moves on the caregiver's
  // say-so: the office approves in the Schedule Hub.
  app.post('/reschedule-request', async (c) => {
    const { user: u, companyId, me } = who(c)
    const caregiver = isCaregiver(d, u)
    const b = await c.req.json().catch(() => ({})) as any
    const { scheduleId, visitDate, proposedDate, reason } = b
    const startTime = hms(b.startTime), endTime = hms(b.endTime), proposedStartTime = hms(b.proposedStartTime), proposedEndTime = hms(b.proposedEndTime)
    if (!scheduleId || !visitDate || !startTime || !endTime || !proposedDate || !proposedStartTime || !proposedEndTime) {
      return fail(c, 400, 'scheduleId, visitDate, startTime, endTime, proposedDate, proposedStartTime and proposedEndTime are required')
    }
    if (!DATE_RE.test(visitDate) || !DATE_RE.test(proposedDate)) return fail(c, 400, 'Dates must be YYYY-MM-DD')
    if (proposedDate === visitDate && proposedStartTime === startTime && proposedEndTime === endTime) {
      return fail(c, 400, 'Pick a different day or time than the one already scheduled')
    }
    // Resolve the occurrence through its exception: a caregiver covering a moved-in visit may ask too.
    const occ = await occurrenceOfSchedule(db, companyId, String(scheduleId), visitDate)
    if (!occ) return fail(c, 404, 'Shift not found')
    if (occ.exceptionType === 'cancelled') return fail(c, 400, 'That visit is already cancelled')
    if (caregiver && occ.caregiverId !== me) return fail(c, 403, 'You can only reschedule your own shifts')
    const worked = await vc.workedVisitBlocker(companyId, { caregiverId: occ.caregiverId, clientId: occ.clientId, visitDate })
    if (worked) return fail(c, 409, worked)
    // One open request per occurrence — two approvals would move the same visit twice.
    if (await openRescheduleFor(db, companyId, String(scheduleId), visitDate)) return fail(c, 409, 'A reschedule request for this visit is already waiting on the office')

    const id = await insertRescheduleRequest(db, companyId, {
      clientId: occ.clientId, caregiverId: occ.caregiverId, scheduleId: String(scheduleId), visitDate, startTime, endTime,
      proposedDate, proposedStartTime, proposedEndTime, requestedBy: caregiver ? 'caregiver' : 'admin', reason: reason || null,
    })
    const [cg] = await db.select({ firstName: user.firstName, lastName: user.lastName }).from(user)
      .where(and(eq(user.id, occ.caregiverId), eq(user.companyId, companyId))).limit(1)
    const msg = `${cg ? `${cg.firstName} ${cg.lastName}` : 'A caregiver'} is asking to move the ${await vc.clientName(companyId, occ.clientId)} visit on ${visitDate} (${startTime.slice(0, 5)}) to ${proposedDate} at ${proposedStartTime.slice(0, 5)}.${reason ? ' Reason: ' + reason : ''}`
    await notify.notifyAdmins(companyId, 'caregiver_reschedule_request', 'Caregiver Reschedule Request', msg)
    return one(c, await vc.getRequest(companyId, id), 201)
  })

  // PUT /:id/resolve { action: approve | deny | counter, counterDate?, counterStartTime?, counterEndTime?,
  //   counterMessage?, adminNotes? }
  // The office resolves anything; a caregiver may answer a request a CLIENT made about their visit, but never their own
  // — the office decides whether a shift moves.
  app.put('/:id/resolve', async (c) => {
    const { user: u, companyId, me: actor } = who(c)
    const office = !isCaregiver(d, u)
    const b = await c.req.json().catch(() => ({})) as any
    const { action, counterDate, counterMessage, adminNotes } = b
    if (!['approve', 'deny', 'counter'].includes(action)) return fail(c, 400, 'action must be approve, deny, or counter')
    const r = await vc.getRequest(companyId, c.req.param('id'))
    if (!r || (!office && r.caregiverId !== actor)) return fail(c, 404, 'Request not found')
    if (!office && r.requestedBy === 'caregiver') return fail(c, 403, 'The office has to approve a reschedule you requested')
    if (!['pending', 'counter_offered'].includes(r.status)) return fail(c, 400, `This request is already ${r.status}`)
    const typeLabel = r.requestType === 'cancel' ? 'Cancellation' : 'Reschedule'

    if (action === 'approve') {
      if (r.requestType === 'cancel') {
        // A late cancel waits here; if the visit was worked meanwhile it is no longer the schedule's to drop.
        const worked = await vc.workedVisitBlocker(companyId, { caregiverId: r.caregiverId, clientId: r.clientId, visitDate: r.visitDate })
        if (worked) return fail(c, 409, worked)
        if (r.visitId) await cancelScheduledVisit(db, companyId, r.visitId, r.cancelReason || 'Client requested', actor)
        if (r.scheduleId) await insertClientCancelException(db, companyId, r.scheduleId, r.visitDate, actor)
        if (r.caregiverId !== actor) {
          await vc.tellCaregiver(companyId, r.caregiverId, 'visit_cancelled', 'Visit Cancelled',
            `The ${await vc.clientName(companyId, r.clientId)} visit on ${r.visitDate} at ${String(r.originalStartTime).slice(0, 5)} is cancelled. It is off your schedule.`)
        }
      }
      if (r.requestType === 'reschedule') {
        // Re-checked at approval: the visit may have been worked since the request.
        const worked = await vc.workedVisitBlocker(companyId, { caregiverId: r.caregiverId, clientId: r.clientId, visitDate: r.visitDate })
        if (worked) return fail(c, 409, worked)
        if (r.visitId) await rescheduleScheduledVisit(db, companyId, r.visitId, r.proposedDate, r.proposedStartTime, r.proposedEndTime)
        if (r.scheduleId) {
          const applied = await vc.applyRescheduleToSchedule(companyId, { scheduleId: r.scheduleId, caregiverId: r.caregiverId, clientId: r.clientId,
            visitDate: r.visitDate, newDate: r.proposedDate, newStart: r.proposedStartTime, newEnd: r.proposedEndTime, userId: actor })
          if (applied) await setAppliedSchedule(db, companyId, r.id, applied)
        }
        await notify.notifyUser(companyId, r.caregiverId, 'visit_rescheduled', 'Shift Rescheduled',
          `Your visit on ${r.visitDate} has been moved to ${r.proposedDate} at ${String(r.proposedStartTime).slice(0, 5)}.`)
      }
      await resolveChangeRequest(db, companyId, r.id, 'approved', actor, adminNotes || null)
      // "Your request was approved" is only true when the client made the request.
      if (r.requestedBy === 'client') {
        await notify.notifyClient(companyId, r.clientId, 'change_request_approved', `${typeLabel} Approved`, `Your ${typeLabel.toLowerCase()} request for ${r.visitDate} has been approved.`)
      } else {
        await notify.notifyClient(companyId, r.clientId, 'change_request_approved', 'Visit Rescheduled', `Your visit on ${r.visitDate} has been moved to ${r.proposedDate} at ${String(r.proposedStartTime).slice(0, 5)}.`)
      }
    } else if (action === 'deny') {
      await resolveChangeRequest(db, companyId, r.id, 'denied', actor, adminNotes || null)
      if (r.requestedBy === 'client') {
        await notify.notifyClient(companyId, r.clientId, 'change_request_denied', `${typeLabel} Not Approved`,
          `Your ${typeLabel.toLowerCase()} request for ${r.visitDate} was not approved.${adminNotes ? ' Note: ' + adminNotes : ''}`)
        // The caregiver was told the client asked; tell them the visit stands.
        if (r.caregiverId !== actor) {
          await vc.tellCaregiver(companyId, r.caregiverId, 'change_request_denied', `${typeLabel} Not Approved`,
            `The client's ${typeLabel.toLowerCase()} request for the ${r.visitDate} visit was not approved. The visit stays as scheduled.`)
        }
      } else {
        // The client never knew about a caregiver's request — answer the caregiver.
        await notify.notifyUser(companyId, r.caregiverId, 'reschedule_denied', 'Reschedule Not Approved',
          `Your request to move the ${r.visitDate} visit was not approved.${adminNotes ? ' Note: ' + adminNotes : ''} The shift stays as scheduled.`)
      }
    } else {
      const counterStartTime = hms(b.counterStartTime), counterEndTime = hms(b.counterEndTime)
      if (!counterDate || !DATE_RE.test(counterDate) || !counterStartTime || !counterEndTime) {
        return fail(c, 400, 'counterDate, counterStartTime, counterEndTime required for counter-offer')
      }
      await counterChangeRequest(db, companyId, r.id, { date: counterDate, start: counterStartTime, end: counterEndTime, message: counterMessage || null, adminNotes: adminNotes || null })
      // Only the portal can accept a counter, so a counter on a caregiver's request goes to the caregiver.
      if (r.requestedBy === 'client') {
        await notify.notifyClient(companyId, r.clientId, 'change_request_counter', 'Alternative Time Suggested',
          `Your caregiver suggested ${counterDate} at ${counterStartTime.slice(0, 5)} instead.${counterMessage ? ' "' + counterMessage + '"' : ''}`)
      } else {
        await notify.notifyUser(companyId, r.caregiverId, 'change_request_counter', 'Alternative Time Suggested',
          `The office suggested ${counterDate} at ${counterStartTime.slice(0, 5)} instead.${counterMessage ? ' "' + counterMessage + '"' : ''} Talk to the office to confirm.`)
      }
    }
    return done(c)
  })

  return app
}
