// Time entries: the punch, the approval queue, visit photos. Mounted at /api/time-tracking (the office
// Time & GPS page) and /api/time-entries (the caregiver app). Clock-in / clock-out, approvals, offline
// punches and visit photos ported from the CVHC home care CRM (routes/timeTrackingRoutes.js).
import { Hono } from 'hono'
import { eq, and, gte, lte, desc, asc, count, isNull, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import {
  timeEntries,
  gpsTracking,
  geofenceSettings,
  users,
  clients,
  evvVisits,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { rows, one, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { agencyNow, fmtClock } from '../helpers/agencyTime.ts'
import { decideBilling, parseOfflineAt, withOfflineFlag, hasOfflineFlag } from '../helpers/punchRules.ts'
import { notifyAdmins, sendPush, recordAudit } from '../services/visitNotify.ts'

const app = new Hono()

app.use('*', authenticate)

const isUnique = (e: any) => e?.code === '23505' || e?.cause?.code === '23505' || /unique|duplicate key/i.test(String(e?.message || e?.cause?.message || ''))

// The client's payer decides the billing rule.
async function payerOf(clientId: string) {
  return one<any>(sql`SELECT c.is_private_pay, c.first_name, c.last_name, rs.payer_type, rs.name AS payer_name
    FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id WHERE c.id = ${clientId}`)
}
const isPrivate = (p: any) => p?.is_private_pay === true || p?.payer_type === 'private_pay'

// EVERY path that closes a visit calls this — clock-out, the auto-close when a caregiver clocks into
// the next client, and the office's force clock-out — so the EVV record is made in one place.
// (Today: the template's own evv_visits row behind ENABLE_SANDATA_EVV.)
export async function onVisitClosed(timeEntryId: string) {
  if (process.env.ENABLE_SANDATA_EVV !== 'true') return
  try {
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, timeEntryId)).limit(1)
    if (!entry || !entry.endTime) return
    const clockIn = entry.clockInLocation as any
    const clockOut = entry.clockOutLocation as any
    await db.insert(evvVisits).values({
      timeEntryId: entry.id,
      clientId: entry.clientId,
      caregiverId: entry.caregiverId,
      serviceDate: entry.startTime.toISOString().split('T')[0],
      actualStart: entry.startTime,
      actualEnd: entry.endTime,
      gpsInLat: clockIn?.lat ?? null,
      gpsInLng: clockIn?.lng ?? null,
      gpsOutLat: clockOut?.lat ?? null,
      gpsOutLng: clockOut?.lng ?? null,
      evvMethod: (clockIn?.lat || clockOut?.lat) ? 'gps' : 'manual',
    }).onConflictDoNothing()
  } catch (evvErr: any) {
    console.warn('[EVV] Auto-create failed for time entry', timeEntryId, ':', evvErr.message)
  }
}

// GET /api/time-tracking — the office list (a caregiver sees only their own)
app.get('/', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.query('caregiverId')
  const clientId = c.req.query('clientId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const isComplete = c.req.query('isComplete')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const skip = (page - 1) * limit

  const conditions = []
  if (!isOffice(user)) conditions.push(eq(timeEntries.caregiverId, userIdOf(user)))
  else if (caregiverId) conditions.push(eq(timeEntries.caregiverId, caregiverId))
  if (clientId) conditions.push(eq(timeEntries.clientId, clientId))
  if (isComplete !== undefined) conditions.push(eq(timeEntries.isComplete, isComplete === 'true'))
  if (startDate) conditions.push(gte(timeEntries.startTime, new Date(startDate)))
  if (endDate) conditions.push(lte(timeEntries.startTime, new Date(new Date(endDate).setHours(23, 59, 59))))

  const whereClause = conditions.length ? and(...conditions) : undefined

  const [entries, [{ value: total }]] = await Promise.all([
    db.select({
      id: timeEntries.id,
      caregiverId: timeEntries.caregiverId,
      clientId: timeEntries.clientId,
      assignmentId: timeEntries.assignmentId,
      scheduleId: timeEntries.scheduleId,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      durationMinutes: timeEntries.durationMinutes,
      allottedMinutes: timeEntries.allottedMinutes,
      billableMinutes: timeEntries.billableMinutes,
      discrepancyMinutes: timeEntries.discrepancyMinutes,
      clockInLocation: timeEntries.clockInLocation,
      clockOutLocation: timeEntries.clockOutLocation,
      isComplete: timeEntries.isComplete,
      notes: timeEntries.notes,
      needsApproval: timeEntries.needsApproval,
      approvalReason: timeEntries.approvalReason,
      createdAt: timeEntries.createdAt,
      updatedAt: timeEntries.updatedAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      clientAddress: clients.address,
      clientCity: clients.city,
    })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.caregiverId))
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(whereClause)
      .orderBy(desc(timeEntries.startTime))
      .offset(skip)
      .limit(limit),
    db.select({ value: count() }).from(timeEntries).where(whereClause),
  ])

  const entryIds = entries.map((e) => e.id)
  const evvMap: Record<string, { id: string; sandataStatus: string; isVerified: boolean }> = {}
  if (entryIds.length) {
    const evvRows = await Promise.all(
      entryIds.map(async (eid) => {
        const [row] = await db.select({
          id: evvVisits.id,
          sandataStatus: evvVisits.sandataStatus,
          isVerified: evvVisits.isVerified,
          timeEntryId: evvVisits.timeEntryId,
        }).from(evvVisits).where(eq(evvVisits.timeEntryId, eid)).limit(1)
        return row
      })
    )
    for (const row of evvRows) {
      if (row) evvMap[row.timeEntryId] = { id: row.id, sandataStatus: row.sandataStatus, isVerified: row.isVerified }
    }
  }

  const result = entries.map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, clientAddress, clientCity, ...e }) => ({
    ...e,
    caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
    client: { firstName: clientFirstName, lastName: clientLastName, address: clientAddress, city: clientCity },
    evvVisit: evvMap[e.id] || null,
  }))

  return c.json({ entries: result, total, page, pages: Math.ceil(total / limit) })
})

