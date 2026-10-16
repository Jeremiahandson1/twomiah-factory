// Visit change requests — a cancel or reschedule asked for by the client (portal), the caregiver
// (their phone) or the office, in one queue the office resolves. Ported from the CVHC home care CRM
// (clientPortalRoutes.js: the visit actions, the caregiver reschedule request, the admin queue).
//
//   staff  → mounted at /api/visit-change-requests   (authenticate; office resolves, caregivers ask)
//   portal → routes/portalVisits.ts, mounted at /api/portal (portalAuth; the family's side)
//
// Whatever is approved is written into `schedules` / `schedule_exceptions`, because that is what the
// caregiver's phone, the Schedule Hub, payroll and billing all expand. A visit that was already
// worked is never moved — that is a time-entry correction, not a schedule change.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate } from '../middleware/auth.ts'
import { rows, one, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms, schedTs, DATE_RE } from '../services/scheduleOccurrences.ts'
import { agencyNow, addDays } from '../services/agencyTime.ts'
import { notifyUser, notifyAdmins, notifyClient, sendPush } from '../services/visitNotify.ts'

/** A caregiver hears about a change to their visit in the app AND on their phone (best-effort push). */
export async function tellCaregiver(caregiverId: string | null | undefined, type: string, title: string, message: string) {
  if (!caregiverId) return
  await notifyUser(caregiverId, type, title, message)
  await sendPush(caregiverId, { title, body: message, data: { type } })
}

export const VCR_COLS = sql.raw(`
  vcr.id, vcr.client_id, vcr.caregiver_id, vcr.request_type, vcr.visit_id, vcr.schedule_id,
  to_char(vcr.visit_date, 'YYYY-MM-DD') AS visit_date,
  to_char(vcr.original_start_time, 'HH24:MI:SS') AS original_start_time,
  to_char(vcr.original_end_time, 'HH24:MI:SS') AS original_end_time,
  vcr.cancel_reason,
  to_char(vcr.proposed_date, 'YYYY-MM-DD') AS proposed_date,
  to_char(vcr.proposed_start_time, 'HH24:MI:SS') AS proposed_start_time,
  to_char(vcr.proposed_end_time, 'HH24:MI:SS') AS proposed_end_time,
  to_char(vcr.counter_date, 'YYYY-MM-DD') AS counter_date,
  to_char(vcr.counter_start_time, 'HH24:MI:SS') AS counter_start_time,
  to_char(vcr.counter_end_time, 'HH24:MI:SS') AS counter_end_time,
  vcr.counter_message, vcr.status, vcr.requested_by, vcr.request_reason, vcr.applied_schedule_id,
  vcr.resolved_at, vcr.resolved_by_id, vcr.admin_notes, vcr.created_at, vcr.updated_at`)

export const getRequest = (id: string) => one<any>(sql`SELECT ${VCR_COLS} FROM visit_change_requests vcr WHERE vcr.id = ${id}`)

/**
 * A visit that has already been worked must not be moved: cancelling its date would pull the punch
 * out of payroll's cap (an "unscheduled" punch pays uncapped) and out of billing.
 */
export async function workedVisitBlocker({ caregiverId, clientId, visitDate }: { caregiverId: string; clientId: string; visitDate: string }) {
  const { tz } = await agencyNow()
  const r = await one(sql`SELECT id FROM time_entries
    WHERE caregiver_id = ${caregiverId} AND client_id = ${clientId}
      AND ((start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date = ${visitDate}::date LIMIT 1`)
  if (!r) return null
  return `That visit was already worked — there is a time entry on ${visitDate}. Moving it now would pull the punch out of payroll's cap and out of billing. Correct the time entry instead.`
}

