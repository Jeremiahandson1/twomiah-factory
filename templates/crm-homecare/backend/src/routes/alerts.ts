import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { alerts, users } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/alerts?type=&priority=&status=
app.get('/', async (c) => {
  const { type, priority, status } = c.req.query()

  const conditions: any[] = []
  if (type) conditions.push(eq(alerts.alertType, type))
  if (priority) conditions.push(eq(alerts.priority, priority))
  if (status) conditions.push(eq(alerts.status, status))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: alerts.id,
      alertType: alerts.alertType,
      priority: alerts.priority,
      message: alerts.message,
      status: alerts.status,
      dueDate: alerts.dueDate,
      relatedEntityType: alerts.relatedEntityType,
      relatedEntityId: alerts.relatedEntityId,
      acknowledgedAt: alerts.acknowledgedAt,
      resolvedAt: alerts.resolvedAt,
      resolution: alerts.resolution,
      createdAt: alerts.createdAt,
      createdByFirstName: users.firstName,
      createdByLastName: users.lastName,
    })
    .from(alerts)
    .leftJoin(users, eq(alerts.createdById, users.id))
    .where(whereClause)
    .orderBy(desc(alerts.createdAt))
    .limit(200)

  return c.json(rows)
})

// POST /api/alerts
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  if (!body.alertType || !body.message) {
    return c.json({ error: 'alertType and message are required' }, 400)
  }

  const [row] = await db.insert(alerts).values({
    alertType: body.alertType,
    priority: body.priority || 'medium',
    message: body.message,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    relatedEntityType: body.relatedEntityType,
    relatedEntityId: body.relatedEntityId,
    createdById: user.userId,
  }).returning()

  return c.json(row, 201)
})

// PUT /api/alerts/:alertId/acknowledge
app.put('/:alertId/acknowledge', async (c) => {
  const user = c.get('user') as any
  const { alertId } = c.req.param()

  const [row] = await db.update(alerts)
    .set({
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedById: user.userId,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, alertId))
    .returning()

  if (!row) return c.json({ error: 'Alert not found' }, 404)
  return c.json(row)
})

// PUT /api/alerts/:alertId/resolve
app.put('/:alertId/resolve', async (c) => {
  const user = c.get('user') as any
  const { alertId } = c.req.param()
  const body = await c.req.json().catch(() => ({}))

  const [row] = await db.update(alerts)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedById: user.userId,
      resolution: body.resolution || null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, alertId))
    .returning()

  if (!row) return c.json({ error: 'Alert not found' }, 404)
  return c.json(row)
})

// PUT /api/alerts/:alertId/dismiss
app.put('/:alertId/dismiss', async (c) => {
  const user = c.get('user') as any
  const { alertId } = c.req.param()

  const [row] = await db.update(alerts)
    .set({
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedById: user.userId,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, alertId))
    .returning()

  if (!row) return c.json({ error: 'Alert not found' }, 404)
  return c.json(row)
})

export default app
