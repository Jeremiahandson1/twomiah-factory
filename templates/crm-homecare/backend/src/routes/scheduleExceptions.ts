import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { scheduleExceptions, schedules } from '../../db/schema.ts'
import { eq, and, gte, lte, inArray } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list exceptions, optional filters: ?scheduleId, ?from, ?to
app.get('/', async (c) => {
  try {
    const scheduleId = c.req.query('scheduleId')
    const from = c.req.query('from')
    const to = c.req.query('to')

    const conditions = []
    if (scheduleId) conditions.push(eq(scheduleExceptions.scheduleId, scheduleId))
    if (from) conditions.push(gte(scheduleExceptions.exceptionDate, from))
    if (to) conditions.push(lte(scheduleExceptions.exceptionDate, to))

    let query = db.select().from(scheduleExceptions).orderBy(scheduleExceptions.exceptionDate).limit(1000)
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any
    }

    const rows = await query
    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST /by-schedules — bulk fetch exceptions for a list of schedule IDs
app.post('/by-schedules', async (c) => {
  try {
    const { scheduleIds } = await c.req.json()
    if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) return c.json([])

    const rows = await db.select()
      .from(scheduleExceptions)
      .where(inArray(scheduleExceptions.scheduleId, scheduleIds))
      .orderBy(scheduleExceptions.exceptionDate)

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — create an exception (cancel or modify one occurrence)
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user' as any)
  const body = await c.req.json()
  const { scheduleId, exceptionDate, exceptionType, overrideStartTime, overrideEndTime,
          overrideCaregiverId, overrideClientId, overrideNotes } = body

  if (!scheduleId || !exceptionDate || !exceptionType) {
    return c.json({ error: 'scheduleId, exceptionDate, and exceptionType are required' }, 400)
  }
  if (!['cancelled', 'modified'].includes(exceptionType)) {
    return c.json({ error: 'exceptionType must be cancelled or modified' }, 400)
  }

  try {
    // Verify the schedule exists
    const [sched] = await db.select().from(schedules).where(eq(schedules.id, scheduleId))
    if (!sched) return c.json({ error: 'Schedule not found' }, 404)

    const [row] = await db.insert(scheduleExceptions).values({
      scheduleId,
      exceptionDate,
      exceptionType,
      overrideStartTime: overrideStartTime || null,
      overrideEndTime: overrideEndTime || null,
      overrideCaregiverId: overrideCaregiverId || null,
      overrideClientId: overrideClientId || null,
      overrideNotes: overrideNotes || null,
      createdBy: user.userId,
    }).returning()

    return c.json(row, 201)
  } catch (error: any) {
    // Handle unique constraint violation (duplicate schedule+date) — upsert
    if (error.message?.includes('unique') || error.code === '23505') {
      try {
        const [updated] = await db.update(scheduleExceptions)
          .set({
            exceptionType,
            overrideStartTime: overrideStartTime || null,
            overrideEndTime: overrideEndTime || null,
            overrideCaregiverId: overrideCaregiverId || null,
            overrideClientId: overrideClientId || null,
            overrideNotes: overrideNotes || null,
          })
          .where(and(
            eq(scheduleExceptions.scheduleId, scheduleId),
            eq(scheduleExceptions.exceptionDate, exceptionDate),
          ))
          .returning()
        return c.json(updated)
      } catch (updateError: any) {
        return c.json({ error: updateError.message }, 500)
      }
    }
    return c.json({ error: error.message }, 500)
  }
})

// DELETE /:id — remove an exception (restore original occurrence)
app.delete('/:id', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    const [row] = await db.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id)).returning()
    if (!row) return c.json({ error: 'Exception not found' }, 404)
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