// ── What a client may still change, and how a client's cancel is handled (Run 3 HIGH 6) ──────────
//
// THE RULE for a cancel asked for in the client portal:
//   1. A reason is required. The office and the caregiver both read it; an empty one tells them nothing.
//   2. A visit that has started, is over, or was worked (a time entry that day) cannot be cancelled or
//      moved from the portal at all (409, "call the office"): it happened, and changing it is a
//      time-entry / billing matter for the office, not a schedule change.
//   3. With at least CANCEL_NOTICE_HOURS' notice before the visit starts, the cancel is applied at
//      once: the visit leaves the schedule (so nobody drives out for nothing, and requests no longer sit
//      unreviewed while the caregiver's phone still shows the visit). The office is told in-app, and
//      the caregiver in-app AND by push.
//   4. With less notice it is a LATE cancellation and waits for the office (the caregiver may already
//      be on the way, and late cancels are the agency's policy call): the visit stays on the schedule
//      until someone resolves it. The office is told it needs a decision; the caregiver is told the
//      client asked and that the visit stands until confirmed.
//   Either way, when the office later approves or denies, the caregiver is told the outcome.
export const CANCEL_NOTICE_HOURS = 24

/** Hours from the agency's wall clock `now` to a visit's wall-clock start (negative once started). */
export function hoursUntilVisit(visitDate: string, startTime: string, now: { date: string; time: string }): number {
  const at = Date.parse(`${visitDate}T${hms(startTime) || '00:00:00'}Z`)
  const from = Date.parse(`${now.date}T${hms(now.time) || '00:00:00'}Z`)
  return (at - from) / 3600000
}

/** Why the client can no longer cancel or move this visit from the portal — or null when they can. */
export async function clientChangeBlocker({ caregiverId, clientId, visitDate, startTime }: {
  caregiverId: string; clientId: string; visitDate: string; startTime: string
}): Promise<string | null> {
  const now = await agencyNow()
  if (hoursUntilVisit(visitDate, startTime, now) <= 0) {
    return 'This visit has already started or is over, so it can no longer be cancelled or moved here. Please call the office.'
  }
  if (await workedVisitBlocker({ caregiverId, clientId, visitDate })) {
    return 'Your caregiver has already clocked in for this visit, so it can no longer be cancelled or moved here. Please call the office.'
  }
  return null
}

/**
 * Make an approved reschedule real on the SCHEDULE. Returns the schedule id the move landed on.
 *  - one-time row: moved in place (it IS its own occurrence);
 *  - recurring, same day, new times: one 'modified' exception carrying the times;
 *  - recurring, another date: cancel the old date + a one-time shift on the new one (an exception
 *    can say "not that day" but never "that day instead").
 */
export async function applyRescheduleToSchedule({ scheduleId, caregiverId, clientId, visitDate, newDate, newStart, newEnd, userId }: {
  scheduleId: string; caregiverId: string; clientId: string; visitDate: string; newDate: string; newStart: string; newEnd: string; userId: string
}): Promise<string | null> {
  const s = await one<any>(sql`SELECT id, day_of_week, COALESCE(is_training, false) AS is_training FROM schedules WHERE id = ${scheduleId} AND is_active = true`)
  if (!s) return null
  const start = hms(newStart)!, end = hms(newEnd)!
  if (s.day_of_week === null || s.day_of_week === undefined) {
    await rows(sql`UPDATE schedules SET date = ${newDate}::date, start_time = ${schedTs(start, newDate)}::timestamp,
      end_time = ${schedTs(end, newDate)}::timestamp, updated_at = NOW() WHERE id = ${scheduleId}`)
    return scheduleId
  }
  if (visitDate === newDate) {
    await rows(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_start_time, override_end_time, created_by, created_at)
      VALUES (${createId()}, ${scheduleId}, ${visitDate}::date, 'modified', ${start}::time, ${end}::time, ${userId}, NOW())
      ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'modified',
        override_start_time = EXCLUDED.override_start_time, override_end_time = EXCLUDED.override_end_time`)
    return scheduleId
  }
  await rows(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, created_by, created_at)
    VALUES (${createId()}, ${scheduleId}, ${visitDate}::date, 'cancelled', ${userId}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'cancelled', override_start_time = NULL, override_end_time = NULL`)
  // Same duplicate guard the schedule POST uses — a retried approval must not insert the move twice.
  const dup = await one<any>(sql`SELECT id FROM schedules WHERE is_active = true AND day_of_week IS NULL
    AND caregiver_id = ${caregiverId} AND client_id = ${clientId} AND date = ${newDate}::date
    AND start_time::time = ${start}::time AND end_time::time = ${end}::time LIMIT 1`)
  if (dup) return dup.id
  const id = createId()
  await rows(sql`INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes, is_training,
                                        is_active, status, frequency, created_at, updated_at)
    VALUES (${id}, ${caregiverId}, ${clientId}, 'one-time', NULL, ${newDate}::date, ${schedTs(start, newDate)}::timestamp,
            ${schedTs(end, newDate)}::timestamp, ${`Rescheduled from ${visitDate}`}, ${s.is_training === true}, true, 'active', 'weekly', NOW(), NOW())`)
  return id
}