// GET /active — a caregiver's own open visit (object or null); for the office, everyone clocked in.
app.get('/active', async (c) => {
  const user = c.get('user') as any
  if (!isOffice(user)) {
    const [e] = await db.select({
      id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime,
      clientFirstName: clients.firstName, clientLastName: clients.lastName,
    }).from(timeEntries).innerJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(and(eq(timeEntries.caregiverId, userIdOf(user)), isNull(timeEntries.endTime)))
      .orderBy(desc(timeEntries.startTime)).limit(1)
    if (!e) return c.json(null)
    return c.json({ id: e.id, client_id: e.clientId, start_time: e.startTime, client_name: `${e.clientFirstName} ${e.clientLastName}` })
  }

  const activeEntries = await db.select({
    id: timeEntries.id,
    caregiverId: timeEntries.caregiverId,
    clientId: timeEntries.clientId,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    isComplete: timeEntries.isComplete,
    clockInLocation: timeEntries.clockInLocation,
    allottedMinutes: timeEntries.allottedMinutes,
    notes: timeEntries.notes,
    createdAt: timeEntries.createdAt,
    updatedAt: timeEntries.updatedAt,
    cgId: users.id,
    cgFirstName: users.firstName,
    cgLastName: users.lastName,
    cgPhone: users.phone,
    clId: clients.id,
    clFirstName: clients.firstName,
    clLastName: clients.lastName,
    clAddress: clients.address,
    clCity: clients.city,
  })
    .from(timeEntries)
    .leftJoin(users, eq(users.id, timeEntries.caregiverId))
    .leftJoin(clients, eq(clients.id, timeEntries.clientId))
    .where(and(isNull(timeEntries.endTime), eq(timeEntries.isComplete, false)))

  const result = await Promise.all(activeEntries.map(async (e) => {
    const gpsPoints = await db.select().from(gpsTracking)
      .where(eq(gpsTracking.timeEntryId, e.id))
      .orderBy(desc(gpsTracking.timestamp))
      .limit(1)
    return {
      id: e.id, caregiverId: e.caregiverId, clientId: e.clientId, startTime: e.startTime, endTime: e.endTime,
      isComplete: e.isComplete, clockInLocation: e.clockInLocation, allottedMinutes: e.allottedMinutes, notes: e.notes,
      createdAt: e.createdAt, updatedAt: e.updatedAt,
      caregiver: { id: e.cgId, firstName: e.cgFirstName, lastName: e.cgLastName, phone: e.cgPhone },
      client: { id: e.clId, firstName: e.clFirstName, lastName: e.clLastName, address: e.clAddress, city: e.clCity },
      gpsPoints,
    }
  }))
  return c.json(result)
})

// GET /recent — the caregiver's last finished visits
app.get('/recent', async (c) => {
  const user = c.get('user') as any
  const limit = Math.min(parseInt(c.req.query('limit') || '10') || 10, 100)
  const entries = await db.select({
    id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime, endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes, notes: timeEntries.notes,
    clientFirstName: clients.firstName, clientLastName: clients.lastName,
  }).from(timeEntries).innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .where(and(eq(timeEntries.caregiverId, userIdOf(user)), sql`${timeEntries.endTime} IS NOT NULL`))
    .orderBy(desc(timeEntries.startTime)).limit(limit)
  return c.json(entries.map((e) => ({
    id: e.id, client_id: e.clientId, start_time: e.startTime, end_time: e.endTime, notes: e.notes,
    hours_worked: e.durationMinutes ? (e.durationMinutes / 60).toFixed(2) : null,
    client_name: `${e.clientFirstName} ${e.clientLastName}`,
    client: { firstName: e.clientFirstName, lastName: e.clientLastName },
  })))
})

