import { Hono } from 'hono'
import { eq, and, gte, lte, asc, desc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  schedules,
  caregiverSchedules,
  caregiverTimeOff,
  openShifts,
  openShiftNotifications,
  absences,
  noshowAlerts,
  noshowAlertConfig,
  users,
  clients,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()

app.use('*', authenticate)

// ── SCHEDULES ─────────────────────────────────────────────────────

app.get('/schedules', async (c) => {
  const clientId = c.req.query('clientId')
  const caregiverId = c.req.query('caregiverId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = []
  if (clientId) conditions.push(eq(schedules.clientId, clientId))
  if (caregiverId) conditions.push(eq(schedules.caregiverId, caregiverId))
  if (startDate) conditions.push(gte(schedules.effectiveDate, startDate))
  if (endDate) conditions.push(lte(schedules.effectiveDate, endDate))

  const rows = await db.select().from(schedules)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(schedules.effectiveDate))

  return c.json(rows)
})

app.post('/schedules', requireAdmin, async (c) => {
  const body = await c.req.json()
  const [schedule] = await db.insert(schedules).values(body).returning()
  return c.json(schedule, 201)
})

app.put('/schedules/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [schedule] = await db.update(schedules).set({ ...body, updatedAt: new Date() }).where(eq(schedules.id, id)).returning()
  return c.json(schedule)
})

app.delete('/schedules/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  await db.delete(schedules).where(eq(schedules.id, id))
  return c.json({ message: 'Deleted' })
})

// ── CAREGIVER SCHEDULES (availability calendar) ───────────────────

app.get('/caregiver-schedules', async (c) => {
  const caregiverId = c.req.query('caregiverId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = []
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
    caregiver: {
      firstName: users.firstName,
      lastName: users.lastName,
    },
  })
    .from(caregiverSchedules)
    .leftJoin(users, eq(users.id, caregiverSchedules.caregiverId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(caregiverSchedules.date))

  return c.json(rows)
})

app.post('/caregiver-schedules', requireAdmin, async (c) => {
  const body = await c.req.json()
  const [schedule] = await db.insert(caregiverSchedules).values(body).returning()
  return c.json(schedule, 201)
})

// ── TIME OFF ──────────────────────────────────────────────────────

app.get('/time-off', async (c) => {
  const caregiverId = c.req.query('caregiverId')
  const status = c.req.query('status')

  const conditions = []
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
    caregiver: {
      firstName: users.firstName,
      lastName: users.lastName,
    },
  })
    .from(caregiverTimeOff)
    .leftJoin(users, eq(users.id, caregiverTimeOff.caregiverId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(caregiverTimeOff.startDate))

  return c.json(rows)
})

app.post('/time-off', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const caregiverId = user.role === 'caregiver' ? user.userId : body.caregiverId
  const [timeOff] = await db.insert(caregiverTimeOff).values({ ...body, caregiverId }).returning()
  return c.json(timeOff, 201)
})

app.patch('/time-off/:id/approve', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as any
  const [updated] = await db.update(caregiverTimeOff)
    .set({ status: 'approved', approvedById: user.userId })
    .where(eq(caregiverTimeOff.id, id))
    .returning()
  return c.json(updated)
})

app.patch('/time-off/:id/reject', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(caregiverTimeOff)
    .set({ status: 'rejected' })
    .where(eq(caregiverTimeOff.id, id))
    .returning()
  return c.json(updated)
})

// ── OPEN SHIFTS ───────────────────────────────────────────────────

app.get('/open-shifts', async (c) => {
  const status = c.req.query('status') || 'open'

  const shifts = await db.select().from(openShifts)
    .where(eq(openShifts.status, status))
    .orderBy(asc(openShifts.date))

  // Fetch notifications for each shift
  const shiftIds = shifts.map((s) => s.id)
  const notifications = shiftIds.length
    ? await db.select().from(openShiftNotifications)
        .where(
          shiftIds.length === 1
            ? eq(openShiftNotifications.openShiftId, shiftIds[0])
            : undefined
        )
    : []

  // If multiple shifts, filter in JS; for single or zero, already filtered
  const result = shifts.map((shift) => ({
    ...shift,
    notifications: notifications.filter((n) => n.openShiftId === shift.id),
  }))

  return c.json(result)
})

app.post('/open-shifts', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const [shift] = await db.insert(openShifts).values({ ...body, createdById: user.userId }).returning()
  return c.json(shift, 201)
})

