import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { scheduleEvent, user } from '../../db/schema.ts'
import { eq, and, gte, lte, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

// Calendar appointments (test drives, service drop-offs, deliveries, follow-ups).
// The scheduleEvent table existed but had no route, so the Schedule page had
// nothing to show and no way to create anything (H-08).
const app = new Hono()
app.use('*', authenticate)

// GET /?from=&to= — events in a date range, with the assigned user
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const from = c.req.query('from')
  const to = c.req.query('to')

  const conditions: any[] = [eq(scheduleEvent.companyId, currentUser.companyId)]
  if (from) conditions.push(gte(scheduleEvent.start, new Date(from)))
  if (to) conditions.push(lte(scheduleEvent.start, new Date(to)))

  const rows = await db
    .select({
      event: scheduleEvent,
      assignedFirstName: user.firstName,
      assignedLastName: user.lastName,
    })
    .from(scheduleEvent)
    .leftJoin(user, eq(scheduleEvent.userId, user.id))
    .where(and(...conditions))
    .orderBy(asc(scheduleEvent.start))

  return c.json({
    data: rows.map(r => ({
      ...r.event,
      assignedUser: r.assignedFirstName ? { firstName: r.assignedFirstName, lastName: r.assignedLastName } : null,
    })),
  })
})

const eventSchema = z.object({
  title: z.string().min(1),
  type: z.string().optional(),
  start: z.string(),
  end: z.string().optional(),
  allDay: z.boolean().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  color: z.string().optional(),
  userId: z.string().optional(),
})

// POST / — create an appointment
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = eventSchema.parse(await c.req.json())

  const start = new Date(data.start)
  const end = data.end ? new Date(data.end) : new Date(start.getTime() + 60 * 60 * 1000)
  if (end < start) return c.json({ error: 'End time cannot be before the start time' }, 400)

  const [row] = await db.insert(scheduleEvent).values({
    title: data.title,
    type: data.type || 'appointment',
    start,
    end,
    allDay: data.allDay ?? false,
    status: data.status || 'scheduled',
    notes: data.notes || null,
    color: data.color || null,
    companyId: currentUser.companyId,
    userId: data.userId || currentUser.userId,
  }).returning()
  return c.json(row, 201)
})

// PATCH /:id — update / reschedule
app.patch('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const updates: any = { updatedAt: new Date() }
  if (body.title !== undefined) updates.title = body.title
  if (body.type !== undefined) updates.type = body.type
  if (body.start !== undefined) updates.start = new Date(body.start)
  if (body.end !== undefined) updates.end = new Date(body.end)
  if (body.allDay !== undefined) updates.allDay = !!body.allDay
  if (body.status !== undefined) updates.status = body.status
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.color !== undefined) updates.color = body.color
  if (body.userId !== undefined) updates.userId = body.userId

  const [row] = await db.update(scheduleEvent)
    .set(updates)
    .where(and(eq(scheduleEvent.id, id), eq(scheduleEvent.companyId, currentUser.companyId)))
    .returning()
  if (!row) return c.json({ error: 'Appointment not found' }, 404)
  return c.json(row)
})

// DELETE /:id
app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  await db.delete(scheduleEvent)
    .where(and(eq(scheduleEvent.id, id), eq(scheduleEvent.companyId, currentUser.companyId)))
  return c.json({ message: 'Appointment deleted' })
})

export default app
