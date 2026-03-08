import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { adlRequirements, adlLogs, users } from '../../db/schema.ts'
import { eq, and, desc, gte, lte } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/adl/client/:clientId/requirements
app.get('/client/:clientId/requirements', async (c) => {
  const { clientId } = c.req.param()

  const rows = await db
    .select()
    .from(adlRequirements)
    .where(and(eq(adlRequirements.clientId, clientId), eq(adlRequirements.isActive, true)))
    .orderBy(adlRequirements.adlCategory)

  return c.json(rows)
})

// GET /api/adl/client/:clientId/logs?startDate=&endDate=
app.get('/client/:clientId/logs', async (c) => {
  const { clientId } = c.req.param()
  const { startDate, endDate } = c.req.query()

  const conditions: any[] = [eq(adlLogs.clientId, clientId)]
  if (startDate) conditions.push(gte(adlLogs.performedAt, new Date(startDate)))
  if (endDate) conditions.push(lte(adlLogs.performedAt, new Date(endDate + 'T23:59:59')))

  const rows = await db
    .select({
      id: adlLogs.id,
      clientId: adlLogs.clientId,
      caregiverId: adlLogs.caregiverId,
      adlCategory: adlLogs.adlCategory,
      status: adlLogs.status,
      assistanceLevel: adlLogs.assistanceLevel,
      performedAt: adlLogs.performedAt,
      notes: adlLogs.notes,
      createdAt: adlLogs.createdAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
    .from(adlLogs)
    .leftJoin(users, eq(adlLogs.caregiverId, users.id))
    .where(and(...conditions))
    .orderBy(desc(adlLogs.performedAt))

  return c.json(rows)
})

// POST /api/adl/requirements
app.post('/requirements', requireAdmin, async (c) => {
  const body = await c.req.json()
  const { clientId, adlCategory, assistanceLevel, frequency, specialInstructions } = body

  if (!clientId || !adlCategory || !assistanceLevel) {
    return c.json({ error: 'clientId, adlCategory, and assistanceLevel are required' }, 400)
  }

  const [row] = await db.insert(adlRequirements).values({
    clientId,
    adlCategory,
    assistanceLevel,
    frequency,
    specialInstructions,
  }).returning()

  return c.json(row, 201)
})

// DELETE /api/adl/requirements/:reqId
app.delete('/requirements/:reqId', requireAdmin, async (c) => {
  const { reqId } = c.req.param()

  await db.update(adlRequirements)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(adlRequirements.id, reqId))

  return c.json({ ok: true })
})

// POST /api/adl/log
app.post('/log', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { clientId, adlCategory, status, assistanceLevel, performedAt, notes } = body

  if (!clientId || !adlCategory || !status) {
    return c.json({ error: 'clientId, adlCategory, and status are required' }, 400)
  }

  const [row] = await db.insert(adlLogs).values({
    clientId,
    caregiverId: user.userId,
    adlCategory,
    status,
    assistanceLevel,
    performedAt: performedAt ? new Date(performedAt) : new Date(),
    notes,
  }).returning()

  return c.json(row, 201)
})

export default app
