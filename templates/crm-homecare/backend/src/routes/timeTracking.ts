import { Hono } from 'hono'
import { eq, and, gte, lte, desc, asc, count, isNull } from 'drizzle-orm'
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

const app = new Hono()

app.use('*', authenticate)

// GET /api/time-tracking
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
  if (user.role === 'caregiver') conditions.push(eq(timeEntries.caregiverId, user.userId))
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

  // Fetch EVV visit info for these entries
  const entryIds = entries.map((e) => e.id)
  let evvMap: Record<string, { id: string; sandataStatus: string; isVerified: boolean }> = {}
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

  const result = entries.map((e) => ({
    id: e.id,
    caregiverId: e.caregiverId,
    clientId: e.clientId,
    assignmentId: e.assignmentId,
    scheduleId: e.scheduleId,
    startTime: e.startTime,
    endTime: e.endTime,
    durationMinutes: e.durationMinutes,
    allottedMinutes: e.allottedMinutes,
    billableMinutes: e.billableMinutes,
    discrepancyMinutes: e.discrepancyMinutes,
    clockInLocation: e.clockInLocation,
    clockOutLocation: e.clockOutLocation,
    isComplete: e.isComplete,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    caregiver: { firstName: e.caregiverFirstName, lastName: e.caregiverLastName },
    client: { firstName: e.clientFirstName, lastName: e.clientLastName, address: e.clientAddress, city: e.clientCity },
    evvVisit: evvMap[e.id] || null,
  }))

  return c.json({ entries: result, total, page, pages: Math.ceil(total / limit) })
})

