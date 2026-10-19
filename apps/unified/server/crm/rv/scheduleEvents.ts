// Calendar appointments (test drives, service drop-offs, deliveries, follow-ups) on the Schedule screen (its `events`
// setting). Booking asks schedule:create, rescheduling and cancelling schedule:update (T68); a cancel is soft, the
// appointment stays greyed. Moved from templates/crm-rv/backend/src/routes/scheduleEvents.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, asc } from 'drizzle-orm'
import { scheduleEvent, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

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

export function createScheduleEventRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /?from=&to= — appointments starting in the range, with who they're assigned to. A list reply (the template sent
  // { data } alone; the shared Schedule screen reads .data). schedule:read, as the jobs schedule asks (the template asked none).
  app.get('/', requirePermission('schedule:read'), async (c) => {
    const currentUser = c.get('user')
    const from = c.req.query('from')
    const to = c.req.query('to')
    const conditions: any[] = [eq(scheduleEvent.companyId, currentUser.companyId)]
    if (from) conditions.push(gte(scheduleEvent.start, new Date(from)))
    if (to) conditions.push(lte(scheduleEvent.start, new Date(to)))
    const rows = await db.select({ event: scheduleEvent, assignedFirstName: user.firstName, assignedLastName: user.lastName })
      .from(scheduleEvent)
      .leftJoin(user, eq(scheduleEvent.userId, user.id))
      .where(and(...conditions))
      .orderBy(asc(scheduleEvent.start))
    const data = rows.map((r: any) => ({
      ...r.event,
      assignedUser: r.assignedFirstName ? { firstName: r.assignedFirstName, lastName: r.assignedLastName } : null,
    }))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  app.post('/', requirePermission('schedule:create'), async (c) => {
    const currentUser = c.get('user')
    const data = eventSchema.parse(await c.req.json())
    const start = new Date(data.start)
    const end = data.end ? new Date(data.end) : new Date(start.getTime() + 60 * 60 * 1000)
    if (end < start) return fail(c, 400, 'End time cannot be before the start time')
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
    return one(c, row, 201)
  })

  // PATCH /:id — update / reschedule. PUT too: the shared Schedule screen's client sends PUT. (T68)
  const updateEvent = async (c: any) => {
    const currentUser = c.get('user')
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
    const [row] = await db.update(scheduleEvent).set(updates)
      .where(and(eq(scheduleEvent.id, c.req.param('id')), eq(scheduleEvent.companyId, currentUser.companyId))).returning()
    if (!row) return fail(c, 404, 'Appointment not found')
    return one(c, row)
  }
  app.patch('/:id', requirePermission('schedule:update'), updateEvent)
  app.put('/:id', requirePermission('schedule:update'), updateEvent)

  // DELETE /:id — "Cancel appointment": status cancelled, never a hard delete.
  app.delete('/:id', requirePermission('schedule:update'), async (c) => {
    const currentUser = c.get('user')
    const [row] = await db.update(scheduleEvent).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(scheduleEvent.id, c.req.param('id')), eq(scheduleEvent.companyId, currentUser.companyId))).returning()
    if (!row) return fail(c, 404, 'Appointment not found')
    return one(c, row)
  })

  return app
}