// A schedule-sourced visit becomes a real scheduled_visits row the first time the family acts on it.
export async function materializeVisit({ scheduleId, visitDate, clientId, caregiverId, startTime, endTime }: any): Promise<string> {
  const ex = await one<any>(sql`SELECT id FROM scheduled_visits WHERE source_schedule_id = ${scheduleId} AND scheduled_date = ${visitDate}::date AND client_id = ${clientId}`)
  if (ex) return ex.id
  const id = createId()
  await rows(sql`INSERT INTO scheduled_visits (id, client_id, caregiver_id, visit_date, scheduled_date, start_time, end_time, status, source_schedule_id, created_at, updated_at)
    VALUES (${id}, ${clientId}, ${caregiverId}, ${visitDate}::date, ${visitDate}::date, ${hms(startTime)}::time, ${hms(endTime)}::time, 'scheduled', ${scheduleId}, NOW(), NOW())`)
  return id
}

export function visitIdentity(b: any) {
  return {
    source: b.source, visitId: b.visitId || null, scheduleId: b.scheduleId || null,
    visitDate: b.visitDate, caregiverId: b.caregiverId, startTime: hms(b.startTime), endTime: hms(b.endTime),
  }
}

// The schedule-sourced visit the family names must be one of THEIR visits on that day.
export async function ownsScheduleVisit(clientId: string, scheduleId: string | null, visitDate: string) {
  if (!scheduleId) return true
  const occ = await one(sql`WITH ${occurrencesCte(visitDate, visitDate)}
    SELECT 1 FROM occ WHERE occ.schedule_id = ${scheduleId} AND occ.client_id = ${clientId}`)
  return !!occ
}

