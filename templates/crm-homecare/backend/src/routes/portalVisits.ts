// /api/portal — the family's visits and the visit actions: a note, cancel (applied at once unless the
// visit was worked or is past), reschedule requests, caregiver availability for the picker, and the
// answer to an office counter-offer. Ported from the CVHC home care CRM (clientPortalRoutes.js).
// The shared rules (worked-visit block, applying a reschedule to the schedule) are in
// visitChangeRequests.ts.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { portalAuth, servesClient } from './portal.ts'
import { rows, one } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms, DATE_RE } from '../services/scheduleOccurrences.ts'
import { agencyNow, addDays } from '../services/agencyTime.ts'
import { notifyUser, notifyAdmins } from '../services/visitNotify.ts'
import { DEFAULT_WORKING_DAY } from '../services/workingDay.ts'
import {
  VCR_COLS, getRequest, workedVisitBlocker, applyRescheduleToSchedule, materializeVisit, visitIdentity, ownsScheduleVisit, clientName,
  clientChangeBlocker, hoursUntilVisit, tellCaregiver, CANCEL_NOTICE_HOURS,
} from './visitChangeRequests.ts'

const portal = new Hono()

// GET /api/portal/visits?past=true&limit&offset — the family's visits, four weeks back / four weeks
// out, expanded through the engine (a rescheduled visit MOVES instead of vanishing, an ended pattern
// shows nothing, bi-weekly stays bi-weekly, and a covered visit shows who is ACTUALLY coming), merged
// with the portal's own scheduled_visits rows.
portal.get('/visits', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  const limit = Math.min(parseInt(c.req.query('limit') || '20') || 20, 50)
  const offset = Math.max(parseInt(c.req.query('offset') || '0') || 0, 0)
  const past = c.req.query('past') === 'true'
  const { date: today } = await agencyNow()

  const sv = await rows<any>(sql`
    SELECT sv.id, to_char(sv.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
           to_char(sv.start_time, 'HH24:MI:SS') AS start_time, to_char(sv.end_time, 'HH24:MI:SS') AS end_time,
           sv.status, sv.notes, sv.client_notes, sv.cancelled_reason, sv.caregiver_id, sv.source_schedule_id AS schedule_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, u.phone AS caregiver_phone,
           'scheduled_visit' AS source
      FROM scheduled_visits sv JOIN users u ON sv.caregiver_id = u.id
     WHERE sv.client_id = ${clientId} AND sv.scheduled_date IS NOT NULL
       AND ${past ? sql`sv.scheduled_date < ${today}::date` : sql`sv.scheduled_date >= ${today}::date`}
       AND sv.status <> 'cancelled'`)

  const occ = await rows<any>(sql`
    WITH ${occurrencesCte(addDays(today, -28), addDays(today, 28))}
    SELECT occ.schedule_id, occ.caregiver_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS scheduled_date,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           s.notes, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, u.phone AS caregiver_phone
      FROM occ JOIN schedules s ON s.id = occ.schedule_id JOIN users u ON u.id = occ.caregiver_id
     WHERE occ.client_id = ${clientId} AND (s.status IS NULL OR s.status = 'active')
       AND ${past ? sql`occ.occ_date < ${today}::date` : sql`occ.occ_date >= ${today}::date`}
     ORDER BY occ.occ_date, occ.start_time`)

  const expanded = occ.map((r) => ({
    id: `${r.schedule_id}-${r.scheduled_date}`, scheduled_date: r.scheduled_date, start_time: r.start_time, end_time: r.end_time,
    status: 'scheduled', notes: r.notes, client_notes: null, cancelled_reason: null, caregiver_id: r.caregiver_id,
    schedule_id: r.schedule_id, caregiver_first_name: r.caregiver_first_name, caregiver_last_name: r.caregiver_last_name,
    caregiver_phone: r.caregiver_phone, source: 'schedule',
  }))
  // A portal row for the same date + time + caregiver wins over the schedule's version of it.
  const key = (r: any) => `${r.scheduled_date}|${r.start_time}|${r.caregiver_id}`
  const svKeys = new Set(sv.map(key))
  const all = [...sv, ...expanded.filter((r) => !svKeys.has(key(r)))]
  all.sort((a, b) => {
    const d = past ? b.scheduled_date.localeCompare(a.scheduled_date) : a.scheduled_date.localeCompare(b.scheduled_date)
    return d !== 0 ? d : String(a.start_time || '').localeCompare(String(b.start_time || ''))
  })
  // can_change: may the family still cancel or move this visit? The same test the cancel and
  // reschedule routes refuse by (clientChangeBlocker): not started yet, and not worked.
  const page = all.slice(offset, offset + limit)
  const now = await agencyNow()
  const tz = now.tz
  const worked = new Set((await rows<any>(sql`SELECT DISTINCT caregiver_id,
      to_char(((start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS d
    FROM time_entries WHERE client_id = ${clientId}
      AND ((start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date >= ${addDays(today, -1)}::date`)).map((r) => `${r.caregiver_id}|${r.d}`))
  return c.json(page.map((v) => ({
    ...v,
    can_change: v.status === 'scheduled' && hoursUntilVisit(v.scheduled_date, v.start_time, now) > 0
      && !worked.has(`${v.caregiver_id}|${v.scheduled_date}`),
  })))
})

