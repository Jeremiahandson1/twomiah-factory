// /api/scheduling (after the Schedule Hub's paths, schedulingHub.ts) — the scheduling module's own records: schedules,
// the caregiver availability calendar, time off, open shifts, absences, no-show alerts and their configuration. Moved
// from templates/crm-homecare/backend/src/routes/scheduling.ts.
//
// Permissions (care-schedule): every read is :read; a caregiver files their own time off with :read too (the template:
// any signed-in person, self-service through core/selfService.ts); the template's requireAdmin writes are :create /
// :update / :delete, and its admin-only reads (no-show alerts and configuration) :update — a caregiver holds none.
//
// Fixed in the move (apps/unified/tests/homecare-scheduling.test.ts):
//   · GET /schedules, /caregiver-schedules and /absences answered every caregiver's rows to any signed-in person (an
//     absence's reason is personal: sick, family, medical — routes/absences.ts keeps its list for the office for that
//     reason); a caregiver now gets their own. GET /open-shifts answered every posting; a caregiver now gets the ones
//     offered to them (as GET /api/open-shifts/available does). No caregiver screen reads any of them.
//   · POST / PUT took the body whole: a body's companyId (or id) is never written; every row is the signed-in
//     person's company's.
//   · GET /open-shifts read every notification of every shift when it listed more than one shift.
//
// Replies: lists are list replies ({ data, pagination }); records are camelCase (the template's Drizzle shapes already
// were). DELETE /schedules/:id is { success, message: 'Deleted' } (was { message }). An update of a missing row is a
// 404 (the template answered an empty body).
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, arrayContains } from 'drizzle-orm'
import {
  schedules, caregiverSchedules, caregiverTimeOff, openShifts, openShiftNotifications, absences, noshowAlerts, noshowAlertConfig, user, clients,
} from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { selfSubject } from '../core/selfService.ts'
import { isCaregiver, who } from './shared.ts'

const asList = (c: any, rows: any[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })

/** A body's own keys, without the ones the server decides (the row's id and its company). */
const writable = (body: any) => {
  const { id: _id, companyId: _co, ...rest } = (body && typeof body === 'object' ? body : {}) as any
  return rest
}

