// /api/emergency — a caregiver calls out of a shift (miss report), the office finds and assigns coverage, and a visit
// is cancelled because the CLIENT was unavailable. Moved from templates/crm-homecare/backend/src/routes/emergency.ts
// (ported there from the CVHC CRM's emergencyRoutes.js).
//
// Permissions: calling out of a visit and reporting a client unavailable are a caregiver's own visit work (evv:create;
// a caregiver only for a visit on their own schedule, the office for any); the caregiver's next visits are
// care-schedule:read; the office's call-out list and coverage search were admin-only (care-schedule:update), assigning
// coverage makes a visit (care-schedule:create). Replies: lists are { data, pagination } in camelCase (scheduleId,
// clientName, startTime, coverageAssigned … were snake_case).
import { Hono } from 'hono'
import { createId } from '@paralleldrive/cuid2'
import { and, eq } from 'drizzle-orm'
import { clients, user as users } from '../../../db/schema/index.ts'
import {
  occurrenceOn, visitWorked, scheduleWithClient, insertCallOut, cancelOccurrence, insertCoverageOpenShift, freeCaregiversFor,
  insertOpenShiftNotice, setOpenShiftNotifiedCount, openCallOuts, coverageCandidates, markCoverageAssigned, insertCoverageVisit,
  callableShifts, cancelledOccurrenceOn,
} from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'
import { hms, schedTs, DATE_RE } from '../core/scheduleOccurrences.ts'
import { CLIENT_UNAVAILABLE_REASONS } from '../core/cancelReasons.ts'
import { body, who, whole, type ClientAccess } from './shared.ts'

export const MISS_REPORT_WORKED = 'That visit was already worked (there is a clock-in for it), so it cannot be called out of. Call the office if something is wrong with it.'
export const MY_SHIFTS_DAYS = 14

