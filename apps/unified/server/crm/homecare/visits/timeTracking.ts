// Time entries: the punch, the approval queue, GPS, visit photos. Mounted at /api/time-tracking (the office Time & GPS
// page) and /api/time-entries (the caregiver app). Moved from templates/crm-homecare/backend/src/routes/timeTracking.ts
// (ported there from the CVHC home care CRM, routes/timeTrackingRoutes.js); its raw SQL is in
// server/data/homecareVisits.ts.
//
// Permissions (the template's requireAdmin and "a caregiver sees only their own"):
//   · a caregiver's own visit — read evv:read, punch / GPS / photo evv:create, clock-out / late fix evv:update — and
//     the row narrowing the template had (their own entries; a client they serve for a photo or a GPS report);
//   · the office's side (the approval queue, force clock-out, edits, photo lists and deletes, GPS alerts, geofence
//     settings): OFFICE_EVV.
//
// Changes from the template:
//   · every read and write is the signed-in person's company's; a clock-in names a client of that company (404 else);
//   · replies are camelCase (RULEBOOK §2) and lists are { data, pagination } (§3): see the report for each endpoint;
//   · a geofence save takes only its own settings (the template spread the request body into the row — any column);
//   · an office edit of an unknown entry is a 404 (the template answered 200 with nothing), and setting only an end time
//     recomputes the duration from the entry's clock-in (the template left the old duration).
import { Hono } from 'hono'
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, isNotNull, like, lt, lte, or } from 'drizzle-orm'
import {
  timeEntries, gpsTracking, geofenceSettings, user, clients, evvVisits, referralSources, visitPhotos, notifications,
} from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, listAll } from '../../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { decideBilling, parseOfflineAt, withOfflineFlag, hasOfflineFlag } from '../core/punchRules.ts'
import { fmtClock, formatInZone } from '../core/agencyTime.ts'
import { EVV_REASON_CODES } from '../core/sandataPayload.ts'
import { requireAdminOrSelf } from '../core/selfService.ts'
import { pendingApprovalEntries, occurrenceForPunch } from '../../../data/homecareVisits.ts'
import { OFFICE_EVV, isCaregiver, who, intParam, isPrivatePayer, payerOf as sharedPayerOf } from './shared.ts'

const isUnique = (e: any) => e?.code === '23505' || e?.cause?.code === '23505' || /unique|duplicate key/i.test(String(e?.message || e?.cause?.message || ''))

const isPrivate = isPrivatePayer

// The phone could not get a fix at a punch (ported from CVHC).
const GPS_ERROR = { 1: 'location permission denied', 2: 'no GPS signal', 3: 'GPS timeout' } as Record<number, string>

const MAX_PHOTO_CHARS = 7_000_000 // ~5 MB raw once base64-decoded

// The geofence settings an office may set (the rest of the row is the server's).
const GEOFENCE_FIELDS = ['radiusFeet', 'autoClockIn', 'autoClockOut', 'requireGps', 'notifyAdminOnOverride'] as const

