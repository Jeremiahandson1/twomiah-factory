import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { noshowAlerts, noshowAlertConfig, users, clients } from '../../db/schema.ts'
import { eq, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/no-show/alerts — list with ?status filter
app.get('/alerts', async (c) => {
  const { status = 'open' } = c.req.query()

  const caregiverUser = db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .as('caregiver_user')

  const rows = await db
    .select({
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
      caregiverFirstName: caregiverUser.firstName,
      caregiverLastName: caregiverUser.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(noshowAlerts)
    .leftJoin(caregiverUser, eq(noshowAlerts.caregiverId, caregiverUser.id))
    .leftJoin(clients, eq(noshowAlerts.clientId, clients.id))
    .where(status !== 'all' ? eq(noshowAlerts.status, status) : undefined)
    .orderBy(desc(noshowAlerts.shiftDate))

  const alerts = rows.map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, ...alert }) => ({
    ...alert,
    caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
    clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
  }))

  return c.json(alerts)
})

// GET /api/no-show/stats
app.get('/stats', async (c) => {
  const [totalRows] = await db.select({ value: count() }).from(noshowAlerts)
  const [resolvedRows] = await db.select({ value: count() }).from(noshowAlerts).where(eq(noshowAlerts.status, 'resolved'))
  const [pendingRows] = await db.select({ value: count() }).from(noshowAlerts).where(eq(noshowAlerts.status, 'open'))

  return c.json({
    total: totalRows.value,
    resolved: resolvedRows.value,
    pending: pendingRows.value,
  })
})

// GET /api/no-show/config
app.get('/config', async (c) => {
  const [config] = await db.select().from(noshowAlertConfig).limit(1)

  if (!config) {
    return c.json({
      graceMinutes: 15,
      notifyAdmin: true,
      notifyCaregiver: true,
      notifyClientFamily: false,
      adminPhone: null,
      adminEmail: null,
      isActive: true,
    })
  }

  return c.json(config)
})

// POST /api/no-show/run-check — stub (manual check is complex)
app.post('/run-check', async (c) => {
  return c.json({ checked: 0, alerts_created: 0 })
})

// PUT /api/no-show/alerts/:id/resolve
app.put('/alerts/:id/resolve', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')
  const { resolutionNote } = await c.req.json()

  const [updated] = await db
    .update(noshowAlerts)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedById: user.userId,
      resolutionNote: resolutionNote || null,
    })
    .where(eq(noshowAlerts.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Alert not found' }, 404)

  return c.json(updated)
})

// PUT /api/no-show/config — upsert config
app.put('/config', async (c) => {
  const body = await c.req.json()

  const [existing] = await db.select({ id: noshowAlertConfig.id }).from(noshowAlertConfig).limit(1)

  if (existing) {
    const [updated] = await db
      .update(noshowAlertConfig)
      .set({
        graceMinutes: body.graceMinutes,
        notifyAdmin: body.notifyAdmin,
        notifyCaregiver: body.notifyCaregiver,
        notifyClientFamily: body.notifyClientFamily,
        adminPhone: body.adminPhone,
        adminEmail: body.adminEmail,
        isActive: body.isActive,
        updatedAt: new Date(),
      })
      .where(eq(noshowAlertConfig.id, existing.id))
      .returning()
    return c.json(updated)
  } else {
    const [created] = await db
      .insert(noshowAlertConfig)
      .values({
        graceMinutes: body.graceMinutes ?? 15,
        notifyAdmin: body.notifyAdmin ?? true,
        notifyCaregiver: body.notifyCaregiver ?? true,
        notifyClientFamily: body.notifyClientFamily ?? false,
        adminPhone: body.adminPhone,
        adminEmail: body.adminEmail,
        isActive: body.isActive ?? true,
      })
      .returning()
    return c.json(created)
  }
})

export default app