export const clientName = async (clientId: string) => {
  const c = await one<any>(sql`SELECT first_name, last_name FROM clients WHERE id = ${clientId}`)
  return c ? `${c.first_name} ${c.last_name}` : 'The client'
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// STAFF
// ═══════════════════════════════════════════════════════════════════════════════════════
const staff = new Hono()
staff.use('*', authenticate)

// GET /api/visit-change-requests?status&caregiverId — open requests (pending / counter-offered) by
// default. A caregiver sees only their own.
staff.get('/', async (c) => {
  const user = c.get('user') as any
  const conds = [sql`TRUE`]
  if (!isOffice(user)) conds.push(sql`vcr.caregiver_id = ${userIdOf(user)}`)
  else if (c.req.query('caregiverId')) conds.push(sql`vcr.caregiver_id = ${c.req.query('caregiverId')}`)
  const status = c.req.query('status')
  if (status) conds.push(sql`vcr.status = ${status}`)
  else conds.push(sql`vcr.status IN ('pending', 'counter_offered')`)
  return c.json(await rows(sql`
    SELECT ${VCR_COLS},
      c.first_name AS client_first_name, c.last_name AS client_last_name,
      u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
    FROM visit_change_requests vcr
    JOIN clients c ON vcr.client_id = c.id
    JOIN users u ON vcr.caregiver_id = u.id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY vcr.created_at DESC`))
})

// POST /api/visit-change-requests/reschedule-request — the caregiver asks to move one of their own
// visits. Nothing moves on the caregiver's say-so: the office approves in the Schedule Hub.
staff.post('/reschedule-request', async (c) => {
  const user = c.get('user') as any
  const role = user.role
  if (role !== 'caregiver' && !isOffice(user)) return c.json({ error: 'Access required' }, 403)
  const b = await c.req.json().catch(() => ({})) as any
  const { scheduleId, visitDate, proposedDate, reason } = b
  const startTime = hms(b.startTime), endTime = hms(b.endTime), proposedStartTime = hms(b.proposedStartTime), proposedEndTime = hms(b.proposedEndTime)
  if (!scheduleId || !visitDate || !startTime || !endTime || !proposedDate || !proposedStartTime || !proposedEndTime) {
    return c.json({ error: 'scheduleId, visitDate, startTime, endTime, proposedDate, proposedStartTime and proposedEndTime are required' }, 400)
  }
  if (!DATE_RE.test(visitDate) || !DATE_RE.test(proposedDate)) return c.json({ error: 'Dates must be YYYY-MM-DD' }, 400)
  if (proposedDate === visitDate && proposedStartTime === startTime && proposedEndTime === endTime) {
    return c.json({ error: 'Pick a different day or time than the one already scheduled' }, 400)
  }
  // Resolve the occurrence through its exception: a caregiver covering a moved-in visit may ask too.
  const occ = await one<any>(sql`SELECT s.id, COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id,
      COALESCE(se.override_client_id, s.client_id) AS client_id, se.exception_type
    FROM schedules s LEFT JOIN schedule_exceptions se ON se.schedule_id = s.id AND se.exception_date = ${visitDate}::date
    WHERE s.id = ${scheduleId} AND s.is_active = true`)
  if (!occ) return c.json({ error: 'Shift not found' }, 404)
  if (occ.exception_type === 'cancelled') return c.json({ error: 'That visit is already cancelled' }, 400)
  if (role === 'caregiver' && occ.caregiver_id !== userIdOf(user)) return c.json({ error: 'You can only reschedule your own shifts' }, 403)
  const worked = await workedVisitBlocker({ caregiverId: occ.caregiver_id, clientId: occ.client_id, visitDate })
  if (worked) return c.json({ error: worked }, 409)
  // One open request per occurrence — two approvals would move the same visit twice.
  const open = await one(sql`SELECT id FROM visit_change_requests WHERE schedule_id = ${scheduleId} AND visit_date = ${visitDate}::date
    AND request_type = 'reschedule' AND status IN ('pending', 'counter_offered') LIMIT 1`)
  if (open) return c.json({ error: 'A reschedule request for this visit is already waiting on the office' }, 409)

  const id = createId()
  await rows(sql`INSERT INTO visit_change_requests (id, client_id, caregiver_id, request_type, schedule_id, visit_date, original_start_time, original_end_time,
      proposed_date, proposed_start_time, proposed_end_time, requested_by, request_reason, status, created_at, updated_at)
    VALUES (${id}, ${occ.client_id}, ${occ.caregiver_id}, 'reschedule', ${scheduleId}, ${visitDate}::date, ${startTime}::time, ${endTime}::time,
            ${proposedDate}::date, ${proposedStartTime}::time, ${proposedEndTime}::time, ${isOffice(user) ? 'admin' : 'caregiver'}, ${reason || null}, 'pending', NOW(), NOW())`)
  const cg = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${occ.caregiver_id}`)
  const msg = `${cg ? `${cg.first_name} ${cg.last_name}` : 'A caregiver'} is asking to move the ${await clientName(occ.client_id)} visit on ${visitDate} (${startTime.slice(0, 5)}) to ${proposedDate} at ${proposedStartTime.slice(0, 5)}.${reason ? ' Reason: ' + reason : ''}`
  await notifyAdmins('caregiver_reschedule_request', 'Caregiver Reschedule Request', msg)
  return c.json(await getRequest(id), 201)
})

// PUT /api/visit-change-requests/:id/resolve { action: approve | deny | counter, counterDate?,
//   counterStartTime?, counterEndTime?, counterMessage?, adminNotes? }
// The office resolves anything; a caregiver may answer a request a CLIENT made about their visit,
// but never their own — the office decides whether a shift moves.
staff.put('/:id/resolve', async (c) => {
  const user = c.get('user') as any
  const office = isOffice(user)
  if (!office && user.role !== 'caregiver') return c.json({ error: 'Access required' }, 403)
  const b = await c.req.json().catch(() => ({})) as any
  const { action, counterDate, counterMessage, adminNotes } = b
  if (!['approve', 'deny', 'counter'].includes(action)) return c.json({ error: 'action must be approve, deny, or counter' }, 400)
  const r = await getRequest(c.req.param('id'))
  if (!r || (!office && r.caregiver_id !== userIdOf(user))) return c.json({ error: 'Request not found' }, 404)
  if (!office && r.requested_by === 'caregiver') return c.json({ error: 'The office has to approve a reschedule you requested' }, 403)
  if (!['pending', 'counter_offered'].includes(r.status)) return c.json({ error: `This request is already ${r.status}` }, 400)
  const actor = userIdOf(user)
  const typeLabel = r.request_type === 'cancel' ? 'Cancellation' : 'Reschedule'

  if (action === 'approve') {
    if (r.request_type === 'cancel') {
      // A late cancel waits here; if the visit was worked meanwhile it is no longer the schedule's to drop.
      const worked = await workedVisitBlocker({ caregiverId: r.caregiver_id, clientId: r.client_id, visitDate: r.visit_date })
      if (worked) return c.json({ error: worked }, 409)
      if (r.visit_id) await rows(sql`UPDATE scheduled_visits SET status = 'cancelled', cancelled_reason = ${r.cancel_reason || 'Client requested'},
        cancelled_by = ${actor}, cancelled_at = NOW(), updated_at = NOW() WHERE id = ${r.visit_id}`)
      if (r.schedule_id) await rows(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, created_by, cancel_reason, created_at)
        VALUES (${createId()}, ${r.schedule_id}, ${r.visit_date}::date, 'cancelled', ${actor}, 'client_cancelled', NOW())
        ON CONFLICT (schedule_id, exception_date) DO NOTHING`)
      if (r.caregiver_id !== actor) {
        await tellCaregiver(r.caregiver_id, 'visit_cancelled', 'Visit Cancelled',
          `The ${await clientName(r.client_id)} visit on ${r.visit_date} at ${String(r.original_start_time).slice(0, 5)} is cancelled. It is off your schedule.`)
      }
    }
    if (r.request_type === 'reschedule') {
      // Re-checked at approval: the visit may have been worked since the request.
      const worked = await workedVisitBlocker({ caregiverId: r.caregiver_id, clientId: r.client_id, visitDate: r.visit_date })
      if (worked) return c.json({ error: worked }, 409)
      if (r.visit_id) await rows(sql`UPDATE scheduled_visits SET scheduled_date = ${r.proposed_date}::date, visit_date = ${r.proposed_date}::date,
        start_time = ${r.proposed_start_time}::time, end_time = ${r.proposed_end_time}::time, status = 'scheduled', updated_at = NOW() WHERE id = ${r.visit_id}`)
      if (r.schedule_id) {
        const applied = await applyRescheduleToSchedule({ scheduleId: r.schedule_id, caregiverId: r.caregiver_id, clientId: r.client_id,
          visitDate: r.visit_date, newDate: r.proposed_date, newStart: r.proposed_start_time, newEnd: r.proposed_end_time, userId: actor })
        if (applied) await rows(sql`UPDATE visit_change_requests SET applied_schedule_id = ${applied} WHERE id = ${r.id}`)
      }
      await notifyUser(r.caregiver_id, 'visit_rescheduled', 'Shift Rescheduled',
        `Your visit on ${r.visit_date} has been moved to ${r.proposed_date} at ${String(r.proposed_start_time).slice(0, 5)}.`)
    }
    await rows(sql`UPDATE visit_change_requests SET status = 'approved', resolved_at = NOW(), resolved_by_id = ${actor},
      admin_notes = ${adminNotes || null}, updated_at = NOW() WHERE id = ${r.id}`)
    // "Your request was approved" is only true when the client made the request.
    if (r.requested_by === 'client') {
      await notifyClient(r.client_id, 'change_request_approved', `${typeLabel} Approved`, `Your ${typeLabel.toLowerCase()} request for ${r.visit_date} has been approved.`)
    } else {
      await notifyClient(r.client_id, 'change_request_approved', 'Visit Rescheduled', `Your visit on ${r.visit_date} has been moved to ${r.proposed_date} at ${String(r.proposed_start_time).slice(0, 5)}.`)
    }
  } else if (action === 'deny') {
    await rows(sql`UPDATE visit_change_requests SET status = 'denied', resolved_at = NOW(), resolved_by_id = ${actor},
      admin_notes = ${adminNotes || null}, updated_at = NOW() WHERE id = ${r.id}`)
    if (r.requested_by === 'client') {
      await notifyClient(r.client_id, 'change_request_denied', `${typeLabel} Not Approved`,
        `Your ${typeLabel.toLowerCase()} request for ${r.visit_date} was not approved.${adminNotes ? ' Note: ' + adminNotes : ''}`)
      // The caregiver was told the client asked; tell them the visit stands.
      if (r.caregiver_id !== actor) {
        await tellCaregiver(r.caregiver_id, 'change_request_denied', `${typeLabel} Not Approved`,
          `The client's ${typeLabel.toLowerCase()} request for the ${r.visit_date} visit was not approved. The visit stays as scheduled.`)
      }
    } else {
      // The client never knew about a caregiver's request — answer the caregiver.
      await notifyUser(r.caregiver_id, 'reschedule_denied', 'Reschedule Not Approved',
        `Your request to move the ${r.visit_date} visit was not approved.${adminNotes ? ' Note: ' + adminNotes : ''} The shift stays as scheduled.`)
    }
  } else {
    const counterStartTime = hms(b.counterStartTime), counterEndTime = hms(b.counterEndTime)
    if (!counterDate || !DATE_RE.test(counterDate) || !counterStartTime || !counterEndTime) {
      return c.json({ error: 'counterDate, counterStartTime, counterEndTime required for counter-offer' }, 400)
    }
    await rows(sql`UPDATE visit_change_requests SET status = 'counter_offered', counter_date = ${counterDate}::date,
      counter_start_time = ${counterStartTime}::time, counter_end_time = ${counterEndTime}::time,
      counter_message = ${counterMessage || null}, admin_notes = ${adminNotes || null}, updated_at = NOW() WHERE id = ${r.id}`)
    // Only the portal can accept a counter, so a counter on a caregiver's request goes to the caregiver.
    if (r.requested_by === 'client') {
      await notifyClient(r.client_id, 'change_request_counter', 'Alternative Time Suggested',
        `Your caregiver suggested ${counterDate} at ${counterStartTime.slice(0, 5)} instead.${counterMessage ? ' "' + counterMessage + '"' : ''}`)
    } else {
      await notifyUser(r.caregiver_id, 'change_request_counter', 'Alternative Time Suggested',
        `The office suggested ${counterDate} at ${counterStartTime.slice(0, 5)} instead.${counterMessage ? ' "' + counterMessage + '"' : ''} Talk to the office to confirm.`)
    }
  }
  return c.json({ success: true })
})

export default staff