// POST /check-warnings { timeEntryId } — the caregiver's own open visit: 15 minutes left, or over.
app.post('/check-warnings', async (c) => {
  const user = c.get('user') as any
  const { timeEntryId } = await c.req.json().catch(() => ({})) as any
  if (!timeEntryId) return c.json({ warning: false })
  const [te] = await db.select({ id: timeEntries.id, startTime: timeEntries.startTime, allottedMinutes: timeEntries.allottedMinutes,
    clientFirst: clients.firstName, clientLast: clients.lastName })
    .from(timeEntries).innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.caregiverId, userIdOf(user)), eq(timeEntries.isComplete, false))).limit(1)
  if (!te || !te.allottedMinutes) return c.json({ warning: false })
  const minutesElapsed = (Date.now() - te.startTime.getTime()) / 60000
  const minutesRemaining = te.allottedMinutes - minutesElapsed
  if (minutesRemaining >= 14 && minutesRemaining <= 16) {
    const { tz } = await agencyNow()
    const ends = fmtClock(new Date(te.startTime.getTime() + te.allottedMinutes * 60000), tz)
    await sendPush(userIdOf(user), { title: '15-Minute Warning', body: `Shift with ${te.clientFirst} ${te.clientLast} ends at ${ends}. Start wrapping up!`, tag: 'shift-warning-15min', data: { type: 'shift_warning', timeEntryId } })
    return c.json({ warning: true, minutesRemaining: Math.round(minutesRemaining), message: '15 minutes remaining — start wrapping up' })
  }
  if (minutesElapsed > te.allottedMinutes + 5) {
    return c.json({ warning: true, overTime: true, minutesOver: Math.round(minutesElapsed - te.allottedMinutes), message: 'Over scheduled time — please clock out' })
  }
  return c.json({ warning: false, minutesRemaining: Math.round(minutesRemaining), minutesElapsed: Math.round(minutesElapsed) })
})

// GET /caregiver-history/:id
app.get('/caregiver-history/:id', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.param('id')
  if (!isOffice(user) && userIdOf(user) !== caregiverId) return c.json({ error: 'You can only view your own time' }, 403)
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const skip = (page - 1) * limit

  const [entries, [{ value: total }]] = await Promise.all([
    db.select({
      id: timeEntries.id,
      clientId: timeEntries.clientId,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      durationMinutes: timeEntries.durationMinutes,
      billableMinutes: timeEntries.billableMinutes,
      isComplete: timeEntries.isComplete,
      notes: timeEntries.notes,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
      .from(timeEntries)
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(eq(timeEntries.caregiverId, caregiverId))
      .orderBy(desc(timeEntries.startTime))
      .offset(skip)
      .limit(limit),
    db.select({ value: count() }).from(timeEntries).where(eq(timeEntries.caregiverId, caregiverId)),
  ])

  return c.json({
    entries: entries.map(e => ({ ...e, client: { firstName: e.clientFirstName, lastName: e.clientLastName } })),
    total, page, pages: Math.ceil(total / limit),
  })
})

// GET /caregiver-gps/:id — GPS trail for a caregiver's recent entries
app.get('/caregiver-gps/:id', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.param('id')
  if (!isOffice(user) && userIdOf(user) !== caregiverId) return c.json({ error: 'You can only view your own time' }, 403)
  const points = await db.select().from(gpsTracking)
    .where(eq(gpsTracking.caregiverId, caregiverId))
    .orderBy(desc(gpsTracking.timestamp))
    .limit(100)
  return c.json(points)
})

// GET /pending-approval — the office's queue of flagged, finished entries
app.get('/pending-approval', requireAdmin, async (c) => {
  return c.json(await rows(sql`
    SELECT te.id, te.caregiver_id, te.client_id, te.start_time, te.end_time,
      te.duration_minutes, te.allotted_minutes, te.billable_minutes, te.discrepancy_minutes,
      te.needs_approval, te.approval_reason, te.notes,
      CASE WHEN te.end_time IS NOT NULL
        THEN ROUND((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0)::numeric, 2) ELSE NULL END AS hours,
      ROUND((te.billable_minutes / 60.0)::numeric, 2) AS billable_hours,
      ROUND((te.allotted_minutes / 60.0)::numeric, 2) AS allotted_hours,
      u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, u.default_pay_rate,
      c.first_name AS client_first_name, c.last_name AS client_last_name, c.is_private_pay,
      c.latitude AS client_lat, c.longitude AS client_lng,
      rs.payer_type AS referral_payer_type, rs.name AS referral_source_name
    FROM time_entries te
    JOIN users u ON te.caregiver_id = u.id
    LEFT JOIN clients c ON te.client_id = c.id
    LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
    WHERE te.needs_approval = true AND te.is_complete = true
    ORDER BY te.start_time DESC`))
})

// PATCH /:id/approve { billable_minutes?, notes?, reject? } — the office resolves a flagged entry.
//   reject: true → billable 0 (the shift is not paid); billable_minutes → override; neither → as is.
app.patch('/:id/approve', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({})) as any
  const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Time entry not found' }, 404)
  let billable: number | null
  if (b.reject === true) billable = 0
  else if (b.billable_minutes != null && b.billable_minutes !== '') {
    const n = Number(b.billable_minutes)
    if (!Number.isInteger(n) || n < 0) return c.json({ error: 'billable_minutes must be a non-negative integer' }, 400)
    billable = n
  } else billable = existing.billableMinutes
  const [updated] = await db.update(timeEntries).set({
    billableMinutes: billable, approvedBillableMinutes: billable, approvedById: userIdOf(user), approvedAt: new Date(),
    approvalNotes: b.notes || null, needsApproval: false, updatedAt: new Date(),
  }).where(eq(timeEntries.id, id)).returning()
  await recordAudit(userIdOf(user), 'APPROVE', 'time_entries', id, existing, updated)
  return c.json(updated)
})

