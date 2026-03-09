import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { schedules, users, clients } from '../../db/schema.ts'
import { eq, and, gte, lte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/schedules-all
app.get('/', async (c) => {
  const { startDate, endDate, caregiverId, clientId } = c.req.query()
  const conditions: any[] = [eq(schedules.isActive, true)]
  if (caregiverId) conditions.push(eq(schedules.caregiverId, caregiverId))
  if (clientId) conditions.push(eq(schedules.clientId, clientId))
  if (startDate) conditions.push(gte(schedules.startTime, new Date(startDate)))
  if (endDate) conditions.push(lte(schedules.startTime, new Date(endDate)))

  const rows = await db
    .select({
      id: schedules.id,
      clientId: schedules.clientId,
      caregiverId: schedules.caregiverId,
      title: schedules.title,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      frequency: schedules.frequency,
      effectiveDate: schedules.effectiveDate,
      anchorDate: schedules.anchorDate,
      scheduleType: schedules.scheduleType,
      isActive: schedules.isActive,
      dayOfWeek: schedules.dayOfWeek,
      notes: schedules.notes,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(schedules)
    .leftJoin(users, eq(schedules.caregiverId, users.id))
    .leftJoin(clients, eq(schedules.clientId, clients.id))
    .where(and(...conditions))

  return c.json(rows)
})

// PUT /api/schedules-all/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [row] = await db
    .update(schedules)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(schedules.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

export default app