// GET /api/time-tracking/active - caregivers currently clocked in
app.get('/active', requireAdmin, async (c) => {
  const activeEntries = await db.select({
    id: timeEntries.id,
    caregiverId: timeEntries.caregiverId,
    clientId: timeEntries.clientId,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    isComplete: timeEntries.isComplete,
    clockInLocation: timeEntries.clockInLocation,
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

  // Fetch latest GPS point for each active entry
  const result = await Promise.all(activeEntries.map(async (e) => {
    const gpsPoints = await db.select().from(gpsTracking)
      .where(eq(gpsTracking.timeEntryId, e.id))
      .orderBy(desc(gpsTracking.timestamp))
      .limit(1)

    return {
      id: e.id,
      caregiverId: e.caregiverId,
      clientId: e.clientId,
      startTime: e.startTime,
      endTime: e.endTime,
      isComplete: e.isComplete,
      clockInLocation: e.clockInLocation,
      notes: e.notes,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      caregiver: { id: e.cgId, firstName: e.cgFirstName, lastName: e.cgLastName, phone: e.cgPhone },
      client: { id: e.clId, firstName: e.clFirstName, lastName: e.clLastName, address: e.clAddress, city: e.clCity },
      gpsPoints,
    }
  }))

  return c.json(result)
})

// GET /api/time-entries/recent — recent entries for the current caregiver
app.get('/recent', async (c) => {
  const user = c.get('user') as any
  const limit = parseInt(c.req.query('limit') || '10')
  const conditions = [eq(timeEntries.isComplete, true)]
  if (user.role === 'caregiver') conditions.push(eq(timeEntries.caregiverId, user.userId))

  const entries = await db.select({
    id: timeEntries.id,
    caregiverId: timeEntries.caregiverId,
    clientId: timeEntries.clientId,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes,
    isComplete: timeEntries.isComplete,
    notes: timeEntries.notes,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(timeEntries)
    .leftJoin(clients, eq(clients.id, timeEntries.clientId))
    .where(and(...conditions))
    .orderBy(desc(timeEntries.startTime))
    .limit(limit)

  return c.json(entries.map(e => ({
    ...e,
    client: { firstName: e.clientFirstName, lastName: e.clientLastName },
  })))
})

// GET /api/time-entries/check-warnings — check for clock-in/out warnings
app.get('/check-warnings', async (c) => {
  const user = c.get('user') as any
  const warnings: any[] = []

  // Check for long-running active sessions (> 12 hours)
  const activeEntries = await db.select({ id: timeEntries.id, startTime: timeEntries.startTime, caregiverId: timeEntries.caregiverId })
    .from(timeEntries)
    .where(and(isNull(timeEntries.endTime), eq(timeEntries.isComplete, false)))

  const now = Date.now()
  for (const entry of activeEntries) {
    const hours = (now - entry.startTime.getTime()) / 3600000
    if (hours > 12) {
      warnings.push({ type: 'long_session', timeEntryId: entry.id, caregiverId: entry.caregiverId, hours: Math.round(hours) })
    }
  }

  return c.json({ warnings })
})

// GET /api/time-entries/caregiver-history/:id — time entry history for a specific caregiver
app.get('/caregiver-history/:id', async (c) => {
  const caregiverId = c.req.param('id')
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

// GET /api/time-entries/caregiver-gps/:id — GPS trail for a caregiver's recent entries
app.get('/caregiver-gps/:id', async (c) => {
  const caregiverId = c.req.param('id')
  const points = await db.select().from(gpsTracking)
    .where(eq(gpsTracking.caregiverId, caregiverId))
    .orderBy(desc(gpsTracking.timestamp))
    .limit(100)
  return c.json(points)
})

// POST /api/time-tracking/clock-in
app.post('/clock-in', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { clientId, scheduleId, clockInLocation, notes } = body
  const caregiverId = user.role === 'caregiver' ? user.userId : body.caregiverId

  // Check not already clocked in
  const [existing] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.caregiverId, caregiverId), isNull(timeEntries.endTime), eq(timeEntries.isComplete, false)))
    .limit(1)
  if (existing) return c.json({ error: 'Already clocked in. Clock out first.' }, 400)

  const [entry] = await db.insert(timeEntries)
    .values({ caregiverId, clientId, scheduleId, startTime: new Date(), clockInLocation, notes })
    .returning()

  // Fetch caregiver and client names
  const [caregiver] = await db.select({ firstName: users.firstName, lastName: users.lastName })
    .from(users).where(eq(users.id, caregiverId)).limit(1)
  const [client] = await db.select({ firstName: clients.firstName, lastName: clients.lastName })
    .from(clients).where(eq(clients.id, clientId)).limit(1)

  return c.json({ ...entry, caregiver: caregiver || null, client: client || null }, 201)
})

// POST /api/time-tracking/clock-out
app.post('/clock-out', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { timeEntryId, clockOutLocation, notes } = body
  const caregiverId = user.role === 'caregiver' ? user.userId : body.caregiverId

  const [entry] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.caregiverId, caregiverId), isNull(timeEntries.endTime)))
    .limit(1)
  if (!entry) return c.json({ error: 'Active time entry not found' }, 404)

  const endTime = new Date()
  const durationMinutes = Math.round((endTime.getTime() - entry.startTime.getTime()) / 60000)

  const [updated] = await db.update(timeEntries)
    .set({
      endTime,
      durationMinutes,
      billableMinutes: durationMinutes,
      clockOutLocation,
      notes: notes || entry.notes,
      isComplete: true,
      updatedAt: new Date(),
    })
    .where(eq(timeEntries.id, entry.id))
    .returning()

  // Auto-create EVV visit on clock-out (non-blocking)
  if (process.env.ENABLE_SANDATA_EVV === 'true') {
    try {
      const clockIn = entry.clockInLocation as any
      const clockOut = clockOutLocation as any
      await db.insert(evvVisits).values({
        timeEntryId: entry.id,
        clientId: entry.clientId,
        caregiverId: entry.caregiverId,
        serviceDate: entry.startTime.toISOString().split('T')[0],
        actualStart: entry.startTime,
        actualEnd: endTime,
        gpsInLat: clockIn?.lat ?? null,
        gpsInLng: clockIn?.lng ?? null,
        gpsOutLat: clockOut?.lat ?? null,
        gpsOutLng: clockOut?.lng ?? null,
        evvMethod: (clockIn?.lat || clockOut?.lat) ? 'gps' : 'manual',
      }).onConflictDoNothing()
    } catch (evvErr: any) {
      console.warn('[EVV] Auto-create failed for time entry', entry.id, ':', evvErr.message)
    }
  }

  return c.json(updated)
})