// POST /clock-in { clientId, latitude?, longitude?, scheduleId?, autoClockIn?, autoTransition?, offlineAt? }
app.post('/clock-in', async (c) => {
  const user = c.get('user') as any
  const caregiverId = userIdOf(user)
  const b = await c.req.json().catch(() => ({})) as any
  const { clientId, latitude, longitude, scheduleId } = b
  if (!clientId) return c.json({ error: 'clientId is required' }, 400)

  // Automatic schedule transition stays off: it closed the previous visit and opened the next while
  // the caregiver was still in the previous client's home, and their note landed on the wrong client.
  if (b.autoTransition) {
    return c.json({ error: 'Automatic shift transition is disabled — clock out, then clock in for your next client when you arrive.', code: 'auto_transition_disabled' }, 409)
  }

  const offline = parseOfflineAt(b.offlineAt)
  if (offline.error) return c.json({ error: offline.error, code: offline.code || 'offline_punch_invalid' }, 400)
  const punchAt = offline.at
  const at = punchAt || new Date()

  const loc = (src?: string) => latitude && longitude
    ? (punchAt ? { lat: latitude, lng: longitude, source: src || 'offline', captured_at: punchAt.toISOString() } : { lat: latitude, lng: longitude })
    : (b.clockInLocation || null)

  if (punchAt) {
    // Place a saved tap against what the server already has for this caregiver.
    const around = await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, startTime: timeEntries.startTime,
      endTime: timeEntries.endTime, approvalReason: timeEntries.approvalReason, clockInLocation: timeEntries.clockInLocation })
      .from(timeEntries)
      .where(and(eq(timeEntries.caregiverId, caregiverId),
        sql`(${timeEntries.endTime} IS NULL OR ${timeEntries.endTime} > ${new Date(at.getTime() - 120000).toISOString()}::timestamp)`))
      .orderBy(asc(timeEntries.startTime))
    const t = at.getTime()
    const same = around.find((e) => e.clientId === clientId && Math.abs(e.startTime.getTime() - t) <= 120000)
    if (same) return c.json({ id: same.id, client_id: same.clientId, start_time: same.startTime, duplicate: true }, 200)
    const covering = around.find((e) => e.startTime.getTime() <= t && (!e.endTime || e.endTime.getTime() > t))
    if (covering && covering.clientId === clientId) return c.json({ id: covering.id, client_id: covering.clientId, start_time: covering.startTime, duplicate: true }, 200)
    const later = around.filter((e) => e.startTime.getTime() > t)
    // The tap failed at the door, then the app clocked her in later for the SAME visit: one visit —
    // move its start back to the real tap time.
    if (later.length === 1 && later[0].clientId === clientId && !later[0].endTime && !covering) {
      const flag = withOfflineFlag({ needsApproval: true, approvalReason: later[0].approvalReason }, true)
      const prevLoc: any = later[0].clockInLocation
      const [merged] = await db.update(timeEntries).set({
        startTime: at,
        clockInLocation: loc() || (prevLoc ? { ...prevLoc, source: 'later_punch', captured_at: later[0].startTime } : null),
        needsApproval: true, approvalReason: flag.approvalReason, updatedAt: new Date(),
      }).where(and(eq(timeEntries.id, later[0].id), isNull(timeEntries.endTime))).returning()
      if (merged) {
        await recordAudit(caregiverId, 'UPDATE', 'time_entries', later[0].id, { start_time: later[0].startTime }, { start_time: at.toISOString(), reason: 'offline_punch_merged' })
        return c.json({ id: merged.id, client_id: merged.clientId, start_time: merged.startTime, merged: true }, 200)
      }
    }
    // Anything else overlaps recorded time in a way the server must not guess about.
    if (later.length || (covering && covering.endTime)) {
      const cg = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${caregiverId}`)
      const cl = await one<any>(sql`SELECT first_name, last_name FROM clients WHERE id = ${clientId}`)
      const { tz } = await agencyNow()
      const name = cg ? `${cg.first_name} ${cg.last_name}` : 'A caregiver'
      const client = cl ? `${cl.first_name} ${cl.last_name}` : 'a client'
      const why = later.length ? 'later time already recorded' : 'another visit covers that time'
      await notifyAdmins('offline_punch_conflict', `Offline clock-in needs review: ${name}`,
        `${name}'s phone saved a clock-in for ${client} at ${at.toLocaleString('en-US', { timeZone: tz })} with no signal, but it overlaps other time already recorded (${why}). Check their time for that day and fix it in Payroll → Shift Review.`)
      return c.json({ error: 'Your saved clock-in overlaps time already recorded — the office has been notified to fix it.', code: 'offline_conflict' }, 409)
    }
  }

  // Open entries for this caregiver, with the payer, so an auto-close applies the right rule.
  const open = await rows<any>(sql`
    SELECT te.id, te.client_id, te.allotted_minutes, te.approval_reason, te.start_time,
           EXTRACT(EPOCH FROM (${at.toISOString()}::timestamp - te.start_time)) AS seconds_elapsed,
           c.is_private_pay, rs.payer_type
      FROM time_entries te
      LEFT JOIN clients c ON te.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
     WHERE te.caregiver_id = ${caregiverId} AND te.end_time IS NULL`)

  // Idempotent clock-in: a second tap for the same client within 30 s returns the first entry.
  const dupe = open.find((e) => e.client_id === clientId && Number(e.seconds_elapsed) < 30)
  if (dupe) {
    const [ex] = await db.select().from(timeEntries).where(eq(timeEntries.id, dupe.id)).limit(1)
    return c.json({ id: ex.id, client_id: ex.clientId, start_time: ex.startTime, duplicate: true }, 200)
  }

  // Which visit is this punch for? It decides allotted_minutes, which becomes billable_minutes and so
  // the units on the payer's claim. Expand through the one engine (dates, cancellations, overrides)
  // and pick the occurrence whose start is NEAREST the punch, in the agency's own day and clock.
  let allottedMinutes: number | null = null
  let linkedScheduleId: string | null = scheduleId || null
  let liveNow = false
  try {
    const { date, time } = await agencyNow(at)
    const m = await one<any>(sql`WITH ${occurrencesCte(date, date)}
      SELECT occ.schedule_id AS id, occ.minutes,
             CASE WHEN occ.end_time < occ.start_time
                  THEN (${time}::time >= (occ.start_time - INTERVAL '15 minutes')::time OR ${time}::time <= occ.end_time)
                  ELSE (${time}::time >= (occ.start_time - INTERVAL '15 minutes')::time AND ${time}::time <= occ.end_time)
             END AS active_now
        FROM occ WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id = ${clientId}
       ORDER BY ABS(EXTRACT(EPOCH FROM (${time}::time - occ.start_time))) ASC, occ.start_time ASC
       LIMIT 1`)
    if (m) {
      linkedScheduleId = linkedScheduleId || m.id
      if (m.minutes != null) allottedMinutes = Number(m.minutes)
      liveNow = m.active_now === true
    }
  } catch (e: any) { console.error('[clock-in] schedule match failed:', e?.message) }

  // The phone auto-clocks people in on arrival. With no live visit right now (cancelled, or none),
  // refuse the AUTOMATIC clock-in. A manual one is never blocked — it surfaces as unscheduled.
  if (b.autoClockIn && !liveNow) {
    return c.json({ error: 'No active scheduled visit right now — automatic clock-in skipped. Clock in manually if you are on site.', code: 'no_active_occurrence' }, 409)
  }

  // (The match and the automatic-clock-in refusal come BEFORE the auto-close: CVHC closed the open
  // visit first, so a REFUSED automatic clock-in still ended the visit the caregiver was still at.)
  for (const oe of open) {
    const secondsElapsed = Number(oe.seconds_elapsed) || 0
    // Switching clients within 10 s of clocking in: the first tap was a mistake — drop it.
    if (secondsElapsed < 10) {
      await db.delete(gpsTracking).where(eq(gpsTracking.timeEntryId, oe.id))
      await db.delete(timeEntries).where(eq(timeEntries.id, oe.id))
      await recordAudit(caregiverId, 'DELETE', 'time_entries', oe.id, null, { reason: 'spurious_auto_close', seconds_elapsed: secondsElapsed })
      continue
    }
    const d = decideBilling({ durationSeconds: secondsElapsed, allottedMinutes: oe.allotted_minutes, isPrivatePay: isPrivate(oe), zeroGuard: false })
    const flag = withOfflineFlag(d, !!punchAt || hasOfflineFlag(oe.approval_reason))
    await rows(sql`UPDATE time_entries SET end_time = ${at.toISOString()}::timestamp, duration_minutes = ${d.durationMinutes}, is_complete = true,
        discrepancy_minutes = ${d.discrepancyMinutes}, billable_minutes = ${d.billableMinutes},
        needs_approval = ${flag.needsApproval}, approval_reason = ${flag.approvalReason},
        notes = CASE WHEN notes IS NULL OR notes = '' THEN '(Auto-closed: caregiver clocked into new client)'
                     ELSE notes || ' | (Auto-closed: caregiver clocked into new client)' END,
        updated_at = NOW()
      WHERE id = ${oe.id}`)
    await recordAudit(caregiverId, 'UPDATE', 'time_entries', oe.id, null, { auto_closed: true, duration_minutes: d.durationMinutes })
    await onVisitClosed(oe.id)
  }

  let entry: any
  try {
    ;[entry] = await db.insert(timeEntries).values({
      caregiverId, clientId, scheduleId: linkedScheduleId, startTime: at, clockInLocation: loc(), allottedMinutes,
      notes: b.notes || null, needsApproval: !!punchAt, approvalReason: punchAt ? 'offline_punch' : null,
    }).returning()
  } catch (e: any) {
    // One open entry per caregiver (0016 unique index): the twin of a concurrent tap loses and gets
    // the winner back.
    if (isUnique(e)) {
      const [w] = await db.select().from(timeEntries).where(and(eq(timeEntries.caregiverId, caregiverId), isNull(timeEntries.endTime))).limit(1)
      if (w) return c.json({ id: w.id, client_id: w.clientId, start_time: w.startTime, duplicate: true }, 200)
    }
    throw e
  }
  await recordAudit(caregiverId, 'CREATE', 'time_entries', entry.id, null, entry)
  return c.json({ ...entry, id: entry.id, client_id: entry.clientId, start_time: entry.startTime }, 201)
})