// PUT /api/portal/visits/note — the family's own note on a visit
portal.put('/visits/note', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  const b = await c.req.json().catch(() => ({})) as any
  const vi = visitIdentity(b)
  if (!b.note || !vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime) {
    return c.json({ error: 'note, visitDate, caregiverId, startTime, endTime are required' }, 400)
  }
  if (!DATE_RE.test(vi.visitDate)) return c.json({ error: 'visitDate must be YYYY-MM-DD' }, 400)
  if (!(await ownsScheduleVisit(clientId, vi.scheduleId, vi.visitDate))) return c.json({ error: 'Visit not found' }, 404)
  let visitId = vi.visitId
  if (vi.source === 'schedule' && vi.scheduleId) visitId = await materializeVisit({ ...vi, clientId })
  if (visitId) await rows(sql`UPDATE scheduled_visits SET client_notes = ${String(b.note).slice(0, 2000)}, updated_at = NOW()
    WHERE id = ${visitId} AND client_id = ${clientId}`)
  return c.json({ success: true })
})

// POST /api/portal/visits/cancel-request — the client cancels one of their visits. THE RULE is written
// out beside CANCEL_NOTICE_HOURS in visitChangeRequests.ts: a reason is required; a visit that has
// started, is over or was worked is refused (409); with at least 24 hours' notice it comes off the
// schedule at once; with less it is a late cancellation that waits for the office. The office and the
// caregiver are told on both paths.
portal.post('/visits/cancel-request', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  const b = await c.req.json().catch(() => ({})) as any
  const vi = visitIdentity(b)
  if (!vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime) {
    return c.json({ error: 'visitDate, caregiverId, startTime, endTime are required' }, 400)
  }
  if (!DATE_RE.test(vi.visitDate)) return c.json({ error: 'visitDate must be YYYY-MM-DD' }, 400)
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : ''
  if (!reason) return c.json({ error: 'Please tell us why you are cancelling. Your caregiver and the office will see it.' }, 400)
  if (!(await ownsScheduleVisit(clientId, vi.scheduleId, vi.visitDate))) return c.json({ error: 'Visit not found' }, 404)
  const blocked = await clientChangeBlocker({ caregiverId: vi.caregiverId, clientId, visitDate: vi.visitDate, startTime: vi.startTime })
  if (blocked) return c.json({ error: blocked }, 409)
  let visitId = vi.visitId
  if (vi.source === 'schedule' && vi.scheduleId) visitId = await materializeVisit({ ...vi, clientId })
  if (!vi.scheduleId && !visitId) return c.json({ error: 'Visit not found' }, 404)
  const open = await one(sql`SELECT id FROM visit_change_requests WHERE client_id = ${clientId} AND visit_date = ${vi.visitDate}::date
    AND original_start_time = ${vi.startTime}::time AND caregiver_id = ${vi.caregiverId}
    AND status IN ('pending', 'counter_offered') LIMIT 1`)
  if (open) return c.json({ error: 'A request for this visit is already waiting on the office.' }, 409)

  const hours = hoursUntilVisit(vi.visitDate, vi.startTime, await agencyNow())
  const applyNow = hours >= CANCEL_NOTICE_HOURS
  const id = createId()
  await rows(sql`INSERT INTO visit_change_requests (id, client_id, caregiver_id, request_type, visit_id, schedule_id, visit_date,
      original_start_time, original_end_time, cancel_reason, status, resolved_at, admin_notes, requested_by, created_at, updated_at)
    VALUES (${id}, ${clientId}, ${vi.caregiverId}, 'cancel', ${visitId || null}, ${vi.scheduleId}, ${vi.visitDate}::date,
            ${vi.startTime}::time, ${vi.endTime}::time, ${reason}, ${applyNow ? 'approved' : 'pending'},
            ${applyNow ? sql`NOW()` : sql`NULL`},
            ${applyNow ? `Applied at once: cancelled by the client in the portal with ${Math.floor(hours)} hours' notice` : null},
            'client', NOW(), NOW())`)
  if (applyNow) {
    if (visitId) await rows(sql`UPDATE scheduled_visits SET status = 'cancelled', cancelled_reason = ${reason},
      cancelled_at = NOW(), updated_at = NOW() WHERE id = ${visitId} AND client_id = ${clientId}`)
    if (vi.scheduleId) await rows(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, cancel_reason, created_at)
      VALUES (${createId()}, ${vi.scheduleId}, ${vi.visitDate}::date, 'cancelled', 'client_cancelled', NOW())
      ON CONFLICT (schedule_id, exception_date) DO NOTHING`)
  }
  const who = await clientName(clientId)
  const when = `${vi.visitDate} at ${vi.startTime.slice(0, 5)}`
  if (applyNow) {
    await tellCaregiver(vi.caregiverId, 'visit_cancelled', 'Visit Cancelled',
      `${who} cancelled the visit on ${when}. Reason: ${reason}. It is off your schedule.`)
    await notifyAdmins('visit_cancelled', 'Client Cancelled Visit',
      `${who} cancelled the visit on ${when} (${Math.floor(hours)} hours' notice). Reason: ${reason}. It has been taken off the schedule and the caregiver has been told.`)
  } else {
    await tellCaregiver(vi.caregiverId, 'visit_cancel_request', 'Cancellation Request',
      `${who} asked to cancel the visit on ${when}. Reason: ${reason}. The visit stands until the office confirms.`)
    await notifyAdmins('visit_cancel_request', 'Late Cancellation: needs your decision',
      `${who} asked to cancel the visit on ${when}, with less than ${CANCEL_NOTICE_HOURS} hours' notice. Reason: ${reason}. It stays on the schedule until you approve or deny it in Schedule Hub → Staffing → Reschedules.`)
  }
  return c.json({ ...(await getRequest(id)), auto_applied: applyNow }, 201)
})