// POST /api/time-tracking/gps
app.post('/gps', async (c) => {
  const user = c.get('user') as any
  const { timeEntryId, latitude, longitude, accuracy, speed, heading } = await c.req.json()
  const [point] = await db.insert(gpsTracking)
    .values({
      caregiverId: user.userId,
      timeEntryId,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
    })
    .returning()
  return c.json(point, 201)
})

// POST /api/time-entries/:id/clock-out — parameterized clock-out (frontend uses this path)
app.post('/:id/clock-out', async (c) => {
  const user = c.get('user') as any
  const timeEntryId = c.req.param('id')
  const body = await c.req.json()
  const { clockOutLocation, notes } = body
  const caregiverId = user.role === 'caregiver' ? user.userId : body.caregiverId

  const [entry] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.caregiverId, caregiverId), isNull(timeEntries.endTime)))
    .limit(1)
  if (!entry) return c.json({ error: 'Active time entry not found' }, 404)

  const endTime = new Date()
  const durationMinutes = Math.round((endTime.getTime() - entry.startTime.getTime()) / 60000)

  const [updated] = await db.update(timeEntries)
    .set({
      endTime,
      durationMinutes,
      billableMinutes: durationMinutes,
      clockOutLocation,
      notes: notes || entry.notes,
      isComplete: true,
      updatedAt: new Date(),
    })
    .where(eq(timeEntries.id, entry.id))
    .returning()

  if (process.env.ENABLE_SANDATA_EVV === 'true') {
    try {
      const clockIn = entry.clockInLocation as any
      const clockOut = clockOutLocation as any
      await db.insert(evvVisits).values({
        timeEntryId: entry.id,
        clientId: entry.clientId,
        caregiverId: entry.caregiverId,
        serviceDate: entry.startTime.toISOString().split('T')[0],
        actualStart: entry.startTime,
        actualEnd: endTime,
        gpsInLat: clockIn?.lat ?? null,
        gpsInLng: clockIn?.lng ?? null,
        gpsOutLat: clockOut?.lat ?? null,
        gpsOutLng: clockOut?.lng ?? null,
        evvMethod: (clockIn?.lat || clockOut?.lat) ? 'gps' : 'manual',
      }).onConflictDoNothing()
    } catch (evvErr: any) {
      console.warn('[EVV] Auto-create failed for time entry', entry.id, ':', evvErr.message)
    }
  }

  return c.json(updated)
})

// POST /api/time-entries/:id/gps — parameterized GPS log (frontend uses this path)
app.post('/:id/gps', async (c) => {
  const user = c.get('user') as any
  const timeEntryId = c.req.param('id')
  const { latitude, longitude, accuracy, speed, heading } = await c.req.json()
  const [point] = await db.insert(gpsTracking)
    .values({ caregiverId: user.userId, timeEntryId, latitude, longitude, accuracy, speed, heading })
    .returning()
  return c.json(point, 201)
})

// PUT /api/time-tracking/:id - admin edit
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

// GET /api/time-tracking/:id/gps
app.get('/:id/gps', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const points = await db.select().from(gpsTracking)
    .where(eq(gpsTracking.timeEntryId, id))
    .orderBy(asc(gpsTracking.timestamp))
  return c.json(points)
})

// GET /api/time-tracking/geofence/:clientId
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

  // Check if settings exist for this client
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