// The clock-out itself, shared by POST /:id/clock-out and the older POST /clock-out { timeEntryId }.
async function clockOut(c: any, timeEntryId: string) {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const { latitude, longitude, notes } = b
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, timeEntryId)).limit(1)
  if (!entry) return c.json({ error: 'Time entry not found' }, 404)
  if (!isOffice(user) && entry.caregiverId !== userIdOf(user)) return c.json({ error: 'Time entry not found' }, 404)
  // Idempotent: a replay or stale re-tap on a closed entry changes nothing (it used to stretch the
  // shift to NOW and wipe the clock-out location). Corrections go through the office.
  if (entry.endTime) return c.json({ ...entry, already_complete: true }, 200)

  const payer = await payerOf(entry.clientId)
  // VA documentation rule: a VA client's visit needs a note to clock out.
  if (payer?.payer_type === 'va' && !String(notes || '').trim()) {
    return c.json({ error: 'This is a VA client — a visit note is required to clock out. Please add a short note about the visit.', code: 'va_note_required' }, 400)
  }

  const offline = parseOfflineAt(b.offlineAt)
  if (offline.error) return c.json({ error: offline.error, code: offline.code || 'offline_punch_invalid' }, 400)
  let endAt = offline.at
  if (endAt && endAt < entry.startTime) endAt = entry.startTime
  const end = endAt || new Date()

  const d = decideBilling({ durationSeconds: (end.getTime() - entry.startTime.getTime()) / 1000, allottedMinutes: entry.allottedMinutes, isPrivatePay: isPrivate(payer) })
  const flag = withOfflineFlag(d, !!endAt || hasOfflineFlag(entry.approvalReason))
  const outLoc = latitude && longitude
    ? (endAt ? { lat: latitude, lng: longitude, source: 'offline', captured_at: endAt.toISOString() } : { lat: latitude, lng: longitude })
    : (b.clockOutLocation || null)

  const [updated] = await db.update(timeEntries).set({
    endTime: end, clockOutLocation: outLoc, durationMinutes: d.durationMinutes, isComplete: true,
    notes: notes || entry.notes || null, discrepancyMinutes: d.discrepancyMinutes, billableMinutes: d.billableMinutes,
    needsApproval: flag.needsApproval, approvalReason: flag.approvalReason, updatedAt: new Date(),
  }).where(and(eq(timeEntries.id, entry.id), isNull(timeEntries.endTime))).returning()
  if (!updated) {
    const [now] = await db.select().from(timeEntries).where(eq(timeEntries.id, entry.id)).limit(1)
    return c.json({ ...now, already_complete: true }, 200)
  }
  await recordAudit(userIdOf(user), 'UPDATE', 'time_entries', entry.id, null, updated)

  // Fill a MISSING clock-in / clock-out location from the visit's GPS breadcrumbs (within 10 minutes
  // of the event), flagged source:'breadcrumb' — presence evidence, distinguishable from a tap fix.
  try {
    if (!updated.clockInLocation) {
      const [g] = await db.select().from(gpsTracking).where(and(eq(gpsTracking.timeEntryId, entry.id),
        lte(gpsTracking.timestamp, new Date(entry.startTime.getTime() + 600000)))).orderBy(asc(gpsTracking.timestamp)).limit(1)
      if (g) await db.update(timeEntries).set({ clockInLocation: { lat: Number(g.latitude), lng: Number(g.longitude), source: 'breadcrumb', captured_at: g.timestamp } })
        .where(and(eq(timeEntries.id, entry.id), isNull(timeEntries.clockInLocation)))
    }
    if (!updated.clockOutLocation) {
      const [g] = await db.select().from(gpsTracking).where(and(eq(gpsTracking.timeEntryId, entry.id),
        gte(gpsTracking.timestamp, new Date(end.getTime() - 600000)))).orderBy(desc(gpsTracking.timestamp)).limit(1)
      if (g) await db.update(timeEntries).set({ clockOutLocation: { lat: Number(g.latitude), lng: Number(g.longitude), source: 'breadcrumb', captured_at: g.timestamp } })
        .where(and(eq(timeEntries.id, entry.id), isNull(timeEntries.clockOutLocation)))
    }
  } catch (e: any) { console.error('[clock-out] breadcrumb backfill:', e?.message) }

  await onVisitClosed(entry.id)
  return c.json(updated)
}