// GET /api/portal/caregivers/:caregiverId/availability?startDate&endDate&durationMinutes — the times
// the reschedule picker offers: slots as long as the visit (durationMinutes, default 60), on the hour,
// inside the caregiver's working hours, not clashing with their visits for other clients, not on time
// off or a blackout day, and not already past.
//
// Working hours are caregiver_availability — the table the office's Caregiver Availability screen
// and the optimizers read (this used to read caregiver_schedules, which no screen writes, so every
// caregiver had "no available slots"). A day marked available with no start or end time means the
// office never narrowed it: it gets the template's default working day, the same 08:00–17:00 a new
// caregiver's week is created with (routes/caregivers.ts). No row at all = that default week
// (Mon–Fri). status 'unavailable' = no slots.
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export { DEFAULT_WORKING_DAY }
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`

portal.get('/caregivers/:caregiverId/availability', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  const caregiverId = c.req.param('caregiverId')
  const now = await agencyNow()
  const today = now.date
  const startDate = DATE_RE.test(c.req.query('startDate') || '') ? c.req.query('startDate')! : today
  const endDate = DATE_RE.test(c.req.query('endDate') || '') ? c.req.query('endDate')! : addDays(startDate, 14)
  if (endDate < startDate || endDate > addDays(startDate, 62)) return c.json({ error: 'Pick a range of at most two months' }, 400)
  const dur = Math.round(Number(c.req.query('durationMinutes') || 60))
  if (!Number.isFinite(dur) || dur < 15 || dur > 720) return c.json({ error: 'durationMinutes must be between 15 and 720' }, 400)
  // Only a caregiver who serves this client now (the My Caregivers definition).
  if (!(await servesClient(caregiverId, clientId))) return c.json([])

  const av = await one<any>(sql`SELECT * FROM caregiver_availability WHERE caregiver_id = ${caregiverId}`)
  if (av && av.status === 'unavailable') return c.json([])
  const busy = await rows<any>(sql`WITH ${occurrencesCte(startDate, endDate)}
    SELECT to_char(occ.occ_date, 'YYYY-MM-DD') AS d, to_char(occ.start_time, 'HH24:MI:SS') AS s, to_char(occ.end_time, 'HH24:MI:SS') AS e
      FROM occ WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id <> ${clientId}`)
  const off = await rows<any>(sql`SELECT to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM caregiver_time_off
    WHERE caregiver_id = ${caregiverId} AND (status = 'approved' OR type = 'blackout')
      AND end_date >= ${startDate}::date AND start_date <= ${endDate}::date`)

  const slots: any[] = []
  for (let d = startDate < today ? today : startDate; d <= endDate; d = addDays(d, 1)) {
    if (off.some((o) => o.s <= d && o.e >= d)) continue
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
    const k = DAY_KEYS[dow]
    const isWeekday = dow >= 1 && dow <= 5
    const on = av ? (av[`${k}_available`] ?? isWeekday) : isWeekday
    if (!on) continue
    const ws = toMin(hms(av?.[`${k}_start_time`]) || DEFAULT_WORKING_DAY.start)
    const we = toMin(hms(av?.[`${k}_end_time`]) || DEFAULT_WORKING_DAY.end)
    for (let s = ws; s + dur <= we; s += 60) {
      const st = fromMin(s), et = fromMin(s + dur)
      if (d === today && st <= now.time) continue
      if (busy.some((x) => x.d === d && x.s < et && x.e > st)) continue
      slots.push({ date: d, dayOfWeek: dow, startTime: st, endTime: et })
    }
  }
  return c.json(slots)
})

// POST /api/portal/visits/reschedule-request — the family asks to move a visit; the office decides.
portal.post('/visits/reschedule-request', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  const b = await c.req.json().catch(() => ({})) as any
  const vi = visitIdentity(b)
  const proposedStartTime = hms(b.proposedStartTime), proposedEndTime = hms(b.proposedEndTime)
  if (!vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime || !b.proposedDate || !proposedStartTime || !proposedEndTime) {
    return c.json({ error: 'Original visit info and proposedDate, proposedStartTime, proposedEndTime are required' }, 400)
  }
  if (!DATE_RE.test(vi.visitDate) || !DATE_RE.test(b.proposedDate)) return c.json({ error: 'Dates must be YYYY-MM-DD' }, 400)
  if (!(await ownsScheduleVisit(clientId, vi.scheduleId, vi.visitDate))) return c.json({ error: 'Visit not found' }, 404)
  const blocked = await clientChangeBlocker({ caregiverId: vi.caregiverId, clientId, visitDate: vi.visitDate, startTime: vi.startTime })
  if (blocked) return c.json({ error: blocked }, 409)
  const open = await one(sql`SELECT id FROM visit_change_requests WHERE client_id = ${clientId} AND visit_date = ${vi.visitDate}::date
    AND original_start_time = ${vi.startTime}::time AND caregiver_id = ${vi.caregiverId}
    AND status IN ('pending', 'counter_offered') LIMIT 1`)
  if (open) return c.json({ error: 'A request for this visit is already waiting on the office.' }, 409)
  let visitId = vi.visitId
  if (vi.source === 'schedule' && vi.scheduleId) visitId = await materializeVisit({ ...vi, clientId })
  const id = createId()
  await rows(sql`INSERT INTO visit_change_requests (id, client_id, caregiver_id, request_type, visit_id, schedule_id, visit_date,
      original_start_time, original_end_time, proposed_date, proposed_start_time, proposed_end_time, requested_by, status, created_at, updated_at)
    VALUES (${id}, ${clientId}, ${vi.caregiverId}, 'reschedule', ${visitId || null}, ${vi.scheduleId}, ${vi.visitDate}::date,
            ${vi.startTime}::time, ${vi.endTime}::time, ${b.proposedDate}::date, ${proposedStartTime}::time, ${proposedEndTime}::time,
            'client', 'pending', NOW(), NOW())`)
  const msg = `${await clientName(clientId)} is requesting to reschedule their visit from ${vi.visitDate} to ${b.proposedDate} at ${proposedStartTime.slice(0, 5)}.`
  await tellCaregiver(vi.caregiverId, 'visit_reschedule_request', 'Reschedule Request', msg)
  await notifyAdmins('visit_reschedule_request', 'Client Reschedule Request', msg)
  return c.json(await getRequest(id), 201)
})

// GET /api/portal/change-requests — the family's open requests
portal.get('/change-requests', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  return c.json(await rows(sql`SELECT ${VCR_COLS}, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
    FROM visit_change_requests vcr JOIN users u ON vcr.caregiver_id = u.id
    WHERE vcr.client_id = ${clientId} AND vcr.status IN ('pending', 'counter_offered')
    ORDER BY vcr.created_at DESC`))
})

// PUT /api/portal/change-requests/:id/respond { accept } — answer a counter-offer
portal.put('/change-requests/:id/respond', portalAuth, async (c) => {
  const clientId = c.get('portalClientId' as any) as string
  const { accept } = await c.req.json().catch(() => ({})) as any
  const r = await one<any>(sql`SELECT ${VCR_COLS} FROM visit_change_requests vcr WHERE vcr.id = ${c.req.param('id')}
    AND vcr.client_id = ${clientId} AND vcr.status = 'counter_offered'`)
  if (!r) return c.json({ error: 'Request not found or not counter-offered' }, 404)
  if (accept) {
    const worked = await workedVisitBlocker({ caregiverId: r.caregiver_id, clientId: r.client_id, visitDate: r.visit_date })
    if (worked) return c.json({ error: worked }, 409)
  }
  const newStatus = accept ? 'counter_accepted' : 'counter_declined'
  await rows(sql`UPDATE visit_change_requests SET status = ${newStatus}, resolved_at = NOW(), updated_at = NOW() WHERE id = ${r.id}`)
  if (accept) {
    if (r.visit_id) await rows(sql`UPDATE scheduled_visits SET scheduled_date = ${r.counter_date}::date, visit_date = ${r.counter_date}::date,
      start_time = ${r.counter_start_time}::time, end_time = ${r.counter_end_time}::time, status = 'scheduled', updated_at = NOW() WHERE id = ${r.visit_id}`)
    if (r.schedule_id) {
      const applied = await applyRescheduleToSchedule({ scheduleId: r.schedule_id, caregiverId: r.caregiver_id, clientId: r.client_id,
        visitDate: r.visit_date, newDate: r.counter_date, newStart: r.counter_start_time, newEnd: r.counter_end_time, userId: r.caregiver_id })
      if (applied) await rows(sql`UPDATE visit_change_requests SET applied_schedule_id = ${applied} WHERE id = ${r.id}`)
    }
  }
  const who = await clientName(clientId)
  const msg = `${who} has ${accept ? 'accepted' : 'declined'} your suggested time.`
  const title = accept ? 'Counter-Offer Accepted' : 'Counter-Offer Declined'
  await notifyUser(r.caregiver_id, newStatus, title, msg)
  await notifyAdmins(newStatus, title, msg)
  return c.json({ success: true, status: newStatus })
})

export default portal
