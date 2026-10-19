// Home care's client portal — the family's visits and the visit actions: a note, cancel (applied at once unless the
// visit was worked or is past), reschedule requests, caregiver availability for the picker, and the answer to an office
// counter-offer. Moved from templates/crm-homecare/backend/src/routes/portalVisits.ts; on /api/portal beside
// ./clientPortal.ts (its sign-in, portalAuth). The shared rules (the worked-visit block, applying a reschedule to the
// schedule, telling the caregiver) are the visits group's (../visits/visitChanges.ts), as the template's were in
// routes/visitChangeRequests.ts.
//
// Changes from the template: every read and write is the client's company's; the office is told through the
// company's own office (core.notify.notifyAdmins); replies are lists ({ data, pagination }) and camelCase keys
// (scheduledDate, startTime, caregiverId, canChange …; a filed request's autoApplied, cancelReason, adminNotes).
import { Hono, type Context } from 'hono'
import { fail, list, one, done } from '../../../http/reply.ts'
import {
  servesClient, portalScheduledVisits, portalOccurrences, workedVisitKeys, setVisitClientNote, openClientRequestFor,
  insertClientCancelRequest, insertClientRescheduleRequest, cancelClientVisit, insertClientCancelledDay, answerCounterOffer,
  caregiverAvailabilityRow, caregiverBusyElsewhere, caregiverDaysOff,
} from '../../../data/homecarePortals.ts'
import { changeRequestList, rescheduleScheduledVisit, setAppliedSchedule } from '../../../data/homecareVisits.ts'
import { addDays } from '../core/agencyTime.ts'
import { hms, DATE_RE } from '../core/scheduleOccurrences.ts'
import { DEFAULT_WORKING_DAY } from '../core/workingDay.ts'
import { createVisitChanges, visitIdentity, hoursUntilVisit, CANCEL_NOTICE_HOURS } from '../visits/visitChanges.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import type { ClientPortal, PortalEnv } from './clientPortal.ts'

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`
const all = <T,>(c: Context, rows: T[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })
const ALREADY_WAITING = 'A request for this visit is already waiting on the office.'

export function createPortalVisitRoutes(core: HomecareCore, d: CrmDeps, clientPortal: ClientPortal) {
  const { db } = d
  const app = new Hono<PortalEnv>()
  const { portalAuth } = clientPortal
  const vc = createVisitChanges(core, d)
  const notifyAdmins = (companyId: string, type: string, title: string, message: string) => core.notify.notifyAdmins(companyId, type, title, message)

  // GET /visits?past=true&limit&offset — the family's visits, four weeks back / four weeks out, expanded through the
  // engine (a rescheduled visit MOVES instead of vanishing, an ended pattern shows nothing, bi-weekly stays bi-weekly,
  // and a covered visit shows who is ACTUALLY coming), merged with the portal's own scheduled_visits rows.
  app.get('/visits', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const limit = Math.min(parseInt(c.req.query('limit') || '20') || 20, 50)
    const offset = Math.max(parseInt(c.req.query('offset') || '0') || 0, 0)
    const past = c.req.query('past') === 'true'
    const now = await core.time.now(companyId)
    const today = now.date
    const sv = await portalScheduledVisits(db, companyId, clientId, today, past)
    const occ = await portalOccurrences(db, companyId, clientId, addDays(today, -28), addDays(today, 28), today, past)
    const expanded = occ.map((r: any) => ({
      id: `${r.scheduleId}-${r.scheduledDate}`, scheduledDate: r.scheduledDate, startTime: r.startTime, endTime: r.endTime,
      status: 'scheduled', notes: r.notes, clientNotes: null, cancelledReason: null, caregiverId: r.caregiverId,
      scheduleId: r.scheduleId, caregiverFirstName: r.caregiverFirstName, caregiverLastName: r.caregiverLastName,
      caregiverPhone: r.caregiverPhone, source: 'schedule',
    }))
    // A portal row for the same date + time + caregiver wins over the schedule's version of it.
    const key = (r: any) => `${r.scheduledDate}|${r.startTime}|${r.caregiverId}`
    const svKeys = new Set(sv.map(key))
    const merged = [...sv, ...expanded.filter((r: any) => !svKeys.has(key(r)))]
    merged.sort((a: any, b: any) => {
      const byDate = past ? b.scheduledDate.localeCompare(a.scheduledDate) : a.scheduledDate.localeCompare(b.scheduledDate)
      return byDate !== 0 ? byDate : String(a.startTime || '').localeCompare(String(b.startTime || ''))
    })
    // canChange: may the family still cancel or move this visit? The same test the cancel and reschedule routes refuse
    // by (clientChangeBlocker): not started yet, and not worked.
    const page = merged.slice(offset, offset + limit)
    const worked = await workedVisitKeys(db, companyId, clientId, addDays(today, -1), now.tz)
    const rows = page.map((v: any) => ({
      ...v,
      canChange: v.status === 'scheduled' && hoursUntilVisit(v.scheduledDate, v.startTime, now) > 0 && !worked.has(`${v.caregiverId}|${v.scheduledDate}`),
    }))
    return list(c, rows, { page: Math.floor(offset / limit) + 1, limit, total: merged.length })
  })

  // PUT /visits/note — the family's own note on a visit.
  app.put('/visits/note', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const b = await c.req.json().catch(() => ({} as any))
    const vi = visitIdentity(b)
    if (!b.note || !vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime) {
      return fail(c, 400, 'note, visitDate, caregiverId, startTime, endTime are required')
    }
    if (!DATE_RE.test(vi.visitDate)) return fail(c, 400, 'visitDate must be YYYY-MM-DD')
    if (!(await vc.ownsScheduleVisit(companyId, clientId, vi.scheduleId, vi.visitDate))) return fail(c, 404, 'Visit not found')
    let visitId = vi.visitId
    if (vi.source === 'schedule' && vi.scheduleId) visitId = await vc.materializeVisit(companyId, { ...vi, clientId })
    if (visitId) await setVisitClientNote(db, companyId, clientId, visitId, String(b.note).slice(0, 2000))
    return done(c)
  })

  // POST /visits/cancel-request — the client cancels one of their visits. THE RULE is written out beside
  // CANCEL_NOTICE_HOURS (../visits/visitChanges.ts): a reason is required; a visit that has started, is over or was
  // worked is refused (409); with at least 24 hours' notice it comes off the schedule at once; with less it is a late
  // cancellation that waits for the office. The office and the caregiver are told on both paths.
  app.post('/visits/cancel-request', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const b = await c.req.json().catch(() => ({} as any))
    const vi = visitIdentity(b)
    if (!vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime) return fail(c, 400, 'visitDate, caregiverId, startTime, endTime are required')
    if (!DATE_RE.test(vi.visitDate)) return fail(c, 400, 'visitDate must be YYYY-MM-DD')
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : ''
    if (!reason) return fail(c, 400, 'Please tell us why you are cancelling. Your caregiver and the office will see it.')
    if (!(await vc.ownsScheduleVisit(companyId, clientId, vi.scheduleId, vi.visitDate))) return fail(c, 404, 'Visit not found')
    const blocked = await vc.clientChangeBlocker(companyId, { caregiverId: vi.caregiverId, clientId, visitDate: vi.visitDate, startTime: vi.startTime })
    if (blocked) return fail(c, 409, blocked)
    let visitId = vi.visitId
    if (vi.source === 'schedule' && vi.scheduleId) visitId = await vc.materializeVisit(companyId, { ...vi, clientId })
    if (!vi.scheduleId && !visitId) return fail(c, 404, 'Visit not found')
    if (await openClientRequestFor(db, companyId, clientId, vi.visitDate, vi.startTime, vi.caregiverId)) return fail(c, 409, ALREADY_WAITING)

    const hours = hoursUntilVisit(vi.visitDate, vi.startTime, await core.time.now(companyId))
    const applyNow = hours >= CANCEL_NOTICE_HOURS
    const id = await insertClientCancelRequest(db, companyId, {
      clientId, caregiverId: vi.caregiverId, visitId: visitId || null, scheduleId: vi.scheduleId, visitDate: vi.visitDate,
      startTime: vi.startTime, endTime: vi.endTime, reason, applyNow,
      adminNotes: applyNow ? `Applied at once: cancelled by the client in the portal with ${Math.floor(hours)} hours' notice` : null,
    })
    if (applyNow) {
      if (visitId) await cancelClientVisit(db, companyId, clientId, visitId, reason)
      if (vi.scheduleId) await insertClientCancelledDay(db, companyId, vi.scheduleId, vi.visitDate)
    }
    const who = await vc.clientName(companyId, clientId)
    const when = `${vi.visitDate} at ${vi.startTime.slice(0, 5)}`
    if (applyNow) {
      await vc.tellCaregiver(companyId, vi.caregiverId, 'visit_cancelled', 'Visit Cancelled',
        `${who} cancelled the visit on ${when}. Reason: ${reason}. It is off your schedule.`)
      await notifyAdmins(companyId, 'visit_cancelled', 'Client Cancelled Visit',
        `${who} cancelled the visit on ${when} (${Math.floor(hours)} hours' notice). Reason: ${reason}. It has been taken off the schedule and the caregiver has been told.`)
    } else {
      await vc.tellCaregiver(companyId, vi.caregiverId, 'visit_cancel_request', 'Cancellation Request',
        `${who} asked to cancel the visit on ${when}. Reason: ${reason}. The visit stands until the office confirms.`)
      await notifyAdmins(companyId, 'visit_cancel_request', 'Late Cancellation: needs your decision',
        `${who} asked to cancel the visit on ${when}, with less than ${CANCEL_NOTICE_HOURS} hours' notice. Reason: ${reason}. It stays on the schedule until you approve or deny it in Schedule Hub → Staffing → Reschedules.`)
    }
    return one(c, { ...(await vc.getRequest(companyId, id)), autoApplied: applyNow }, 201)
  })

  // GET /caregivers/:caregiverId/availability?startDate&endDate&durationMinutes — the times the reschedule picker
  // offers: slots as long as the visit (durationMinutes, default 60), on the hour, inside the caregiver's working hours,
  // not clashing with their visits for other clients, not on time off or a blackout day, and not already past.
  //
  // Working hours are caregiver_availability — the table the office's Caregiver Availability screen and the optimizers
  // read. A day marked available with no start or end time gets the default working day (08:00–17:00, the week a new
  // caregiver is created with). No row at all = that default week (Mon–Fri). status 'unavailable' = no slots.
  app.get('/caregivers/:caregiverId/availability', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const caregiverId = c.req.param('caregiverId')!
    const now = await core.time.now(companyId)
    const today = now.date
    const startDate = DATE_RE.test(c.req.query('startDate') || '') ? c.req.query('startDate')! : today
    const endDate = DATE_RE.test(c.req.query('endDate') || '') ? c.req.query('endDate')! : addDays(startDate, 14)
    if (endDate < startDate || endDate > addDays(startDate, 62)) return fail(c, 400, 'Pick a range of at most two months')
    const dur = Math.round(Number(c.req.query('durationMinutes') || 60))
    if (!Number.isFinite(dur) || dur < 15 || dur > 720) return fail(c, 400, 'durationMinutes must be between 15 and 720')
    // Only a caregiver who serves this client now (the My Caregivers definition).
    if (!(await servesClient(db, companyId, caregiverId, clientId, today))) return all(c, [])
    const av = await caregiverAvailabilityRow(db, companyId, caregiverId)
    if (av && av.status === 'unavailable') return all(c, [])
    const busy = await caregiverBusyElsewhere(db, companyId, caregiverId, clientId, startDate, endDate)
    const off = await caregiverDaysOff(db, companyId, caregiverId, startDate, endDate)
    const slots: { date: string; dayOfWeek: number; startTime: string; endTime: string }[] = []
    for (let day = startDate < today ? today : startDate; day <= endDate; day = addDays(day, 1)) {
      if (off.some((o) => o.s <= day && o.e >= day)) continue
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
      const k = DAY_KEYS[dow]
      const isWeekday = dow >= 1 && dow <= 5
      const on = av ? (av[`${k}_available`] ?? isWeekday) : isWeekday
      if (!on) continue
      const ws = toMin(hms(av?.[`${k}_start_time`]) || DEFAULT_WORKING_DAY.start)
      const we = toMin(hms(av?.[`${k}_end_time`]) || DEFAULT_WORKING_DAY.end)
      for (let s = ws; s + dur <= we; s += 60) {
        const st = fromMin(s), et = fromMin(s + dur)
        if (day === today && st <= now.time) continue
        if (busy.some((x) => x.d === day && x.s < et && x.e > st)) continue
        slots.push({ date: day, dayOfWeek: dow, startTime: st, endTime: et })
      }
    }
    return all(c, slots)
  })

  // POST /visits/reschedule-request — the family asks to move a visit; the office decides.
  app.post('/visits/reschedule-request', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const b = await c.req.json().catch(() => ({} as any))
    const vi = visitIdentity(b)
    const proposedStartTime = hms(b.proposedStartTime), proposedEndTime = hms(b.proposedEndTime)
    if (!vi.visitDate || !vi.caregiverId || !vi.startTime || !vi.endTime || !b.proposedDate || !proposedStartTime || !proposedEndTime) {
      return fail(c, 400, 'Original visit info and proposedDate, proposedStartTime, proposedEndTime are required')
    }
    if (!DATE_RE.test(vi.visitDate) || !DATE_RE.test(b.proposedDate)) return fail(c, 400, 'Dates must be YYYY-MM-DD')
    if (!(await vc.ownsScheduleVisit(companyId, clientId, vi.scheduleId, vi.visitDate))) return fail(c, 404, 'Visit not found')
    const blocked = await vc.clientChangeBlocker(companyId, { caregiverId: vi.caregiverId, clientId, visitDate: vi.visitDate, startTime: vi.startTime })
    if (blocked) return fail(c, 409, blocked)
    if (await openClientRequestFor(db, companyId, clientId, vi.visitDate, vi.startTime, vi.caregiverId)) return fail(c, 409, ALREADY_WAITING)
    let visitId = vi.visitId
    if (vi.source === 'schedule' && vi.scheduleId) visitId = await vc.materializeVisit(companyId, { ...vi, clientId })
    const id = await insertClientRescheduleRequest(db, companyId, {
      clientId, caregiverId: vi.caregiverId, visitId: visitId || null, scheduleId: vi.scheduleId, visitDate: vi.visitDate,
      startTime: vi.startTime, endTime: vi.endTime, proposedDate: b.proposedDate, proposedStartTime, proposedEndTime,
    })
    const msg = `${await vc.clientName(companyId, clientId)} is requesting to reschedule their visit from ${vi.visitDate} to ${b.proposedDate} at ${proposedStartTime.slice(0, 5)}.`
    await vc.tellCaregiver(companyId, vi.caregiverId, 'visit_reschedule_request', 'Reschedule Request', msg)
    await notifyAdmins(companyId, 'visit_reschedule_request', 'Client Reschedule Request', msg)
    return one(c, (await vc.getRequest(companyId, id)) ?? { id }, 201)
  })

  // GET /change-requests — the family's open requests (pending or counter-offered), with the caregiver's name.
  app.get('/change-requests', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const rows = (await changeRequestList(db, c.get('portalCompanyId'), {})).filter((r: any) => r.clientId === clientId)
    return all(c, rows.map(({ clientFirstName: _f, clientLastName: _l, ...r }: any) => r))
  })

  // PUT /change-requests/:id/respond { accept } — answer a counter-offer.
  app.put('/change-requests/:id/respond', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const { accept } = await c.req.json().catch(() => ({} as any))
    const r = await vc.getRequest(companyId, c.req.param('id')!)
    if (!r || r.clientId !== clientId || r.status !== 'counter_offered') return fail(c, 404, 'Request not found or not counter-offered')
    if (accept) {
      const worked = await vc.workedVisitBlocker(companyId, { caregiverId: r.caregiverId, clientId: r.clientId, visitDate: r.visitDate })
      if (worked) return fail(c, 409, worked)
    }
    const newStatus = accept ? 'counter_accepted' : 'counter_declined'
    await answerCounterOffer(db, companyId, r.id, newStatus)
    if (accept) {
      if (r.visitId) await rescheduleScheduledVisit(db, companyId, r.visitId, r.counterDate, r.counterStartTime, r.counterEndTime)
      if (r.scheduleId) {
        const applied = await vc.applyRescheduleToSchedule(companyId, {
          scheduleId: r.scheduleId, caregiverId: r.caregiverId, clientId: r.clientId, visitDate: r.visitDate,
          newDate: r.counterDate, newStart: r.counterStartTime, newEnd: r.counterEndTime, userId: r.caregiverId,
        })
        if (applied) await setAppliedSchedule(db, companyId, r.id, applied)
      }
    }
    const who = await vc.clientName(companyId, clientId)
    const msg = `${who} has ${accept ? 'accepted' : 'declined'} your suggested time.`
    const title = accept ? 'Counter-Offer Accepted' : 'Counter-Offer Declined'
    await core.notify.notifyUser(companyId, r.caregiverId, newStatus, title, msg)
    await notifyAdmins(companyId, newStatus, title, msg)
    return one(c, { success: true, status: newStatus })
  })

  return app
}