app.post('/clock-out', async (c) => {
  const { timeEntryId } = await c.req.raw.clone().json().catch(() => ({})) as any
  if (!timeEntryId) return c.json({ error: 'timeEntryId is required' }, 400)
  return clockOut(c, timeEntryId)
})
app.post('/:id/clock-out', (c) => clockOut(c, c.req.param('id')))

// POST /:id/late-location { latitude, longitude, which? } — the phone's fix arrived after the tap.
// Owner-only; only FILLS a missing location; only within 15 minutes; flagged source:'delayed'.
app.post('/:id/late-location', async (c) => {
  const user = c.get('user') as any
  const { latitude, longitude, which } = await c.req.json().catch(() => ({})) as any
  if (!latitude || !longitude) return c.json({ error: 'latitude and longitude required' }, 400)
  const loc = { lat: latitude, lng: longitude, source: 'delayed', captured_at: new Date().toISOString() }
  const cutoff = new Date(Date.now() - 15 * 60000)
  const r = which === 'clock_out'
    ? await db.update(timeEntries).set({ clockOutLocation: loc, updatedAt: new Date() }).where(and(eq(timeEntries.id, c.req.param('id')),
        eq(timeEntries.caregiverId, userIdOf(user)), isNull(timeEntries.clockOutLocation), sql`${timeEntries.endTime} IS NOT NULL`, gte(timeEntries.endTime, cutoff))).returning({ id: timeEntries.id })
    : await db.update(timeEntries).set({ clockInLocation: loc, updatedAt: new Date() }).where(and(eq(timeEntries.id, c.req.param('id')),
        eq(timeEntries.caregiverId, userIdOf(user)), isNull(timeEntries.clockInLocation), gte(timeEntries.startTime, cutoff))).returning({ id: timeEntries.id })
  return c.json({ updated: r.length })
})