export function createSchedulingRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  // ── SCHEDULES ─────────────────────────────────────────────────────

  app.get('/schedules', perm('care-schedule:read'), async (c) => {
    const { user: me, companyId, me: myId } = who(c)
    const clientId = c.req.query('clientId')
    const caregiverId = isCaregiver(d, me) ? myId : c.req.query('caregiverId')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')

    const conditions = [eq(schedules.companyId, companyId)]
    if (clientId) conditions.push(eq(schedules.clientId, clientId))
    if (caregiverId) conditions.push(eq(schedules.caregiverId, caregiverId))
    if (startDate) conditions.push(gte(schedules.effectiveDate, startDate))
    if (endDate) conditions.push(lte(schedules.effectiveDate, endDate))

    const rows = await db.select().from(schedules).where(and(...conditions)).orderBy(asc(schedules.effectiveDate))
    return asList(c, rows)
  })

  app.post('/schedules', perm('care-schedule:create'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({}))
    const [schedule] = await db.insert(schedules).values({ ...writable(body), companyId }).returning()
    return one(c, schedule, 201)
  })

  app.put('/schedules/:id', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({}))
    const [schedule] = await db.update(schedules).set({ ...writable(body), updatedAt: new Date() })
      .where(and(eq(schedules.id, c.req.param('id')), eq(schedules.companyId, companyId))).returning()
    if (!schedule) return fail(c, 404, 'Schedule not found')
    return one(c, schedule)
  })

  app.delete('/schedules/:id', perm('care-schedule:delete'), async (c) => {
    const { companyId } = who(c)
    await db.delete(schedules).where(and(eq(schedules.id, c.req.param('id')), eq(schedules.companyId, companyId)))
    return done(c, 'Deleted')
  })

  // ── CAREGIVER SCHEDULES (availability calendar) ───────────────────

  app.get('/caregiver-schedules', perm('care-schedule:read'), async (c) => {
    const { user: me, companyId, me: myId } = who(c)
    const caregiverId = isCaregiver(d, me) ? myId : c.req.query('caregiverId')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')

    const conditions = [eq(caregiverSchedules.companyId, companyId)]
    if (caregiverId) conditions.push(eq(caregiverSchedules.caregiverId, caregiverId))
    if (startDate) conditions.push(gte(caregiverSchedules.date, startDate))
    if (endDate) conditions.push(lte(caregiverSchedules.date, endDate))

    const rows = await db.select({
      id: caregiverSchedules.id,
      caregiverId: caregiverSchedules.caregiverId,
      dayOfWeek: caregiverSchedules.dayOfWeek,
      date: caregiverSchedules.date,
      startTime: caregiverSchedules.startTime,
      endTime: caregiverSchedules.endTime,
      isAvailable: caregiverSchedules.isAvailable,
      maxHoursPerWeek: caregiverSchedules.maxHoursPerWeek,
      overtimeApproved: caregiverSchedules.overtimeApproved,
      notes: caregiverSchedules.notes,
      createdAt: caregiverSchedules.createdAt,
      updatedAt: caregiverSchedules.updatedAt,
      caregiver: { firstName: user.firstName, lastName: user.lastName },
    })
      .from(caregiverSchedules)
      .leftJoin(user, eq(user.id, caregiverSchedules.caregiverId))
      .where(and(...conditions))
      .orderBy(asc(caregiverSchedules.date))
    return asList(c, rows)
  })

  app.post('/caregiver-schedules', perm('care-schedule:create'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({}))
    const [schedule] = await db.insert(caregiverSchedules).values({ ...writable(body), companyId }).returning()
    return one(c, schedule, 201)
  })

  // ── TIME OFF ──────────────────────────────────────────────────────

  // The office sees everyone's time off; a caregiver only their own (a ?caregiverId for someone else is a 403 — the
  // reasons on these rows are personal: sick, family, medical).
  app.get('/time-off', perm('care-schedule:read'), async (c) => {
    const { companyId } = who(c)
    const subject = selfSubject(c, c.req.query('caregiverId'))
    if ('refusal' in subject) return subject.refusal
    const caregiverId = subject.office ? c.req.query('caregiverId') : subject.id
    const status = c.req.query('status')

    const conditions = [eq(caregiverTimeOff.companyId, companyId)]
    if (caregiverId) conditions.push(eq(caregiverTimeOff.caregiverId, caregiverId))
    if (status) conditions.push(eq(caregiverTimeOff.status, status))

    const rows = await db.select({
      id: caregiverTimeOff.id,
      caregiverId: caregiverTimeOff.caregiverId,
      startDate: caregiverTimeOff.startDate,
      endDate: caregiverTimeOff.endDate,
      type: caregiverTimeOff.type,
      reason: caregiverTimeOff.reason,
      approvedById: caregiverTimeOff.approvedById,
      status: caregiverTimeOff.status,
      createdAt: caregiverTimeOff.createdAt,
      caregiver: { firstName: user.firstName, lastName: user.lastName },
    })
      .from(caregiverTimeOff)
      .leftJoin(user, eq(user.id, caregiverTimeOff.caregiverId))
      .where(and(...conditions))
      .orderBy(desc(caregiverTimeOff.startDate))
    return asList(c, rows)
  })

  // A time-off request. A caregiver files their own, and it is always pending — approving is the office's (PATCH
  // …/approve below); the body never sets status or approver. The office may file one for anyone, already decided.
  app.post('/time-off', perm('care-schedule:read'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const subject = selfSubject(c, body.caregiverId)
    if ('refusal' in subject) return subject.refusal
    if (!body.startDate || !body.endDate || !body.type) return fail(c, 400, 'startDate, endDate and type are required')
    const status = subject.office && typeof body.status === 'string' && body.status ? body.status : 'pending'
    const [timeOff] = await db.insert(caregiverTimeOff).values({
      companyId, caregiverId: subject.id, startDate: body.startDate, endDate: body.endDate, type: String(body.type),
      reason: body.reason || null, status, approvedById: subject.office && status === 'approved' ? me : null,
    }).returning()
    return one(c, timeOff, 201)
  })

  app.patch('/time-off/:id/approve', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const [updated] = await db.update(caregiverTimeOff).set({ status: 'approved', approvedById: me })
      .where(and(eq(caregiverTimeOff.id, c.req.param('id')), eq(caregiverTimeOff.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Time off not found')
    return one(c, updated)
  })

  app.patch('/time-off/:id/reject', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const [updated] = await db.update(caregiverTimeOff).set({ status: 'rejected' })
      .where(and(eq(caregiverTimeOff.id, c.req.param('id')), eq(caregiverTimeOff.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Time off not found')
    return one(c, updated)
  })

  // ── OPEN SHIFTS ───────────────────────────────────────────────────

  app.get('/open-shifts', perm('care-schedule:read'), async (c) => {
    const { user: me, companyId, me: myId } = who(c)
    const status = c.req.query('status') || 'open'
    const conditions = [eq(openShifts.companyId, companyId), eq(openShifts.status, status)]
    // A caregiver sees the postings offered to everyone or to them.
    if (isCaregiver(d, me)) conditions.push(or(isNull(openShifts.visibleTo), arrayContains(openShifts.visibleTo, [myId]))!)
    const shifts = await db.select().from(openShifts).where(and(...conditions)).orderBy(asc(openShifts.date))

    const shiftIds = shifts.map((s: any) => s.id)
    const notifications = shiftIds.length
      ? await db.select().from(openShiftNotifications)
        .where(and(eq(openShiftNotifications.companyId, companyId), inArray(openShiftNotifications.openShiftId, shiftIds)))
      : []
    const result = shifts.map((shift: any) => ({ ...shift, notifications: notifications.filter((n: any) => n.openShiftId === shift.id) }))
    return asList(c, result)
  })

  app.post('/open-shifts', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({}))
    const [shift] = await db.insert(openShifts).values({ ...writable(body), createdById: me, companyId }).returning()
    return one(c, shift, 201)
  })

  app.patch('/open-shifts/:id', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({}))
    const [shift] = await db.update(openShifts).set({ ...writable(body), updatedAt: new Date() })
      .where(and(eq(openShifts.id, c.req.param('id')), eq(openShifts.companyId, companyId))).returning()
    if (!shift) return fail(c, 404, 'Open shift not found')
    return one(c, shift)
  })

  // ── ABSENCES ──────────────────────────────────────────────────────

  app.get('/absences', perm('care-schedule:read'), async (c) => {
    const { user: me, companyId, me: myId } = who(c)
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    const caregiverId = isCaregiver(d, me) ? myId : c.req.query('caregiverId')

    const conditions = [eq(absences.companyId, companyId)]
    if (caregiverId) conditions.push(eq(absences.caregiverId, caregiverId))
    if (startDate) conditions.push(gte(absences.date, startDate))
    if (endDate) conditions.push(lte(absences.date, endDate))

    const rows = await db.select({
      id: absences.id,
      caregiverId: absences.caregiverId,
      clientId: absences.clientId,
      date: absences.date,
      type: absences.type,
      reason: absences.reason,
      reportedById: absences.reportedById,
      coverageNeeded: absences.coverageNeeded,
      coverageAssignedTo: absences.coverageAssignedTo,
      createdAt: absences.createdAt,
      caregiver: { firstName: user.firstName, lastName: user.lastName },
    })
      .from(absences)
      .leftJoin(user, eq(user.id, absences.caregiverId))
      .where(and(...conditions))
      .orderBy(desc(absences.date))

    // The covering caregivers' names.
    const coverageIds = [...new Set(rows.filter((r: any) => r.coverageAssignedTo).map((r: any) => r.coverageAssignedTo as string))] as string[]
    const coverageMap: Record<string, { firstName: string; lastName: string }> = {}
    if (coverageIds.length) {
      const people = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user)
        .where(and(inArray(user.id, coverageIds), eq(user.companyId, companyId)))
      for (const u of people) coverageMap[u.id] = { firstName: u.firstName, lastName: u.lastName }
    }
    return asList(c, rows.map((r: any) => ({ ...r, coverageAssigned: r.coverageAssignedTo ? coverageMap[r.coverageAssignedTo] || null : null })))
  })

  app.post('/absences', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({}))
    const [absence] = await db.insert(absences).values({ ...writable(body), reportedById: me, companyId }).returning()

    // Auto-create open shift if coverage needed
    if (absence.coverageNeeded) {
      await db.insert(openShifts).values({
        companyId, clientId: absence.clientId, date: absence.date, autoCreated: true, sourceAbsenceId: absence.id, createdById: me,
      })
    }
    return one(c, absence, 201)
  })

  // ── NO-SHOW ALERTS ────────────────────────────────────────────────

  app.get('/noshow-alerts', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const rows = await db.select({
      id: noshowAlerts.id,
      scheduleId: noshowAlerts.scheduleId,
      caregiverId: noshowAlerts.caregiverId,
      clientId: noshowAlerts.clientId,
      shiftDate: noshowAlerts.shiftDate,
      expectedStart: noshowAlerts.expectedStart,
      alertedAt: noshowAlerts.alertedAt,
      resolvedAt: noshowAlerts.resolvedAt,
      resolvedById: noshowAlerts.resolvedById,
      resolutionNote: noshowAlerts.resolutionNote,
      status: noshowAlerts.status,
      smsSent: noshowAlerts.smsSent,
      createdAt: noshowAlerts.createdAt,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
      caregiverPhone: user.phone,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      clientAddress: clients.address,
    })
      .from(noshowAlerts)
      .leftJoin(user, eq(user.id, noshowAlerts.caregiverId))
      .leftJoin(clients, eq(clients.id, noshowAlerts.clientId))
      .where(and(eq(noshowAlerts.companyId, companyId), eq(noshowAlerts.status, 'open')))
      .orderBy(desc(noshowAlerts.alertedAt))

    return asList(c, rows.map((r: any) => ({
      id: r.id, scheduleId: r.scheduleId, caregiverId: r.caregiverId, clientId: r.clientId, shiftDate: r.shiftDate,
      expectedStart: r.expectedStart, alertedAt: r.alertedAt, resolvedAt: r.resolvedAt, resolvedById: r.resolvedById,
      resolutionNote: r.resolutionNote, status: r.status, smsSent: r.smsSent, createdAt: r.createdAt,
      caregiver: { firstName: r.caregiverFirstName, lastName: r.caregiverLastName, phone: r.caregiverPhone },
      client: { firstName: r.clientFirstName, lastName: r.clientLastName, address: r.clientAddress },
    })))
  })

  app.patch('/noshow-alerts/:id/resolve', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const [alert] = await db.update(noshowAlerts)
      .set({ status: body.status || 'resolved', resolvedAt: new Date(), resolvedById: me, resolutionNote: body.resolutionNote })
      .where(and(eq(noshowAlerts.id, c.req.param('id')), eq(noshowAlerts.companyId, companyId)))
      .returning()
    if (!alert) return fail(c, 404, 'Alert not found')
    return one(c, alert)
  })

  app.get('/noshow-config', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    let [config] = await db.select().from(noshowAlertConfig).where(eq(noshowAlertConfig.companyId, companyId)).limit(1)
    if (!config) [config] = await db.insert(noshowAlertConfig).values({ companyId }).returning()
    return one(c, config)
  })

  app.put('/noshow-config', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({}))
    let [config] = await db.select().from(noshowAlertConfig).where(eq(noshowAlertConfig.companyId, companyId)).limit(1)
    if (config) {
      [config] = await db.update(noshowAlertConfig).set({ ...writable(body), updatedAt: new Date() })
        .where(and(eq(noshowAlertConfig.id, config.id), eq(noshowAlertConfig.companyId, companyId))).returning()
    } else {
      [config] = await db.insert(noshowAlertConfig).values({ ...writable(body), companyId }).returning()
    }
    return one(c, config)
  })

  // GET /coverage-overview lives in schedulingHub.ts (the shape the Schedule Hub reads).
  return app
}