export function createEmergencyRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const notify = core.notify

  const nameOf = async (companyId: string, id: string) =>
    (await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users)
      .where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1))[0] ?? null
  const clientNameOf = async (companyId: string, id: string) =>
    (await db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients)
      .where(and(eq(clients.id, id), eq(clients.companyId, companyId))).limit(1))[0] ?? null

  // POST /api/emergency/miss-report { scheduleId?, date, reason?, alternativeContact? } — a caregiver can't make a
  // shift. Records the absence, CANCELS that occurrence (so nothing reminds, no-show-alerts, pays or bills it), posts
  // an urgent open shift and tells the caregivers who are free.
  app.post('/miss-report', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me: caregiverId } = who(c)
    const { scheduleId, date, reason, alternativeContact } = await body(c)
    if (!date || !DATE_RE.test(String(date))) return fail(c, 400, 'Date is required')

    let info: any = null
    if (scheduleId) {
      info = await scheduleWithClient(db, companyId, scheduleId)
      if (info) {
        const occ = await occurrenceOn(db, companyId, scheduleId, date)
        if (occ) {
          // A day that belongs to someone else (a covered day) is not this caregiver's to call out of.
          if (!access.office(user) && occ.caregiverId !== caregiverId) return fail(c, 403, 'That visit is not on your schedule')
          const tz = await core.time.timezone(companyId)
          if (await visitWorked(db, companyId, tz, occ.caregiverId, occ.clientId, date)) return fail(c, 409, MISS_REPORT_WORKED)
          info = { ...info, startTime: occ.startTime, endTime: occ.endTime, clientId: occ.clientId }
        } else if (!access.office(user) && info.caregiverId !== caregiverId) {
          return fail(c, 403, 'That visit is not on your schedule')
        }
      }
    }

    const cg = await nameOf(companyId, caregiverId)
    const cgName = cg ? `${cg.firstName} ${cg.lastName}` : 'A caregiver'
    const reportId = createId()
    await insertCallOut(db, companyId, {
      id: reportId, caregiverId, clientId: info?.clientId || null, date, reason: reason || 'No reason provided',
      notes: JSON.stringify({
        scheduleId: scheduleId || null,
        scheduleInfo: info ? { clientName: `${info.clientFirstName} ${info.clientLastName}`, startTime: info.startTime, endTime: info.endTime } : null,
        alternativeContact: alternativeContact || null,
      }),
    })
    const alert = info
      ? `${cgName} cannot make their shift on ${date} with ${info.clientFirstName} ${info.clientLastName}. Reason: ${reason || 'None given'}`
      : `${cgName} has reported they cannot work on ${date}. Reason: ${reason || 'None given'}`
    await notify.notifyAdmins(companyId, 'emergency_coverage', 'Shift Miss Report — Coverage Needed', alert)

    if (scheduleId && info) {
      await cancelOccurrence(db, companyId, { scheduleId, date, notes: `Called out: ${reason || 'no reason given'}`, createdBy: caregiverId, cancelReason: 'caregiver_callout' })
    }

    let openShiftId: string | null = null
    let notifiedCount = 0
    if (info?.clientId) {
      try {
        openShiftId = createId()
        await insertCoverageOpenShift(db, companyId, {
          id: openShiftId, clientId: info.clientId, scheduleId: scheduleId || null, date, startTime: info.startTime, endTime: info.endTime,
          notes: `Coverage needed — ${cgName} called out. Reason: ${reason || 'None given'}`, createdById: caregiverId, absenceId: reportId,
        })
        // Free caregivers: no overlapping visit that day (recurring included), not on approved time off.
        const free = await freeCaregiversFor(db, companyId, date, info.startTime, info.endTime, caregiverId)
        const msg = `${info.clientFirstName} ${info.clientLastName} needs coverage on ${date} from ${String(info.startTime).slice(0, 5)} to ${String(info.endTime).slice(0, 5)}. Open the app to claim this shift.`
        for (const f of free) {
          try {
            await insertOpenShiftNotice(db, companyId, openShiftId, f.id)
            await notify.notifyUser(companyId, f.id, 'open_shift', 'Urgent Shift Available', msg)
            await notify.sendPush(f.id, { title: 'Urgent Open Shift', body: msg, data: { type: 'open_shift', openShiftId } })
            notifiedCount++
          } catch { /* keep going */ }
        }
        await setOpenShiftNotifiedCount(db, companyId, openShiftId, notifiedCount)
      } catch (e: any) {
        d.logger.error('[miss-report] open shift', { error: e?.message })
        openShiftId = null
      }
    }
    return one(c, {
      id: reportId,
      message: 'Your report has been submitted. The admin team has been notified.',
      date, status: 'submitted', openShiftCreated: !!openShiftId, caregiversNotified: notifiedCount,
    }, 201)
  })

  // GET /api/emergency/miss-reports — call-outs still needing coverage.
  app.get('/miss-reports', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const rows = await openCallOuts(db, companyId, await core.time.today(companyId))
    return whole(c, rows.map((r: any) => {
      let n: any = null
      try { n = r.notes ? JSON.parse(r.notes) : null } catch { n = null }
      return {
        ...r,
        scheduleId: n?.scheduleId || null,
        clientName: n?.scheduleInfo?.clientName || (r.clientFirstName ? `${r.clientFirstName} ${r.clientLastName}` : null),
        startTime: n?.scheduleInfo?.startTime || null,
        endTime: n?.scheduleInfo?.endTime || null,
        coverageAssigned: !!r.coverageAssignedTo,
      }
    }))
  })

  // GET /api/emergency/available-caregivers?date&startTime&endTime&clientId — who can cover; preferred first, then the
  // best rated, then the fewest hours this week.
  app.get('/available-caregivers', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { date, startTime, endTime, clientId } = c.req.query()
    const start = hms(startTime), end = hms(endTime)
    if (!date || !DATE_RE.test(date) || !start || !end) return fail(c, 400, 'date, startTime, and endTime are required')
    const weekStart = addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay())
    const preferred = clientId
      ? (await db.select({ preferredCaregivers: clients.preferredCaregivers }).from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1))[0]
      : null
    const preferredIds = new Set<string>(Array.isArray(preferred?.preferredCaregivers) ? (preferred!.preferredCaregivers as any[]).map(String) : [])
    const rows = await coverageCandidates(db, companyId, { date, startTime: start, endTime: end, weekStart, weekEnd: addDays(weekStart, 6) })
    const out = rows.map((r: any) => ({ ...r, scheduledHoursThisWeek: Math.round(Number(r.scheduledHoursThisWeek) * 100) / 100, isPreferred: preferredIds.has(r.id) }))
    out.sort((a: any, b: any) => Number(b.isPreferred) - Number(a.isPreferred) || Number(b.avgRating) - Number(a.avgRating) || a.scheduledHoursThisWeek - b.scheduledHoursThisWeek)
    return whole(c, out)
  })

  // POST /api/emergency/assign-coverage { absenceId, caregiverId, date, startTime, endTime, clientId, notes }
  app.post('/assign-coverage', requirePermission('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const { absenceId, caregiverId, date, startTime, endTime, clientId, notes } = await body(c)
    if (!caregiverId) return fail(c, 400, 'caregiverId is required')
    const cg = await access.personInCompany(companyId, String(caregiverId))
    if (!cg) return fail(c, 404, 'Caregiver not found')
    if (absenceId) await markCoverageAssigned(db, companyId, absenceId, caregiverId)
    const startTs = date ? schedTs(startTime, date) : null
    const endTs = date ? schedTs(endTime, date) : null
    if (date && DATE_RE.test(date) && startTs && endTs && clientId && (await access.clientInCompany(companyId, clientId))) {
      const id = createId()
      await insertCoverageVisit(db, companyId, {
        id, caregiverId, clientId, date, startTs, endTs,
        notes: `Emergency coverage${notes ? ': ' + notes : ''}. Original absence: ${absenceId || 'N/A'}`,
      })
      await notify.recordAudit(companyId, me, 'CREATE', 'schedules', id, null, { emergency_coverage: true, absenceId: absenceId || null })
    }
    const cl = clientId ? await clientNameOf(companyId, clientId) : null
    await notify.notifyUser(companyId, caregiverId, 'emergency_assignment', 'Emergency Coverage Assignment',
      `You have been assigned emergency coverage on ${date} from ${startTime} to ${endTime}${cl ? ` for ${cl.firstName} ${cl.lastName}` : ''}. Please confirm your availability.`)
    return one(c, { success: true, message: `Coverage assigned to ${cg.firstName || ''} ${cg.lastName || ''}`.trim() })
  })

  // GET /api/emergency/my-shifts — the caregiver's next visits for the miss-report form: DATED occurrences from the
  // one schedule engine over the next two weeks (agency days). Only visits that can still be called out of: not worked,
  // and not one of today's that has already ended. `id` is the schedule (pattern) id and `date` the visit's date.
  app.get('/my-shifts', requirePermission('care-schedule:read'), async (c) => {
    const { companyId, me } = who(c)
    const { date: today, time: nowTime, tz } = await core.time.now(companyId)
    return whole(c, await callableShifts(db, companyId, me, { today, until: addDays(today, MY_SHIFTS_DAYS - 1), nowTime, tz }))
  })

  // POST /api/emergency/client-unavailable { scheduleId, date, reason, note? } — the client refused care, wasn't home,
  // was in hospital or cancelled ahead. The visit is cancelled with that REASON so nothing bills, pays, reminds or
  // no-show-alerts for it — with no caregiver absence and no open shift. A caregiver may cancel only their OWN visit,
  // from seven days ago through tomorrow; the office any visit, any date.
  app.post('/client-unavailable', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const office = access.office(user)
    const { scheduleId, date, reason, note } = await body(c)
    if (!scheduleId || !date || !reason) return fail(c, 400, 'scheduleId, date and reason are required')
    if (!DATE_RE.test(String(date))) return fail(c, 400, 'date must be YYYY-MM-DD')
    const label = CLIENT_UNAVAILABLE_REASONS[reason]
    if (!label) return fail(c, 400, `reason must be one of: ${Object.keys(CLIENT_UNAVAILABLE_REASONS).join(', ')}`)
    if (reason === 'other' && !(note && String(note).trim())) return fail(c, 400, 'Please add a note when the reason is Other')
    if (!office) {
      const today = await core.time.today(companyId)
      if (date < addDays(today, -7) || date > addDays(today, 1)) {
        return fail(c, 400, 'You can report a client as unavailable for the last 7 days through tomorrow. For older dates, contact the office.')
      }
    }
    // Already cancelled (a second tap, or the office got there first)? Record the better reason.
    const visit = (await occurrenceOn(db, companyId, scheduleId, date)) ?? (await cancelledOccurrenceOn(db, companyId, scheduleId, date))
    if (!visit) return fail(c, 404, 'No visit is scheduled on that date for this shift')
    if (!office && visit.caregiverId !== me) return fail(c, 403, 'That visit is not on your schedule')

    const noteText = note && String(note).trim() ? String(note).trim().slice(0, 500) : ''
    const saved = await cancelOccurrence(db, companyId, {
      scheduleId, date, notes: `Client unavailable — ${label}${noteText ? `: ${noteText}` : ''}`, createdBy: me, cancelReason: reason, clearTimes: true,
    })
    await notify.recordAudit(companyId, me, 'CLIENT_UNAVAILABLE', 'schedules', scheduleId, null, { date, reason, note: noteText || null, exception_id: saved.id }, reason)
    if (!office) {
      const whoName = await nameOf(companyId, me)
      const cl = await clientNameOf(companyId, visit.clientId)
      const cgName = whoName ? `${whoName.firstName} ${whoName.lastName}` : 'A caregiver'
      const clName = cl ? `${cl.firstName} ${cl.lastName}` : 'a client'
      await notify.notifyAdmins(companyId, 'client_unavailable', 'Client unavailable — visit not billed',
        `${cgName} reported ${clName} unavailable on ${date} (${String(visit.startTime).slice(0, 5)}–${String(visit.endTime).slice(0, 5)}): ${label}${noteText ? ` — ${noteText}` : ''}. The visit will not be billed or paid.`)
    }
    return one(c, { success: true, exception: saved, label }, 201)
  })

  return app
}