// POST /:id/admin-force-clockout { reason?, endTime?, scheduled? } — close an entry the caregiver
// can't (dead phone, GPS failure). Always flagged for approval.
app.post('/:id/admin-force-clockout', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { reason, endTime, scheduled } = await c.req.json().catch(() => ({})) as any
  const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1)
  if (!e) return c.json({ error: 'Time entry not found' }, 404)
  if (e.endTime) return c.json({ error: 'Time entry is already closed' }, 400)
  const payer = await payerOf(e.clientId)
  const start = e.startTime
  const allotted = e.allottedMinutes
  let end = new Date()
  if (scheduled) {
    if (allotted == null) return c.json({ error: 'This shift has no scheduled amount — pick an end time or use Now.' }, 400)
    end = new Date(start.getTime() + allotted * 60000)
  } else if (endTime) {
    end = new Date(endTime)
    if (isNaN(end.getTime())) return c.json({ error: 'Invalid end time.' }, 400)
    if (end <= start) return c.json({ error: 'End time must be after the clock-in time.' }, 400)
  }
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
  const billable = scheduled && allotted != null ? allotted : isPrivate(payer) ? durationMinutes : allotted == null ? durationMinutes : allotted
  const { tz } = await agencyNow()
  const how = scheduled ? 'scheduled amount' : endTime ? `ended ${end.toLocaleString('en-US', { timeZone: tz })}` : 'now'
  const tag = `[Admin force clock-out by ${user.email || userIdOf(user)} (${how})${reason ? `: ${reason}` : ''}]`
  const [updated] = await db.update(timeEntries).set({
    endTime: end, clockOutLocation: null, durationMinutes, isComplete: true, notes: e.notes ? `${e.notes}\n${tag}` : tag,
    discrepancyMinutes: allotted != null ? durationMinutes - allotted : null, billableMinutes: billable,
    needsApproval: true, approvalReason: e.approvalReason || 'admin_force_clockout', updatedAt: new Date(),
  }).where(and(eq(timeEntries.id, id), isNull(timeEntries.endTime))).returning()
  if (!updated) return c.json({ error: 'This shift is already clocked out.' }, 409)
  await recordAudit(userIdOf(user), 'UPDATE', 'time_entries', id, null, { action: 'admin_force_clockout', reason: reason || null, caregiver_id: e.caregiverId, duration_minutes: durationMinutes })
  await onVisitClosed(id)
  return c.json({ success: true, entry: updated })
})

// POST /gps { timeEntryId, … } and POST /:id/gps — a breadcrumb on the caregiver's OWN open visit
async function addGps(c: any, timeEntryId: string, b: any) {
  const user = c.get('user') as any
  const [open] = await db.select({ id: timeEntries.id }).from(timeEntries)
    .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.caregiverId, userIdOf(user)), isNull(timeEntries.endTime))).limit(1)
  if (!open) return c.json({ error: 'Active time entry not found' }, 404)
  const { latitude, longitude, accuracy, speed, heading } = b
  const [point] = await db.insert(gpsTracking).values({ caregiverId: userIdOf(user), timeEntryId, latitude, longitude, accuracy, speed, heading }).returning()
  return c.json(point, 201)
}
app.post('/gps', async (c) => {
  const b = await c.req.json().catch(() => ({})) as any
  return addGps(c, b.timeEntryId, b)
})
app.post('/:id/gps', async (c) => addGps(c, c.req.param('id'), await c.req.json().catch(() => ({}))))

// ─── VISIT PHOTOS (proof of care) ────────────────────────────────────────────────────────
// The assigned caregiver or the office may attach and read; the office lists by client and deletes.
const MAX_PHOTO_CHARS = 7_000_000 // ~5 MB raw once base64-decoded

async function entryOwner(id: string) {
  return one<any>(sql`SELECT caregiver_id, client_id FROM time_entries WHERE id = ${id}`)
}