app.patch('/open-shifts/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [shift] = await db.update(openShifts).set({ ...body, updatedAt: new Date() }).where(eq(openShifts.id, id)).returning()
  return c.json(shift)
})

// ── ABSENCES ──────────────────────────────────────────────────────

app.get('/absences', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const caregiverId = c.req.query('caregiverId')

  const conditions = []
  if (caregiverId) conditions.push(eq(absences.caregiverId, caregiverId))
  if (startDate) conditions.push(gte(absences.date, startDate))
  if (endDate) conditions.push(lte(absences.date, endDate))

  const caregiver = db.$with('caregiver').as(
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users)
  )

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
    caregiver: {
      firstName: users.firstName,
      lastName: users.lastName,
    },
  })
    .from(absences)
    .leftJoin(users, eq(users.id, absences.caregiverId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(absences.date))

  // Fetch coverage caregiver names separately
  const coverageIds = [...new Set(rows.filter((r) => r.coverageAssignedTo).map((r) => r.coverageAssignedTo!))]
  let coverageMap: Record<string, { firstName: string; lastName: string }> = {}
  if (coverageIds.length) {
    const coverageUsers = await Promise.all(
      coverageIds.map(async (cid) => {
        const [u] = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users).where(eq(users.id, cid)).limit(1)
        return u
      })
    )
    for (const u of coverageUsers) {
      if (u) coverageMap[u.id] = { firstName: u.firstName, lastName: u.lastName }
    }
  }

  const result = rows.map((r) => ({
    ...r,
    coverageAssigned: r.coverageAssignedTo ? coverageMap[r.coverageAssignedTo] || null : null,
  }))

  return c.json(result)
})

app.post('/absences', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const [absence] = await db.insert(absences).values({ ...body, reportedById: user.userId }).returning()

  // Auto-create open shift if coverage needed
  if (absence.coverageNeeded) {
    await db.insert(openShifts).values({
      clientId: absence.clientId,
      date: absence.date,
      autoCreated: true,
      sourceAbsenceId: absence.id,
      createdById: user.userId,
    })
  }

  return c.json(absence, 201)
})

// ── NO-SHOW ALERTS ────────────────────────────────────────────────

app.get('/noshow-alerts', requireAdmin, async (c) => {
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
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    caregiverPhone: users.phone,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
    clientAddress: clients.address,
  })
    .from(noshowAlerts)
    .leftJoin(users, eq(users.id, noshowAlerts.caregiverId))
    .leftJoin(clients, eq(clients.id, noshowAlerts.clientId))
    .where(eq(noshowAlerts.status, 'open'))
    .orderBy(desc(noshowAlerts.alertedAt))

  const result = rows.map((r) => ({
    id: r.id,
    scheduleId: r.scheduleId,
    caregiverId: r.caregiverId,
    clientId: r.clientId,
    shiftDate: r.shiftDate,
    expectedStart: r.expectedStart,
    alertedAt: r.alertedAt,
    resolvedAt: r.resolvedAt,
    resolvedById: r.resolvedById,
    resolutionNote: r.resolutionNote,
    status: r.status,
    smsSent: r.smsSent,
    createdAt: r.createdAt,
    caregiver: {
      firstName: r.caregiverFirstName,
      lastName: r.caregiverLastName,
      phone: r.caregiverPhone,
    },
    client: {
      firstName: r.clientFirstName,
      lastName: r.clientLastName,
      address: r.clientAddress,
    },
  }))

  return c.json(result)
})

app.patch('/noshow-alerts/:id/resolve', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as any
  const body = await c.req.json()
  const [alert] = await db.update(noshowAlerts)
    .set({
      status: body.status || 'resolved',
      resolvedAt: new Date(),
      resolvedById: user.userId,
      resolutionNote: body.resolutionNote,
    })
    .where(eq(noshowAlerts.id, id))
    .returning()
  return c.json(alert)
})

app.get('/noshow-config', requireAdmin, async (c) => {
  let [config] = await db.select().from(noshowAlertConfig).limit(1)
  if (!config) {
    [config] = await db.insert(noshowAlertConfig).values({}).returning()
  }
  return c.json(config)
})

app.put('/noshow-config', requireAdmin, async (c) => {
  const body = await c.req.json()
  let [config] = await db.select().from(noshowAlertConfig).limit(1)
  if (config) {
    [config] = await db.update(noshowAlertConfig).set({ ...body, updatedAt: new Date() }).where(eq(noshowAlertConfig.id, config.id)).returning()
  } else {
    [config] = await db.insert(noshowAlertConfig).values(body).returning()
  }
  return c.json(config)
})

export default app
