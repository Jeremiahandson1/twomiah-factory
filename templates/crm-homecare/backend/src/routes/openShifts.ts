import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { openShifts, openShiftNotifications, clients, users } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/open-shifts — list with ?status filter, join clients
app.get('/', async (c) => {
  const { status } = c.req.query()

  const rows = await db
    .select({
      id: openShifts.id,
      clientId: openShifts.clientId,
      date: openShifts.date,
      startTime: openShifts.startTime,
      endTime: openShifts.endTime,
      status: openShifts.status,
      notes: openShifts.notes,
      sourceAbsenceId: openShifts.sourceAbsenceId,
      notifiedCaregiverCount: openShifts.notifiedCaregiverCount,
      autoCreated: openShifts.autoCreated,
      createdById: openShifts.createdById,
      createdAt: openShifts.createdAt,
      updatedAt: openShifts.updatedAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(openShifts)
    .leftJoin(clients, eq(openShifts.clientId, clients.id))
    .where(status ? eq(openShifts.status, status) : undefined)
    .orderBy(desc(openShifts.date))
    .limit(500)

  const shifts = rows.map(({ clientFirstName, clientLastName, ...shift }) => ({
    ...shift,
    clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
  }))

  return c.json(shifts)
})

// GET /api/open-shifts/available — open shifts for caregiver view
app.get('/available', async (c) => {
  const rows = await db
    .select({
      id: openShifts.id,
      clientId: openShifts.clientId,
      date: openShifts.date,
      startTime: openShifts.startTime,
      endTime: openShifts.endTime,
      status: openShifts.status,
      notes: openShifts.notes,
      createdAt: openShifts.createdAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(openShifts)
    .leftJoin(clients, eq(openShifts.clientId, clients.id))
    .where(eq(openShifts.status, 'open'))
    .orderBy(desc(openShifts.date))

  const shifts = rows.map(({ clientFirstName, clientLastName, ...shift }) => ({
    ...shift,
    clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
  }))

  return c.json(shifts)
})

// GET /api/open-shifts/:id/claims — notifications/claims for a shift
app.get('/:id/claims', async (c) => {
  const shiftId = c.req.param('id')

  const rows = await db
    .select({
      id: openShiftNotifications.id,
      openShiftId: openShiftNotifications.openShiftId,
      caregiverId: openShiftNotifications.caregiverId,
      notifiedAt: openShiftNotifications.notifiedAt,
      notificationType: openShiftNotifications.notificationType,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
    .from(openShiftNotifications)
    .leftJoin(users, eq(openShiftNotifications.caregiverId, users.id))
    .where(eq(openShiftNotifications.openShiftId, shiftId))

  const claims = rows.map(({ caregiverFirstName, caregiverLastName, ...claim }) => ({
    ...claim,
    caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
  }))

  return c.json(claims)
})

// POST /api/open-shifts — create shift
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const [shift] = await db
    .insert(openShifts)
    .values({
      clientId: body.clientId || null,
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      status: 'open',
      notes: body.notes,
      sourceAbsenceId: body.sourceAbsenceId || null,
      createdById: user.userId,
    })
    .returning()

  return c.json(shift, 201)
})

// POST /api/open-shifts/:id/claim — caregiver claims a shift
app.post('/:id/claim', async (c) => {
  const shiftId = c.req.param('id')
  const user = c.get('user')

  // Verify shift exists and is still open
  const [shift] = await db.select({ status: openShifts.status }).from(openShifts).where(eq(openShifts.id, shiftId))
  if (!shift) return c.json({ error: 'Shift not found' }, 404)
  if (shift.status !== 'open') return c.json({ error: 'Shift is no longer available' }, 400)

  const [notification] = await db
    .insert(openShiftNotifications)
    .values({
      openShiftId: shiftId,
      caregiverId: user.userId,
      notificationType: 'claim',
    })
    .returning()

  return c.json(notification, 201)
})

// POST /api/open-shifts/:id/broadcast — notify available caregivers about an open shift
app.post('/:id/broadcast', requireAdmin, async (c) => {
  const shiftId = c.req.param('id')

  // Get the shift
  const [shift] = await db.select().from(openShifts).where(eq(openShifts.id, shiftId))
  if (!shift) return c.json({ error: 'Shift not found' }, 404)

  // Find active caregivers
  const caregivers = await db.select({
    id: users.id,
    firstName: users.firstName,
    lastName: users.lastName,
    phone: users.phone,
  })
    .from(users)
    .where(and(eq(users.role, 'caregiver'), eq(users.isActive, true)))

  // Filter out caregivers who already claimed/were notified
  const existingNotifications = await db.select({ caregiverId: openShiftNotifications.caregiverId })
    .from(openShiftNotifications)
    .where(eq(openShiftNotifications.openShiftId, shiftId))
  const alreadyNotifiedIds = new Set(existingNotifications.map(n => n.caregiverId))

  const eligibleCaregivers = caregivers.filter(cg => !alreadyNotifiedIds.has(cg.id))

  // Batch insert notification records for eligible caregivers
  let notified = 0
  if (eligibleCaregivers.length > 0) {
    const values = eligibleCaregivers.map(cg => ({
      openShiftId: shiftId,
      caregiverId: cg.id,
      notificationType: 'broadcast' as const,
    }))
    await db.insert(openShiftNotifications).values(values)
    notified = eligibleCaregivers.length
  }

  // Update the shift's total notified count (additive)
  const totalNotified = alreadyNotifiedIds.size + notified
  await db.update(openShifts)
    .set({ notifiedCaregiverCount: totalNotified, updatedAt: new Date() })
    .where(eq(openShifts.id, shiftId))

  return c.json({ success: true, notified, totalNotified })
})

// PUT /api/open-shifts/:id/approve — mark shift as filled
app.put('/:id/approve', requireAdmin, async (c) => {
  const id = c.req.param('id')

  const [updated] = await db
    .update(openShifts)
    .set({ status: 'filled', updatedAt: new Date() })
    .where(eq(openShifts.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Shift not found' }, 404)

  return c.json(updated)
})

// PUT /api/open-shifts/:id/reject — reset shift
app.put('/:id/reject', requireAdmin, async (c) => {
  const id = c.req.param('id')

  const [updated] = await db
    .update(openShifts)
    .set({ status: 'open', updatedAt: new Date() })
    .where(eq(openShifts.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Shift not found' }, 404)

  return c.json(updated)
})

export default app
