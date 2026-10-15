import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { noshowAlerts, noshowAlertConfig, users, clients } from '../../db/schema.ts'
import { eq, count, desc, sql } from 'drizzle-orm'
import { agencyToday } from '../services/agencyTime.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
// No-show monitoring and its configuration are the office's. (CVHC noShowRoutes.js left them on verifyToken alone — any caregiver could change the detection config or resolve alerts; office-only here, a deliberate difference.)
app.use('*', authenticate, requireAdmin)

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
// The No-Show screen and the dashboard's no-show banner read CVHC's shape (open_count, today_count,
// week_count, resolved_count, false_alarm_count); this answered { total, resolved, pending }, so both
// showed 0 open alerts. "Today" is the agency's calendar day. The old keys stay for any other reader.
app.get('/stats', async (c) => {
  const today = await agencyToday()
  const r = ((await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
      COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'false_alarm')::int AS false_alarm_count,
      COUNT(*) FILTER (WHERE shift_date = (${today})::date)::int AS today_count,
      COUNT(*) FILTER (WHERE shift_date >= (${today})::date - 7)::int AS week_count
    FROM noshow_alerts`)) as any).rows[0] || {}
  return c.json({ ...r, resolved: r.resolved_count, pending: r.open_count })
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