app.post('/:id/photos', async (c) => {
  const user = c.get('user') as any
  const { imageBase64, caption, category } = await c.req.json().catch(() => ({})) as any
  if (!imageBase64 || !String(imageBase64).startsWith('data:image')) return c.json({ error: 'imageBase64 (data URI) is required' }, 400)
  if (String(imageBase64).length > MAX_PHOTO_CHARS) return c.json({ error: 'Photo too large — keep under ~5MB raw' }, 400)
  const te = await entryOwner(c.req.param('id'))
  if (!te) return c.json({ error: 'Time entry not found' }, 404)
  if (!isOffice(user) && userIdOf(user) !== te.caregiver_id) return c.json({ error: 'Only the assigned caregiver or an admin can upload visit photos' }, 403)
  const id = createId()
  const size = Math.floor(String(imageBase64).length * 0.75)
  await rows(sql`INSERT INTO visit_photos (id, time_entry_id, caregiver_id, client_id, caption, category, image_base64, image_size, taken_at, uploaded_at)
    VALUES (${id}, ${c.req.param('id')}, ${te.caregiver_id}, ${te.client_id}, ${caption ? String(caption).slice(0, 200) : null},
            ${category ? String(category).slice(0, 40) : null}, ${imageBase64}, ${size}, NOW(), NOW())`)
  return c.json(await one(sql`SELECT id, caption, category, taken_at, image_size FROM visit_photos WHERE id = ${id}`), 201)
})

app.get('/:id/photos', async (c) => {
  const user = c.get('user') as any
  const te = await entryOwner(c.req.param('id'))
  if (!te) return c.json({ error: 'Time entry not found' }, 404)
  if (!isOffice(user) && userIdOf(user) !== te.caregiver_id) return c.json({ error: 'Not allowed' }, 403)
  return c.json(await rows(sql`SELECT vp.id, vp.caption, vp.category, vp.image_base64, vp.image_size, vp.taken_at, vp.uploaded_at,
      u.first_name, u.last_name
    FROM visit_photos vp LEFT JOIN users u ON vp.caregiver_id = u.id
    WHERE vp.time_entry_id = ${c.req.param('id')} ORDER BY vp.taken_at`))
})

// The list omits the image itself; fetch one with GET /photo/:photoId.
app.get('/photos/client/:clientId', requireAdmin, async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '30') || 30, 200)
  return c.json(await rows(sql`SELECT vp.id, vp.caption, vp.category, vp.taken_at, vp.image_size, vp.time_entry_id, u.first_name, u.last_name
    FROM visit_photos vp LEFT JOIN users u ON vp.caregiver_id = u.id
    WHERE vp.client_id = ${c.req.param('clientId')} ORDER BY vp.taken_at DESC LIMIT ${limit}`))
})

app.get('/photo/:photoId', async (c) => {
  const user = c.get('user') as any
  const p = await one<any>(sql`SELECT vp.*, te.caregiver_id AS entry_caregiver_id FROM visit_photos vp
    JOIN time_entries te ON vp.time_entry_id = te.id WHERE vp.id = ${c.req.param('photoId')}`)
  if (!p) return c.json({ error: 'Photo not found' }, 404)
  if (!isOffice(user) && userIdOf(user) !== p.entry_caregiver_id) return c.json({ error: 'Not allowed' }, 403)
  return c.json(p)
})

app.delete('/photo/:photoId', requireAdmin, async (c) => {
  const r = await one<any>(sql`DELETE FROM visit_photos WHERE id = ${c.req.param('photoId')} RETURNING id`)
  if (!r) return c.json({ error: 'Photo not found' }, 404)
  return c.json({ deleted: r.id })
})

// PUT /:id — office edit
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { startTime, endTime, notes, billableMinutes } = await c.req.json()
  const data: Record<string, any> = { updatedAt: new Date() }
  if (startTime) data.startTime = new Date(startTime)
  if (endTime) {
    data.endTime = new Date(endTime)
    data.isComplete = true
    if (startTime) data.durationMinutes = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
  }
  if (notes !== undefined) data.notes = notes
  if (billableMinutes !== undefined) data.billableMinutes = billableMinutes

  const [updated] = await db.update(timeEntries).set(data).where(eq(timeEntries.id, id)).returning()
  return c.json(updated)
})

// GET /:id/gps — the trail of one visit (the office, or the caregiver who worked it)
app.get('/:id/gps', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  if (!isOffice(user)) {
    const te = await entryOwner(id)
    if (!te || te.caregiver_id !== userIdOf(user)) return c.json({ error: 'Not allowed' }, 403)
  }
  const points = await db.select().from(gpsTracking)
    .where(eq(gpsTracking.timeEntryId, id))
    .orderBy(asc(gpsTracking.timestamp))
  return c.json(points)
})

// GET /geofence/:clientId
app.get('/geofence/:clientId', async (c) => {
  const clientId = c.req.param('clientId')
  const [settings] = await db.select().from(geofenceSettings).where(eq(geofenceSettings.clientId, clientId)).limit(1)
  const [client] = await db.select({
    latitude: clients.latitude,
    longitude: clients.longitude,
    address: clients.address,
  }).from(clients).where(eq(clients.id, clientId)).limit(1)
  return c.json({ settings: settings || null, client: client || null })
})

app.post('/geofence/:clientId', requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')
  const body = await c.req.json()

  const [existing] = await db.select({ id: geofenceSettings.id }).from(geofenceSettings)
    .where(eq(geofenceSettings.clientId, clientId)).limit(1)

  let settings
  if (existing) {
    [settings] = await db.update(geofenceSettings)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(geofenceSettings.clientId, clientId))
      .returning()
  } else {
    [settings] = await db.insert(geofenceSettings)
      .values({ ...body, clientId })
      .returning()
  }

  return c.json(settings)
})

export default app
