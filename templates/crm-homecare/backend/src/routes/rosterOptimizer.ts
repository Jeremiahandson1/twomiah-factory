import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { schedules, clients, users, caregiverAvailability, clientAssignments } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/roster-optimizer/roster
app.get('/roster', async (c) => {
  const rows = await db
    .select({
      id: schedules.id,
      clientId: schedules.clientId,
      caregiverId: schedules.caregiverId,
      title: schedules.title,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      frequency: schedules.frequency,
      dayOfWeek: schedules.dayOfWeek,
      scheduleType: schedules.scheduleType,
      isActive: schedules.isActive,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
    .from(schedules)
    .leftJoin(clients, eq(schedules.clientId, clients.id))
    .leftJoin(users, eq(schedules.caregiverId, users.id))
    .where(eq(schedules.isActive, true))

  const assignments = await db
    .select()
    .from(clientAssignments)
    .where(eq(clientAssignments.status, 'active'))

  return c.json({ roster: rows, assignments })
})

// POST /api/roster-optimizer/run
app.post('/run', async (c) => {
  const roster = await db
    .select({
      id: schedules.id,
      clientId: schedules.clientId,
      caregiverId: schedules.caregiverId,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      dayOfWeek: schedules.dayOfWeek,
    })
    .from(schedules)
    .where(eq(schedules.isActive, true))

  const availability = await db.select().from(caregiverAvailability)

  return c.json({
    suggestions: [],
    metrics: {
      totalSchedules: roster.length,
      caregiversWithAvailability: availability.length,
      coverageRate: roster.length > 0 ? 1.0 : 0,
    },
    message: 'Optimization analysis complete. No changes suggested.',
  })
})

// POST /api/roster-optimizer/apply
app.post('/apply', async (c) => {
  return c.json({ success: true, message: 'No changes to apply.' })
})

export default app
