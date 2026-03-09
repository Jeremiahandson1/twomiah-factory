import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { communicationLog } from '../../db/schema.ts'
import { eq, and, desc, asc, isNotNull } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/communication-log/follow-ups/pending
app.get('/follow-ups/pending', async (c) => {
  const rows = await db
    .select()
    .from(communicationLog)
    .where(
      and(
        eq(communicationLog.followUpDone, false),
        isNotNull(communicationLog.followUpDate)
      )
    )
    .orderBy(asc(communicationLog.followUpDate))

  return c.json(rows)
})

// GET /api/communication-log/:entityType/:entityId
app.get('/:entityType/:entityId', async (c) => {
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')

  const rows = await db
    .select()
    .from(communicationLog)
    .where(
      and(
        eq(communicationLog.entityType, entityType),
        eq(communicationLog.entityId, entityId)
      )
    )
    .orderBy(desc(communicationLog.createdAt))

  return c.json(rows)
})

// POST /api/communication-log
app.post('/', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  if (!body.entityType || !body.entityId || !body.body) {
    return c.json({ error: 'entityType, entityId, and body are required' }, 400)
  }

  const [row] = await db
    .insert(communicationLog)
    .values({
      entityType: body.entityType,
      entityId: body.entityId,
      logType: body.logType || 'note',
      direction: body.direction,
      subject: body.subject,
      body: body.body,
      loggedById: user.userId,
      loggedByName: user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.name || null,
      clientId: body.clientId,
      followUpDate: body.followUpDate,
      followUpDone: body.followUpDone || false,
      isPinned: body.isPinned || false,
    })
    .returning()

  return c.json(row, 201)
})

// PUT /api/communication-log/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(communicationLog)
    .set({
      logType: body.logType,
      direction: body.direction,
      subject: body.subject,
      body: body.body,
      clientId: body.clientId,
      followUpDate: body.followUpDate,
      followUpDone: body.followUpDone,
      isPinned: body.isPinned,
      updatedAt: new Date(),
    })
    .where(eq(communicationLog.id, id))
    .returning()

  if (!row) return c.json({ error: 'Log entry not found' }, 404)
  return c.json(row)
})

// DELETE /api/communication-log/:id
app.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const [row] = await db
    .delete(communicationLog)
    .where(eq(communicationLog.id, id))
    .returning()

  if (!row) return c.json({ error: 'Log entry not found' }, 404)
  return c.json({ success: true })
})

export default app