export function createTimeTrackingRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const { notify } = core
  const app = new Hono<AppEnv>()

  // EVERY path that closes a visit calls this — clock-out, the auto-close when a caregiver clocks into the next client,
  // and the office's force clock-out — so the EVV record is made in one place (core/evvVisits.ts), which upserts on
  // time_entry_id, enqueues a ready visit for Sandata and never throws.
  const onVisitClosed = (companyId: string, timeEntryId: string) => core.evvVisits.createEVVFromTimeEntry(companyId, timeEntryId)

  /** The client's payer decides the billing rule (shared.ts, the phone line's too). */
  const payerOf = (companyId: string, clientId: string) => sharedPayerOf(db, companyId, clientId)

  async function nameOf(companyId: string, userId: string): Promise<{ firstName: string | null; lastName: string | null } | null> {
    const [u] = await db.select({ firstName: user.firstName, lastName: user.lastName }).from(user)
      .where(and(eq(user.id, userId), eq(user.companyId, companyId))).limit(1)
    return u ?? null
  }

  async function clientName(companyId: string, clientId: string): Promise<{ firstName: string | null; lastName: string | null } | null> {
    const [cl] = await db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    return cl ?? null
  }

  async function entryOf(companyId: string, id: string) {
    const [e] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1)
    return e ?? null
  }

  // GET / — the office list (a caregiver sees only their own). The read-only office seat (care-office:read) reads each
  // visit's times and EVV status — not its GPS points, notes, billable minutes or the client's address (live role check,
  // 2026-10-23). Whoever holds evv:read reads the rows as before.
  const canSee = canSeeWith(d.permissions)
  app.get('/', d.permissions.requireAnyPermission(['evv:read', 'care-office:read']), async (c) => {
    const { user: u, companyId, me } = who(c)
    const caregiverId = c.req.query('caregiverId')
    const clientId = c.req.query('clientId')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    const isComplete = c.req.query('isComplete')
    const page = intParam(c.req.query('page'), 1)
    const limit = intParam(c.req.query('limit'), 50)

    const conditions: any[] = [eq(timeEntries.companyId, companyId)]
    if (isCaregiver(d, u)) conditions.push(eq(timeEntries.caregiverId, me))
    else if (caregiverId) conditions.push(eq(timeEntries.caregiverId, caregiverId))
    if (clientId) conditions.push(eq(timeEntries.clientId, clientId))
    if (isComplete !== undefined) conditions.push(eq(timeEntries.isComplete, isComplete === 'true'))
    // A day is the agency's own day (midnight to midnight in its zone). The filter used to cut at UTC midnight (start) and at 23:59:59 in the
    // server's zone (end), so for a Central agency a visit at 8 PM on the end date, or one at 7 PM the evening before the start date, landed on the wrong side.
    const span = await core.time.range(companyId, startDate, endDate)
    if (span.from) conditions.push(gte(timeEntries.startTime, span.from))
    if (span.before) conditions.push(lt(timeEntries.startTime, span.before))
    const whereClause = and(...conditions)

    const [entries, [{ value: total }]] = await Promise.all([
      db.select({
        id: timeEntries.id, caregiverId: timeEntries.caregiverId, clientId: timeEntries.clientId,
        assignmentId: timeEntries.assignmentId, scheduleId: timeEntries.scheduleId,
        startTime: timeEntries.startTime, endTime: timeEntries.endTime, durationMinutes: timeEntries.durationMinutes,
        allottedMinutes: timeEntries.allottedMinutes, billableMinutes: timeEntries.billableMinutes,
        discrepancyMinutes: timeEntries.discrepancyMinutes, clockInLocation: timeEntries.clockInLocation,
        clockOutLocation: timeEntries.clockOutLocation, isComplete: timeEntries.isComplete, notes: timeEntries.notes,
        needsApproval: timeEntries.needsApproval, approvalReason: timeEntries.approvalReason,
        createdAt: timeEntries.createdAt, updatedAt: timeEntries.updatedAt,
        caregiverFirstName: user.firstName, caregiverLastName: user.lastName,
        clientFirstName: clients.firstName, clientLastName: clients.lastName, clientAddress: clients.address, clientCity: clients.city,
      })
        .from(timeEntries)
        .leftJoin(user, eq(user.id, timeEntries.caregiverId))
        .leftJoin(clients, eq(clients.id, timeEntries.clientId))
        .where(whereClause)
        .orderBy(desc(timeEntries.startTime))
        .offset((page - 1) * limit)
        .limit(limit),
      db.select({ value: count() }).from(timeEntries).where(whereClause),
    ])

    const ids = entries.map((e: any) => e.id)
    const evvMap: Record<string, { id: string; sandataStatus: string | null; isVerified: boolean | null }> = {}
    if (ids.length) {
      const evvRows = await db.select({ id: evvVisits.id, sandataStatus: evvVisits.sandataStatus, isVerified: evvVisits.isVerified, timeEntryId: evvVisits.timeEntryId })
        .from(evvVisits).where(and(eq(evvVisits.companyId, companyId), inArray(evvVisits.timeEntryId, ids)))
      for (const r of evvRows) evvMap[r.timeEntryId] = { id: r.id, sandataStatus: r.sandataStatus, isVerified: r.isVerified }
    }

    const data = entries.map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, clientAddress, clientCity, ...e }: any) => ({
      ...e,
      caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
      client: { firstName: clientFirstName, lastName: clientLastName, address: clientAddress, city: clientCity },
      evvVisit: evvMap[e.id] || null,
    }))
    if (!(await canSee(u.role, 'evv:read', u.userId))) {
      return list(c, data.map((e: any) => ({
        id: e.id, caregiverId: e.caregiverId, clientId: e.clientId, scheduleId: e.scheduleId,
        startTime: e.startTime, endTime: e.endTime, durationMinutes: e.durationMinutes, isComplete: e.isComplete, needsApproval: e.needsApproval,
        caregiver: e.caregiver, client: { firstName: e.client.firstName, lastName: e.client.lastName }, evvVisit: e.evvVisit,
      })), { page, limit, total: Number(total) })
    }
    return list(c, data, { page, limit, total: Number(total) })
  })

  // GET /active — a caregiver's own open visit (the visit, or null); for the office, everyone clocked in.
  app.get('/active', requirePermission('evv:read'), async (c) => {
    const { user: u, companyId, me } = who(c)
    if (isCaregiver(d, u)) {
      const [e] = await db.select({
        id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime,
        clientFirstName: clients.firstName, clientLastName: clients.lastName,
      }).from(timeEntries).innerJoin(clients, eq(clients.id, timeEntries.clientId))
        .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, me), isNull(timeEntries.endTime)))
        .orderBy(desc(timeEntries.startTime)).limit(1)
      // No open visit: null, as the template answered (the caregiver app reads "nothing open" from it).
      if (!e) return one(c, null as unknown as object)
      return one(c, { id: e.id, clientId: e.clientId, startTime: e.startTime, clientName: `${e.clientFirstName} ${e.clientLastName}` })
    }

    const active = await db.select({
      id: timeEntries.id, caregiverId: timeEntries.caregiverId, clientId: timeEntries.clientId,
      startTime: timeEntries.startTime, endTime: timeEntries.endTime, isComplete: timeEntries.isComplete,
      clockInLocation: timeEntries.clockInLocation, allottedMinutes: timeEntries.allottedMinutes, notes: timeEntries.notes,
      createdAt: timeEntries.createdAt, updatedAt: timeEntries.updatedAt,
      cgId: user.id, cgFirstName: user.firstName, cgLastName: user.lastName, cgPhone: user.phone,
      clId: clients.id, clFirstName: clients.firstName, clLastName: clients.lastName, clAddress: clients.address, clCity: clients.city,
    })
      .from(timeEntries)
      .leftJoin(user, eq(user.id, timeEntries.caregiverId))
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(and(eq(timeEntries.companyId, companyId), isNull(timeEntries.endTime), eq(timeEntries.isComplete, false)))

    const data = await Promise.all(active.map(async (e: any) => {
      const gpsPoints = await db.select().from(gpsTracking)
        .where(and(eq(gpsTracking.companyId, companyId), eq(gpsTracking.timeEntryId, e.id)))
        .orderBy(desc(gpsTracking.timestamp)).limit(1)
      return {
        id: e.id, caregiverId: e.caregiverId, clientId: e.clientId, startTime: e.startTime, endTime: e.endTime,
        isComplete: e.isComplete, clockInLocation: e.clockInLocation, allottedMinutes: e.allottedMinutes, notes: e.notes,
        createdAt: e.createdAt, updatedAt: e.updatedAt,
        caregiver: { id: e.cgId, firstName: e.cgFirstName, lastName: e.cgLastName, phone: e.cgPhone },
        client: { id: e.clId, firstName: e.clFirstName, lastName: e.clLastName, address: e.clAddress, city: e.clCity },
        gpsPoints,
      }
    }))
    return listAll(c, data)
  })

  // GET /recent — the caregiver's last finished visits
  app.get('/recent', requirePermission('evv:read'), async (c) => {
    const { companyId, me } = who(c)
    const limit = Math.min(intParam(c.req.query('limit'), 10), 100)
    const entries = await db.select({
      id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime, endTime: timeEntries.endTime,
      durationMinutes: timeEntries.durationMinutes, notes: timeEntries.notes,
      clientFirstName: clients.firstName, clientLastName: clients.lastName,
    }).from(timeEntries).innerJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, me), isNotNull(timeEntries.endTime)))
      .orderBy(desc(timeEntries.startTime)).limit(limit)
    const data = entries.map((e: any) => ({
      id: e.id, clientId: e.clientId, startTime: e.startTime, endTime: e.endTime, notes: e.notes,
      hoursWorked: e.durationMinutes ? (e.durationMinutes / 60).toFixed(2) : null,
      clientName: `${e.clientFirstName} ${e.clientLastName}`,
      client: { firstName: e.clientFirstName, lastName: e.clientLastName },
    }))
    return list(c, data, { page: 1, limit, total: data.length })
  })

  // POST /check-warnings { timeEntryId } — the caregiver's own open visit: 15 minutes left, or over.
  app.post('/check-warnings', requirePermission('evv:read'), async (c) => {
    const { companyId, me } = who(c)
    const { timeEntryId } = await c.req.json().catch(() => ({})) as any
    if (!timeEntryId) return one(c, { warning: false })
    const [te] = await db.select({ id: timeEntries.id, startTime: timeEntries.startTime, allottedMinutes: timeEntries.allottedMinutes,
      clientFirst: clients.firstName, clientLast: clients.lastName })
      .from(timeEntries).innerJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.id, String(timeEntryId)), eq(timeEntries.caregiverId, me), eq(timeEntries.isComplete, false))).limit(1)
    if (!te || !te.allottedMinutes) return one(c, { warning: false })
    const minutesElapsed = (Date.now() - te.startTime.getTime()) / 60000
    const minutesRemaining = te.allottedMinutes - minutesElapsed
    if (minutesRemaining >= 14 && minutesRemaining <= 16) {
      const tz = await core.time.timezone(companyId)
      const ends = fmtClock(new Date(te.startTime.getTime() + te.allottedMinutes * 60000), tz)
      await notify.sendPush(me, { title: '15-Minute Warning', body: `Shift with ${te.clientFirst} ${te.clientLast} ends at ${ends}. Start wrapping up!`, tag: 'shift-warning-15min', data: { type: 'shift_warning', timeEntryId } })
      return one(c, { warning: true, minutesRemaining: Math.round(minutesRemaining), message: '15 minutes remaining — start wrapping up' })
    }
    if (minutesElapsed > te.allottedMinutes + 5) {
      return one(c, { warning: true, overTime: true, minutesOver: Math.round(minutesElapsed - te.allottedMinutes), message: 'Over scheduled time — please clock out' })
    }
    return one(c, { warning: false, minutesRemaining: Math.round(minutesRemaining), minutesElapsed: Math.round(minutesElapsed) })
  })

  // GET /caregiver-history/:id?startDate&endDate — a caregiver's punches (the office, or the caregiver themself). The
  // days are the agency's (core.time.range: a YYYY-MM-DD runs midnight to midnight on the agency's clock); the template
  // took the filter and never applied it, so the Full Profile's From / To searched every visit ever.
  app.get('/caregiver-history/:id', requirePermission('evv:read'), requireAdminOrSelf(d, 'id', 'evv:read'), async (c) => {
    const { companyId } = who(c)
    const caregiverId = c.req.param('id')!
    const page = intParam(c.req.query('page'), 1)
    const limit = intParam(c.req.query('limit'), 50)
    const { from, before } = await core.time.range(companyId, c.req.query('startDate'), c.req.query('endDate'))
    const where = and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, caregiverId),
      from ? gte(timeEntries.startTime, from) : undefined, before ? lt(timeEntries.startTime, before) : undefined)
    const [entries, [{ value: total }]] = await Promise.all([
      db.select({
        id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime, endTime: timeEntries.endTime,
        durationMinutes: timeEntries.durationMinutes, billableMinutes: timeEntries.billableMinutes,
        isComplete: timeEntries.isComplete, notes: timeEntries.notes,
        clientFirstName: clients.firstName, clientLastName: clients.lastName, clientAddress: clients.address, clientCity: clients.city,
      })
        .from(timeEntries).leftJoin(clients, eq(clients.id, timeEntries.clientId))
        .where(where).orderBy(desc(timeEntries.startTime)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(timeEntries).where(where),
    ])
    // Each visit's GPS point count: the history's "View Route" shows only for a visit with points (the reply carried
    // no count, so every visit read "No GPS data" and the route map was never reached).
    const ids = entries.map((e: any) => e.id)
    const points = ids.length ? await db.select({ timeEntryId: gpsTracking.timeEntryId, n: count() }).from(gpsTracking)
      .where(and(eq(gpsTracking.companyId, companyId), inArray(gpsTracking.timeEntryId, ids))).groupBy(gpsTracking.timeEntryId) : []
    const pointsBy = new Map(points.map((p: any) => [p.timeEntryId, Number(p.n)]))
    const data = entries.map((e: any) => ({ ...e, gpsPointCount: pointsBy.get(e.id) ?? 0, client: { firstName: e.clientFirstName, lastName: e.clientLastName } }))
    return list(c, data, { page, limit, total: Number(total) })
  })

  // GET /caregiver-gps/:id — the GPS trail of a caregiver's recent visits
  app.get('/caregiver-gps/:id', requirePermission('evv:read'), requireAdminOrSelf(d, 'id', 'evv:read'), async (c) => {
    const { companyId } = who(c)
    const points = await db.select().from(gpsTracking)
      .where(and(eq(gpsTracking.companyId, companyId), eq(gpsTracking.caregiverId, c.req.param('id')!)))
      .orderBy(desc(gpsTracking.timestamp)).limit(100)
    return list(c, points, { page: 1, limit: 100, total: points.length })
  })

  // GET /pending-approval — the office's queue of flagged, finished entries
  app.get('/pending-approval', requirePermission(OFFICE_EVV), async (c) => {
    const rows = await pendingApprovalEntries(db, who(c).companyId)
    return listAll(c, rows)
  })

  // PATCH /:id/approve { billable_minutes?, notes?, reject? } — the office resolves a flagged entry.
  //   reject: true → billable 0 (the shift is not paid); billable_minutes → override; neither → as is.
  app.patch('/:id/approve', requirePermission(OFFICE_EVV), async (c) => {
    const { companyId, me } = who(c)
    const id = c.req.param('id')
    const b = await c.req.json().catch(() => ({})) as any
    const existing = await entryOf(companyId, id)
    if (!existing) return fail(c, 404, 'Time entry not found')
    let billable: number | null
    if (b.reject === true) billable = 0
    else if (b.billable_minutes != null && b.billable_minutes !== '') {
      const n = Number(b.billable_minutes)
      if (!Number.isInteger(n) || n < 0) return fail(c, 400, 'billable_minutes must be a non-negative integer')
      billable = n
    } else billable = existing.billableMinutes
    const [updated] = await db.update(timeEntries).set({
      billableMinutes: billable, approvedBillableMinutes: billable, approvedById: me, approvedAt: new Date(),
      approvalNotes: typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 1000) : null, needsApproval: false, updatedAt: new Date(),
    }).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).returning()
    await notify.recordAudit(companyId, me, 'APPROVE', 'time_entries', id, existing, updated)
    return one(c, updated)
  })

  // POST /clock-in { clientId, latitude?, longitude?, scheduleId?, autoClockIn?, autoTransition?, offlineAt? }
  app.post('/clock-in', requirePermission('evv:create'), async (c) => {
    const { companyId, me: caregiverId } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const { clientId, latitude, longitude, scheduleId } = b
    if (!clientId) return fail(c, 400, 'clientId is required')
    if (!(await clientName(companyId, String(clientId)))) return fail(c, 404, 'Client not found')

    // Automatic schedule transition stays off: it closed the previous visit and opened the next while the caregiver was
    // still in the previous client's home, and their note landed on the wrong client.
    if (b.autoTransition) {
      return fail(c, 409, 'Automatic shift transition is disabled — clock out, then clock in for your next client when you arrive.', 'auto_transition_disabled')
    }

    const offline = parseOfflineAt(b.offlineAt)
    if (offline.error) return fail(c, 400, offline.error, offline.code || 'offline_punch_invalid')
    const punchAt = offline.at
    const at = punchAt || new Date()
    // Questions at clock-in (care_visit_questions): a required one blocks a live clock-in; a punch saved offline is a fact and is kept.
    const asked = await core.visitQuestions.gate(companyId, 'clock_in', b.answers, !punchAt)
    if (Object.keys(asked.problems).length) return questionsRefusal(c, asked)

    const loc = (src?: string) => latitude && longitude
      ? (punchAt ? { lat: latitude, lng: longitude, source: src || 'offline', captured_at: punchAt.toISOString() } : { lat: latitude, lng: longitude })
      : (b.clockInLocation || null)

    if (punchAt) {
      // Place a saved tap against what the server already has for this caregiver.
      const around = await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime,
        endTime: timeEntries.endTime, approvalReason: timeEntries.approvalReason, clockInLocation: timeEntries.clockInLocation })
        .from(timeEntries)
        .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, caregiverId),
          or(isNull(timeEntries.endTime), gt(timeEntries.endTime, new Date(at.getTime() - 120000)))))
        .orderBy(asc(timeEntries.startTime))
      const t = at.getTime()
      const same = around.find((e: any) => e.clientId === clientId && Math.abs(e.startTime.getTime() - t) <= 120000)
      if (same) return one(c, { id: same.id, clientId: same.clientId, startTime: same.startTime, duplicate: true })
      const covering = around.find((e: any) => e.startTime.getTime() <= t && (!e.endTime || e.endTime.getTime() > t))
      if (covering && covering.clientId === clientId) return one(c, { id: covering.id, clientId: covering.clientId, startTime: covering.startTime, duplicate: true })
      const later = around.filter((e: any) => e.startTime.getTime() > t)
      // The tap failed at the door, then the app clocked her in later for the SAME visit: one visit — move its start
      // back to the real tap time.
      if (later.length === 1 && later[0].clientId === clientId && !later[0].endTime && !covering) {
        const flag = withOfflineFlag({ needsApproval: true, approvalReason: later[0].approvalReason }, true)
        const prevLoc: any = later[0].clockInLocation
        const [merged] = await db.update(timeEntries).set({
          startTime: at,
          clockInLocation: loc() || (prevLoc ? { ...prevLoc, source: 'later_punch', captured_at: later[0].startTime } : null),
          needsApproval: true, approvalReason: flag.approvalReason, updatedAt: new Date(),
        }).where(and(eq(timeEntries.id, later[0].id), eq(timeEntries.companyId, companyId), isNull(timeEntries.endTime))).returning()
        if (merged) {
          await notify.recordAudit(companyId, caregiverId, 'UPDATE', 'time_entries', later[0].id, { start_time: later[0].startTime }, { start_time: at.toISOString(), reason: 'offline_punch_merged' })
          return one(c, { id: merged.id, clientId: merged.clientId, startTime: merged.startTime, merged: true })
        }
      }
      // Anything else overlaps recorded time in a way the server must not guess about.
      if (later.length || (covering && covering.endTime)) {
        const cg = await nameOf(companyId, caregiverId)
        const cl = await clientName(companyId, String(clientId))
        const tz = await core.time.timezone(companyId)
        const name = cg ? `${cg.firstName} ${cg.lastName}` : 'A caregiver'
        const client = cl ? `${cl.firstName} ${cl.lastName}` : 'a client'
        const why = later.length ? 'later time already recorded' : 'another visit covers that time'
        await notify.notifyAdmins(companyId, 'offline_punch_conflict', `Offline clock-in needs review: ${name}`,
          `${name}'s phone saved a clock-in for ${client} at ${formatInZone(at, tz)} with no signal, but it overlaps other time already recorded (${why}). Check their time for that day and fix it in Payroll → Shift Review.`)
        return fail(c, 409, 'Your saved clock-in overlaps time already recorded — the office has been notified to fix it.', 'offline_conflict')
      }
    }

    // Open entries for this caregiver, with the payer, so an auto-close applies the right rule.
    const open = (await db.select({
      id: timeEntries.id, clientId: timeEntries.clientId, allottedMinutes: timeEntries.allottedMinutes,
      approvalReason: timeEntries.approvalReason, startTime: timeEntries.startTime, notes: timeEntries.notes,
      isPrivatePay: clients.isPrivatePay, payerType: referralSources.payerType,
    }).from(timeEntries)
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .leftJoin(referralSources, eq(referralSources.id, clients.referredById))
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, caregiverId), isNull(timeEntries.endTime))))
      .map((e: any) => ({ ...e, secondsElapsed: (at.getTime() - e.startTime.getTime()) / 1000 }))

    // Idempotent clock-in: a second tap for the same client within 30 s returns the first entry.
    const dupe = open.find((e: any) => e.clientId === clientId && e.secondsElapsed < 30)
    if (dupe) return one(c, { id: dupe.id, clientId: dupe.clientId, startTime: dupe.startTime, duplicate: true })

    // Which visit is this punch for? It decides allotted_minutes, which becomes billable_minutes and so the units on the
    // payer's claim. Expand through the one engine (dates, cancellations, overrides) and pick the occurrence whose start
    // is NEAREST the punch, in the agency's own day and clock.
    let allottedMinutes: number | null = null
    let linkedScheduleId: string | null = scheduleId || null
    let liveNow = false
    try {
      const { date, time } = await core.time.now(companyId, at)
      const m = await occurrenceForPunch(db, companyId, caregiverId, String(clientId), date, time)
      if (m) {
        linkedScheduleId = linkedScheduleId || m.id
        if (m.minutes != null) allottedMinutes = Number(m.minutes)
        liveNow = m.activeNow === true
      }
    } catch (e: any) { d.logger.error('[clock-in] schedule match failed', { error: e?.message }) }

    // The phone auto-clocks people in on arrival. With no live visit right now (cancelled, or none), refuse the
    // AUTOMATIC clock-in. A manual one is never blocked — it surfaces as unscheduled.
    if (b.autoClockIn && !liveNow) {
      return fail(c, 409, 'No active scheduled visit right now — automatic clock-in skipped. Clock in manually if you are on site.', 'no_active_occurrence')
    }

    // (The match and the automatic-clock-in refusal come BEFORE the auto-close: CVHC closed the open visit first, so a
    // REFUSED automatic clock-in still ended the visit the caregiver was still at.)
    const AUTO_CLOSED = '(Auto-closed: caregiver clocked into new client)'
    for (const oe of open) {
      const secondsElapsed = Number(oe.secondsElapsed) || 0
      // Switching clients within 10 s of clocking in: the first tap was a mistake — drop it.
      if (secondsElapsed < 10) {
        await db.delete(gpsTracking).where(and(eq(gpsTracking.companyId, companyId), eq(gpsTracking.timeEntryId, oe.id)))
        await db.delete(timeEntries).where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.id, oe.id)))
        await notify.recordAudit(companyId, caregiverId, 'DELETE', 'time_entries', oe.id, null, { reason: 'spurious_auto_close', seconds_elapsed: secondsElapsed })
        continue
      }
      const dec = decideBilling({ durationSeconds: secondsElapsed, allottedMinutes: oe.allottedMinutes, isPrivatePay: isPrivate(oe), zeroGuard: false })
      const flag = withOfflineFlag(dec, !!punchAt || hasOfflineFlag(oe.approvalReason))
      await db.update(timeEntries).set({
        endTime: at, durationMinutes: dec.durationMinutes, isComplete: true,
        discrepancyMinutes: dec.discrepancyMinutes, billableMinutes: dec.billableMinutes,
        needsApproval: flag.needsApproval, approvalReason: flag.approvalReason,
        notes: !oe.notes ? AUTO_CLOSED : `${oe.notes} | ${AUTO_CLOSED}`,
        updatedAt: new Date(),
      }).where(and(eq(timeEntries.id, oe.id), eq(timeEntries.companyId, companyId)))
      await notify.recordAudit(companyId, caregiverId, 'UPDATE', 'time_entries', oe.id, null, { auto_closed: true, duration_minutes: dec.durationMinutes })
      await onVisitClosed(companyId, oe.id)
    }

    let entry: any
    try {
      ;[entry] = await db.insert(timeEntries).values({
        companyId, caregiverId, clientId: String(clientId), scheduleId: linkedScheduleId, startTime: at, clockInLocation: loc(), allottedMinutes,
        notes: b.notes || null, needsApproval: !!punchAt, approvalReason: punchAt ? 'offline_punch' : null,
      }).returning()
    } catch (e: any) {
      // One open entry per caregiver (the template's 0016 unique index): the twin of a concurrent tap loses and gets
      // the winner back.
      if (isUnique(e)) {
        const [w] = await db.select().from(timeEntries).where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, caregiverId), isNull(timeEntries.endTime))).limit(1)
        if (w) return one(c, { id: w.id, clientId: w.clientId, startTime: w.startTime, duplicate: true })
      }
      throw e
    }
    await notify.recordAudit(companyId, caregiverId, 'CREATE', 'time_entries', entry.id, null, entry)
    try { await core.visitQuestions.record(companyId, entry, 'clock_in', asked.questions, asked.clean, caregiverId) } catch (e: any) { d.logger.error('[clock-in] answers', { error: e?.message }) }
    // EVV: does this visit go to Sandata (weekly EVV allowance)? Decided after the punch is saved and capped, so it never
    // blocks the clock-in; null = no answer, and the app prompts as before.
    const sandataRequired = await core.evvVisits.recordSandataDecision(companyId, entry.id, entry.clientId, entry.startTime.toISOString())
    // The relatives who asked are told she has arrived (not waited for: the text never delays the punch).
    void core.familyTexts.onClockEvent(companyId, entry, 'clock_in', at)
    return one(c, { ...entry, sandataRequired }, 201)
  })

  /** A live punch refused because a question is unanswered or answered badly: 409, with { questionId: sentence } to point at each. */
  function questionsRefusal(c: any, asked: { questions: { id: string; prompt: string }[]; problems: Record<string, string> }) {
    const prompts = asked.questions.filter((q) => asked.problems[q.id]).map((q) => `"${q.prompt}"`)
    return fail(c, 409, `Answer ${prompts.length === 1 ? 'this question' : 'these questions'} first: ${prompts.join(', ')}.`, 'questions_required', asked.problems)
  }

  // The clock-out itself, shared by POST /:id/clock-out and the older POST /clock-out { timeEntryId }.
  async function clockOut(c: any, timeEntryId: string, b: any) {
    const { user: u, companyId, me } = who(c)
    const { latitude, longitude, notes } = b
    const entry = await entryOf(companyId, timeEntryId)
    if (!entry) return fail(c, 404, 'Time entry not found')
    if (isCaregiver(d, u) && entry.caregiverId !== me) return fail(c, 404, 'Time entry not found')
    // Idempotent: a replay or stale re-tap on a closed entry changes nothing (it used to stretch the shift to NOW and
    // wipe the clock-out location). Corrections go through the office.
    if (entry.endTime) return one(c, { ...entry, alreadyComplete: true })

    const payer = await payerOf(companyId, entry.clientId)
    // VA documentation rule: a VA client's visit needs a note to clock out.
    if (payer?.payerType === 'va' && !String(notes || '').trim()) {
      return fail(c, 400, 'This is a VA client — a visit note is required to clock out. Please add a short note about the visit.', 'va_note_required')
    }

    const offline = parseOfflineAt(b.offlineAt)
    if (offline.error) return fail(c, 400, offline.error, offline.code || 'offline_punch_invalid')
    let endAt = offline.at
    if (endAt && endAt < entry.startTime) endAt = entry.startTime
    const end = endAt || new Date()

    // Required tasks (care_required_tasks): a live clock-out waits until each is done, or skipped / refused with a
    // reason. A clock-out saved on the phone while offline is already a fact, so it is recorded and flagged for the
    // office instead of being refused when it finally arrives.
    const openRequired = await core.requiredTasks.pendingFor(companyId, entry)
    if (openRequired.length && !endAt) {
      const names = openRequired.map((t) => t.taskName)
      // fields: task id → task name, so a screen can point at the exact rows still open.
      return fail(c, 409,
        `Finish the required task${names.length === 1 ? '' : 's'} before clocking out: ${names.join(', ')}. Mark ${names.length === 1 ? 'it' : 'each'} done, or skip it and say why.`,
        'required_tasks_pending', Object.fromEntries(openRequired.map((t) => [t.taskId, t.taskName])))
    }

    // Forms, interventions, goals and tasks for every visit (care_visit_items): a required one waits, like a required task; one that is
    // still open when a clock-out arrives from the phone's offline queue is recorded and flagged. And the agency's visit-note rule.
    const openItems = await core.visitItems.pendingFor(companyId, entry)
    if (openItems.length && !endAt) {
      const names = openItems.map((i) => i.name)
      return fail(c, 409, `Finish ${names.length === 1 ? 'this' : 'these'} before clocking out: ${names.join(', ')}. Mark ${names.length === 1 ? 'it' : 'each'} done, or skip it and say why.`,
        'required_items_pending', Object.fromEntries(openItems.map((i) => [i.id, i.name])))
    }
    const noteMissing = !String(notes || entry.notes || '').trim() && await core.visitItems.noteRequired(companyId)
    if (noteMissing && !endAt) return fail(c, 400, 'This agency needs a visit note to clock out. Please add a short note about the visit.', 'note_required')

    // Questions at clock-out (care_visit_questions): the same rule as at clock-in.
    const asked = await core.visitQuestions.gate(companyId, 'clock_out', b.answers, !endAt)
    if (Object.keys(asked.problems).length) return questionsRefusal(c, asked)

    const dec = decideBilling({ durationSeconds: (end.getTime() - entry.startTime.getTime()) / 1000, allottedMinutes: entry.allottedMinutes, isPrivatePay: isPrivate(payer) })
    const baseFlag = withOfflineFlag(dec, !!endAt || hasOfflineFlag(entry.approvalReason))
    const flagged = [
      openRequired.length ? `Required tasks not recorded: ${openRequired.map((t) => t.taskName).join(', ')}` : '',
      openItems.length ? `Required items not recorded: ${openItems.map((i) => i.name).join(', ')}` : '',
      noteMissing ? 'No visit note' : '',
    ].filter(Boolean)
    const flag = flagged.length
      ? { needsApproval: true, approvalReason: [baseFlag.approvalReason, ...flagged].filter(Boolean).join(' · ') }
      : baseFlag
    const outLoc = latitude && longitude
      ? (endAt ? { lat: latitude, lng: longitude, source: 'offline', captured_at: endAt.toISOString() } : { lat: latitude, lng: longitude })
      : (b.clockOutLocation || null)

    const [updated] = await db.update(timeEntries).set({
      endTime: end, clockOutLocation: outLoc, durationMinutes: dec.durationMinutes, isComplete: true,
      notes: notes || entry.notes || null, discrepancyMinutes: dec.discrepancyMinutes, billableMinutes: dec.billableMinutes,
      needsApproval: flag.needsApproval, approvalReason: flag.approvalReason, updatedAt: new Date(),
    }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.companyId, companyId), isNull(timeEntries.endTime))).returning()
    if (!updated) {
      const now = await entryOf(companyId, entry.id)
      return one(c, { ...now, alreadyComplete: true })
    }
    await notify.recordAudit(companyId, me, 'UPDATE', 'time_entries', entry.id, null, updated)
    try { await core.visitQuestions.record(companyId, entry, 'clock_out', asked.questions, asked.clean, me) } catch (e: any) { d.logger.error('[clock-out] answers', { error: e?.message }) }

    // Fill a MISSING clock-in / clock-out location from the visit's GPS breadcrumbs (within 10 minutes of the event),
    // flagged source:'breadcrumb' — presence evidence, distinguishable from a tap fix.
    try {
      if (!updated.clockInLocation) {
        const [g] = await db.select().from(gpsTracking).where(and(eq(gpsTracking.companyId, companyId), eq(gpsTracking.timeEntryId, entry.id),
          lte(gpsTracking.timestamp, new Date(entry.startTime.getTime() + 600000)))).orderBy(asc(gpsTracking.timestamp)).limit(1)
        if (g) await db.update(timeEntries).set({ clockInLocation: { lat: Number(g.latitude), lng: Number(g.longitude), source: 'breadcrumb', captured_at: g.timestamp } })
          .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.companyId, companyId), isNull(timeEntries.clockInLocation)))
      }
      if (!updated.clockOutLocation) {
        const [g] = await db.select().from(gpsTracking).where(and(eq(gpsTracking.companyId, companyId), eq(gpsTracking.timeEntryId, entry.id),
          gte(gpsTracking.timestamp, new Date(end.getTime() - 600000)))).orderBy(desc(gpsTracking.timestamp)).limit(1)
        if (g) await db.update(timeEntries).set({ clockOutLocation: { lat: Number(g.latitude), lng: Number(g.longitude), source: 'breadcrumb', captured_at: g.timestamp } })
          .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.companyId, companyId), isNull(timeEntries.clockOutLocation)))
      }
    } catch (e: any) { d.logger.error('[clock-out] breadcrumb backfill', { error: e?.message }) }

    await onVisitClosed(companyId, entry.id)
    // …and that she has finished.
    void core.familyTexts.onClockEvent(companyId, updated, 'clock_out', end)
    // The clock-in's Sandata decision is on the row (sandataRequired), so the clock-out prompt matches it.
    return one(c, updated)
  }

  app.post('/clock-out', requirePermission('evv:update'), async (c) => {
    const b = await c.req.json().catch(() => ({})) as any
    if (!b.timeEntryId) return fail(c, 400, 'timeEntryId is required')
    return clockOut(c, String(b.timeEntryId), b)
  })
  app.post('/:id/clock-out', requirePermission('evv:update'), async (c) => clockOut(c, c.req.param('id'), await c.req.json().catch(() => ({}))))

  // POST /:id/late-location { latitude, longitude, which? } — the phone's fix arrived after the tap. Owner-only; only
  // FILLS a missing location; only within 15 minutes; flagged source:'delayed'.
  app.post('/:id/late-location', requirePermission('evv:update'), async (c) => {
    const { companyId, me } = who(c)
    const { latitude, longitude, which } = await c.req.json().catch(() => ({})) as any
    if (!latitude || !longitude) return fail(c, 400, 'latitude and longitude required')
    const loc = { lat: latitude, lng: longitude, source: 'delayed', captured_at: new Date().toISOString() }
    const cutoff = new Date(Date.now() - 15 * 60000)
    const mine = and(eq(timeEntries.id, c.req.param('id')), eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, me))
    const r = which === 'clock_out'
      ? await db.update(timeEntries).set({ clockOutLocation: loc, updatedAt: new Date() }).where(and(mine,
          isNull(timeEntries.clockOutLocation), isNotNull(timeEntries.endTime), gte(timeEntries.endTime, cutoff))).returning({ id: timeEntries.id })
      : await db.update(timeEntries).set({ clockInLocation: loc, updatedAt: new Date() }).where(and(mine,
          isNull(timeEntries.clockInLocation), gte(timeEntries.startTime, cutoff))).returning({ id: timeEntries.id })
    return one(c, { updated: r.length })
  })

  // POST /gps-failure { action: 'clock-in'|'clock-out', errorCode?: 1|2|3, clientId? } — the phone could not get a fix
  // at a punch. Every active office user is told (in-app + push), so someone can help; the caller's own OPEN visit, if
  // any, gets an audit row. A caregiver may name only a client they care for.
  app.post('/gps-failure', requirePermission('evv:create'), async (c) => {
    const { user: u, companyId, me } = who(c)
    const { action, errorCode, clientId } = await c.req.json().catch(() => ({})) as any
    if (clientId && !(await core.access.maySeeClient(u, String(clientId)))) return fail(c, 403, 'You can only see the clients you care for.')
    const cg = await nameOf(companyId, me)
    const name = `${cg?.firstName || ''} ${cg?.lastName || ''}`.trim() || 'A caregiver'
    const cl = clientId ? await clientName(companyId, String(clientId)) : null
    const code = Number(errorCode)
    const reason = GPS_ERROR[code] || 'unknown GPS error'
    const advice = code === 1 ? "Check their phone's Location settings — permission is off."
      : code === 2 ? 'Their phone reported no location available (airplane mode / location off?).'
      : 'The fix was slow, not blocked — the punch went through and a late fix or breadcrumbs may still fill it in.'
    const title = `📍 GPS blocked: ${name}`
    const message = `${name} tried to ${action === 'clock-out' ? 'clock out' : 'clock in'}${cl ? ` (client: ${cl.firstName} ${cl.lastName})` : ''} but GPS failed (${reason}). ${advice}`
    const [open] = await db.select({ id: timeEntries.id }).from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, me), isNull(timeEntries.endTime)))
      .orderBy(desc(timeEntries.startTime)).limit(1)
    if (open) await notify.recordAudit(companyId, me, 'GPS_FAILURE', 'time_entries', open.id, null, { action: action || null, error_code: Number.isFinite(code) ? code : null, reason })
    const admins = await notify.notifyAdmins(companyId, 'gps_failure', title, message)
    for (const a of admins) await notify.sendPush(a.id, { title, body: message, tag: `gps-failure-${me}`, data: { type: 'gps_failure', caregiverId: me } })
    return one(c, { success: true, alerted: admins.length, timeEntryId: open?.id || null })
  })

  // GET /gps-failures-recent — the office user's own open GPS alerts
  app.get('/gps-failures-recent', requirePermission(OFFICE_EVV), async (c) => {
    const { companyId, me } = who(c)
    const minutes = Math.max(1, Math.min(parseInt(c.req.query('minutes') || '') || 60, 240))
    const failures = await db.select({ id: notifications.id, title: notifications.title, message: notifications.message, createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.companyId, companyId), eq(notifications.userId, me), eq(notifications.type, 'gps_failure'),
        eq(notifications.status, 'new'), gt(notifications.createdAt, new Date(Date.now() - minutes * 60000))))
      .orderBy(desc(notifications.createdAt)).limit(50)
    return one(c, { count: failures.length, failures, windowMinutes: minutes })
  })

  // POST /:id/admin-force-clockout { reason?, endTime?, scheduled?, evvReasonCode?, evvReasonMemo? } — close an entry the
  // caregiver can't (dead phone, GPS failure). Always flagged for approval.
  app.post('/:id/admin-force-clockout', requirePermission(OFFICE_EVV), async (c) => {
    const { user: u, companyId, me } = who(c)
    const id = c.req.param('id')
    const { reason, endTime, scheduled, evvReasonCode, evvReasonMemo } = await c.req.json().catch(() => ({})) as any
    const e = await entryOf(companyId, id)
    if (!e) return fail(c, 404, 'Time entry not found')
    if (e.endTime) return fail(c, 400, 'Time entry is already closed')
    const payer = await payerOf(companyId, e.clientId)
    const start = e.startTime
    const allotted = e.allottedMinutes
    let end = new Date()
    if (scheduled) {
      if (allotted == null) return fail(c, 400, 'This shift has no scheduled amount — pick an end time or use Now.')
      end = new Date(start.getTime() + allotted * 60000)
    } else if (endTime) {
      end = new Date(endTime)
      if (isNaN(end.getTime())) return fail(c, 400, 'Invalid end time.')
      if (end <= start) return fail(c, 400, 'End time must be after the clock-in time.')
    }
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
    const billable = scheduled && allotted != null ? allotted : isPrivate(payer) ? durationMinutes : allotted == null ? durationMinutes : allotted
    const tz = await core.time.timezone(companyId)
    const how = scheduled ? 'scheduled amount' : endTime ? `ended ${formatInZone(end, tz)}` : 'now'
    const tag = `[Admin force clock-out by ${u.email || me} (${how})${reason ? `: ${reason}` : ''}]`
    const [updated] = await db.update(timeEntries).set({
      endTime: end, clockOutLocation: null, durationMinutes, isComplete: true, notes: e.notes ? `${e.notes}\n${tag}` : tag,
      discrepancyMinutes: allotted != null ? durationMinutes - allotted : null, billableMinutes: billable,
      needsApproval: true, approvalReason: e.approvalReason || 'admin_force_clockout', updatedAt: new Date(),
    }).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId), isNull(timeEntries.endTime))).returning()
    if (!updated) return fail(c, 409, 'This shift is already clocked out.')
    await notify.recordAudit(companyId, me, 'UPDATE', 'time_entries', id, null, { action: 'admin_force_clockout', reason: reason || null, caregiver_id: e.caregiverId, duration_minutes: durationMinutes })
    // EVV: an office-set end time is a time change Sandata must be told about (AdjOutDateTime + VisitChanges) — record it
    // with an EVV reason code. CVHC's default is 1 (caregiver error: did not clock out); the memo is the given EVV memo
    // or the office's reason. Never blocks the close.
    try {
      const code = (EVV_REASON_CODES as readonly string[]).includes(String(evvReasonCode)) ? String(evvReasonCode) : '1'
      await core.evvVisits.recordVisitTimeChange(companyId, { timeEntryId: id, changedById: me, oldEnd: null, newEnd: end, reasonCode: code, memo: evvReasonMemo || reason || null })
    } catch (vtcErr: any) { d.logger.error('[force-clockout] visit_time_changes', { error: vtcErr?.message }) }
    await onVisitClosed(companyId, id)
    // The office has dealt with it: that caregiver's open GPS-failure alerts are handled.
    try {
      const cg = await nameOf(companyId, e.caregiverId)
      const cgName = `${cg?.firstName || ''} ${cg?.lastName || ''}`.trim()
      if (cgName) {
        await db.update(notifications).set({ isRead: true, status: 'handled', handledAt: new Date(), handledById: me })
          .where(and(eq(notifications.companyId, companyId), eq(notifications.type, 'gps_failure'), eq(notifications.status, 'new'),
            gt(notifications.createdAt, new Date(Date.now() - 6 * 3600000)), like(notifications.title, `%${cgName}%`)))
      }
    } catch (rErr: any) { d.logger.error('[force-clockout] gps alert resolve', { error: rErr?.message }) }
    return one(c, { success: true, entry: updated })
  })

  // POST /gps { timeEntryId, … } and POST /:id/gps — a breadcrumb on the caregiver's OWN open visit
  async function addGps(c: any, timeEntryId: string, b: any) {
    const { companyId, me } = who(c)
    const [open] = await db.select({ id: timeEntries.id }).from(timeEntries)
      .where(and(eq(timeEntries.id, String(timeEntryId || '')), eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, me), isNull(timeEntries.endTime))).limit(1)
    if (!open) return fail(c, 404, 'Active time entry not found')
    const { latitude, longitude, accuracy, speed, heading } = b
    const [point] = await db.insert(gpsTracking).values({ companyId, caregiverId: me, timeEntryId: open.id, latitude, longitude, accuracy, speed, heading }).returning()
    return one(c, point, 201)
  }
  app.post('/gps', requirePermission('evv:create'), async (c) => {
    const b = await c.req.json().catch(() => ({})) as any
    return addGps(c, b.timeEntryId, b)
  })
  app.post('/:id/gps', requirePermission('evv:create'), async (c) => addGps(c, c.req.param('id'), await c.req.json().catch(() => ({}))))

  // ─── VISIT PHOTOS (proof of care) ──────────────────────────────────────────────────────────
  // The assigned caregiver or the office may attach and read; the office lists by client and deletes.
  async function entryOwner(companyId: string, id: string) {
    const [te] = await db.select({ caregiverId: timeEntries.caregiverId, clientId: timeEntries.clientId }).from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1)
    return te ?? null
  }

  app.post('/:id/photos', requirePermission('evv:create'), async (c) => {
    const { user: u, companyId, me } = who(c)
    const { imageBase64, caption, category, takenAt } = await c.req.json().catch(() => ({})) as any
    // Item 4 (care_offline_saves): a photo saved on the phone without signal keeps the time it was taken.
    let taken: Date | null = null
    if (takenAt !== undefined && await core.offlineSaves.enabled(companyId)) {
      const t = core.offlineSaves.savedTime(takenAt)
      if ('problem' in t) return fail(c, 400, t.problem, 'bad_saved_time')
      taken = t.at
    }
    if (!imageBase64 || !String(imageBase64).startsWith('data:image')) return fail(c, 400, 'imageBase64 (data URI) is required')
    if (String(imageBase64).length > MAX_PHOTO_CHARS) return fail(c, 400, 'Photo too large — keep under ~5MB raw')
    const te = await entryOwner(companyId, c.req.param('id'))
    if (!te) return fail(c, 404, 'Time entry not found')
    if (isCaregiver(d, u) && me !== te.caregiverId) return fail(c, 403, 'Only the assigned caregiver or an admin can upload visit photos')
    // ...and only to the record of a client they serve (an unscheduled punch is never refused, so a visit of their own is
    // not enough).
    const refused = await core.access.careWriteRefusal(c, te.clientId)
    if (refused) return refused
    const [p] = await db.insert(visitPhotos).values({
      companyId, timeEntryId: c.req.param('id'), caregiverId: te.caregiverId, clientId: te.clientId,
      caption: caption ? String(caption).slice(0, 200) : null, category: category ? String(category).slice(0, 40) : null,
      imageBase64: String(imageBase64), imageSize: Math.floor(String(imageBase64).length * 0.75), ...(taken ? { takenAt: taken } : {}),
    }).returning({ id: visitPhotos.id, caption: visitPhotos.caption, category: visitPhotos.category, takenAt: visitPhotos.takenAt, imageSize: visitPhotos.imageSize })
    return one(c, p, 201)
  })

  app.get('/:id/photos', requirePermission('evv:read'), async (c) => {
    const { user: u, companyId, me } = who(c)
    const te = await entryOwner(companyId, c.req.param('id'))
    if (!te) return fail(c, 404, 'Time entry not found')
    if (isCaregiver(d, u) && me !== te.caregiverId) return fail(c, 403, 'Not allowed')
    const rows = await db.select({
      id: visitPhotos.id, caption: visitPhotos.caption, category: visitPhotos.category, imageBase64: visitPhotos.imageBase64,
      imageSize: visitPhotos.imageSize, takenAt: visitPhotos.takenAt, uploadedAt: visitPhotos.uploadedAt,
      firstName: user.firstName, lastName: user.lastName,
    }).from(visitPhotos).leftJoin(user, eq(user.id, visitPhotos.caregiverId))
      .where(and(eq(visitPhotos.companyId, companyId), eq(visitPhotos.timeEntryId, c.req.param('id')))).orderBy(asc(visitPhotos.takenAt))
    return listAll(c, rows)
  })

  // The list omits the image itself; fetch one with GET /photo/:photoId.
  app.get('/photos/client/:clientId', requirePermission(OFFICE_EVV), async (c) => {
    const { companyId } = who(c)
    const limit = Math.min(intParam(c.req.query('limit'), 30), 200)
    const rows = await db.select({
      id: visitPhotos.id, caption: visitPhotos.caption, category: visitPhotos.category, takenAt: visitPhotos.takenAt,
      imageSize: visitPhotos.imageSize, timeEntryId: visitPhotos.timeEntryId, firstName: user.firstName, lastName: user.lastName,
    }).from(visitPhotos).leftJoin(user, eq(user.id, visitPhotos.caregiverId))
      .where(and(eq(visitPhotos.companyId, companyId), eq(visitPhotos.clientId, c.req.param('clientId'))))
      .orderBy(desc(visitPhotos.takenAt)).limit(limit)
    return list(c, rows, { page: 1, limit, total: rows.length })
  })

  app.get('/photo/:photoId', requirePermission('evv:read'), async (c) => {
    const { user: u, companyId, me } = who(c)
    const [p] = await db.select({ photo: visitPhotos, entryCaregiverId: timeEntries.caregiverId })
      .from(visitPhotos).innerJoin(timeEntries, eq(timeEntries.id, visitPhotos.timeEntryId))
      .where(and(eq(visitPhotos.id, c.req.param('photoId')), eq(visitPhotos.companyId, companyId))).limit(1)
    if (!p) return fail(c, 404, 'Photo not found')
    if (isCaregiver(d, u) && me !== p.entryCaregiverId) return fail(c, 403, 'Not allowed')
    return one(c, { ...p.photo, entryCaregiverId: p.entryCaregiverId })
  })

  app.delete('/photo/:photoId', requirePermission(OFFICE_EVV), async (c) => {
    const [r] = await db.delete(visitPhotos).where(and(eq(visitPhotos.id, c.req.param('photoId')), eq(visitPhotos.companyId, who(c).companyId)))
      .returning({ id: visitPhotos.id })
    if (!r) return fail(c, 404, 'Photo not found')
    return one(c, { deleted: r.id })
  })

  // PUT /:id — office edit
  app.put('/:id', requirePermission(OFFICE_EVV), async (c) => {
    const { companyId, me } = who(c)
    const id = c.req.param('id')
    const existing = await entryOf(companyId, id)
    if (!existing) return fail(c, 404, 'Time entry not found')
    const { startTime, endTime, notes, billableMinutes } = await c.req.json().catch(() => ({})) as any
    const data: Record<string, any> = { updatedAt: new Date() }
    if (startTime) data.startTime = new Date(startTime)
    if (endTime) {
      data.endTime = new Date(endTime)
      data.isComplete = true
      // The duration runs from the clock-in as it now stands: the new one, else the entry's own (the template left the
      // old duration when only the end changed).
      const start = startTime ? new Date(startTime) : existing.startTime
      data.durationMinutes = Math.round((data.endTime.getTime() - start.getTime()) / 60000)
    }
    if (notes !== undefined) data.notes = notes
    if (billableMinutes !== undefined) data.billableMinutes = billableMinutes
    const [updated] = await db.update(timeEntries).set(data).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).returning()
    // An office change to a visit's times changes what is billed and paid: on the clinical trail, as approve is (the
    // template's edit wrote none; found in the move).
    await notify.recordAudit(companyId, me, 'UPDATE', 'time_entries', id, existing, updated)
    return one(c, updated)
  })

  // GET /:id/gps — the trail of one visit (the office, or the caregiver who worked it)
  app.get('/:id/gps', requirePermission('evv:read'), async (c) => {
    const { user: u, companyId, me } = who(c)
    const id = c.req.param('id')
    if (isCaregiver(d, u)) {
      const te = await entryOwner(companyId, id)
      if (!te || te.caregiverId !== me) return fail(c, 403, 'Not allowed')
    }
    const points = await db.select().from(gpsTracking)
      .where(and(eq(gpsTracking.companyId, companyId), eq(gpsTracking.timeEntryId, id))).orderBy(asc(gpsTracking.timestamp))
    return listAll(c, points)
  })

  // GET /geofence/:clientId — the client's geofence (a caregiver: only a client they serve)
  app.get('/geofence/:clientId', requirePermission('evv:read'), core.access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')!
    const [settings] = await db.select().from(geofenceSettings)
      .where(and(eq(geofenceSettings.companyId, companyId), eq(geofenceSettings.clientId, clientId))).limit(1)
    const [client] = await db.select({ latitude: clients.latitude, longitude: clients.longitude, address: clients.address })
      .from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    return one(c, { settings: settings || null, client: client || null })
  })

  // POST /geofence/:clientId — the office sets it (radius and the auto clock-in / out / GPS switches only)
  app.post('/geofence/:clientId', requirePermission(OFFICE_EVV), async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')
    if (!(await clientName(companyId, clientId))) return fail(c, 404, 'Client not found')
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const set: Record<string, any> = {}
    for (const k of GEOFENCE_FIELDS) if (k in body) set[k] = body[k]
    const [existing] = await db.select({ id: geofenceSettings.id }).from(geofenceSettings)
      .where(and(eq(geofenceSettings.companyId, companyId), eq(geofenceSettings.clientId, clientId))).limit(1)
    const [settings] = existing
      ? await db.update(geofenceSettings).set({ ...set, updatedAt: new Date() }).where(eq(geofenceSettings.id, existing.id)).returning()
      : await db.insert(geofenceSettings).values({ ...set, companyId, clientId }).returning()
    return one(c, settings)
  })

  return app
}
