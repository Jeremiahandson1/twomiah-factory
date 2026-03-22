import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { alerts, users, certificationAlerts, certificationRecords } from '../../db/schema.ts'
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm'
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

// ==================== CERTIFICATION ALERTS ====================

// GET /api/alerts/certifications — list certification expiration alerts
app.get('/certifications', async (c) => {
  const status = c.req.query('status')

  const conditions: any[] = []
  if (status) conditions.push(eq(certificationAlerts.status, status))

  const rows = await db.select({
    id: certificationAlerts.id,
    caregiverId: certificationAlerts.caregiverId,
    certificationRecordId: certificationAlerts.certificationRecordId,
    certificationType: certificationAlerts.certificationType,
    expiryDate: certificationAlerts.expiryDate,
    alertType: certificationAlerts.alertType,
    daysUntilExpiry: certificationAlerts.daysUntilExpiry,
    status: certificationAlerts.status,
    acknowledgedAt: certificationAlerts.acknowledgedAt,
    createdAt: certificationAlerts.createdAt,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(certificationAlerts)
    .leftJoin(users, eq(certificationAlerts.caregiverId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(certificationAlerts.expiryDate)
    .limit(500)

  return c.json(rows)
})

// PUT /api/alerts/certifications/:id/acknowledge
app.put('/certifications/:id/acknowledge', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as any

  const [row] = await db.update(certificationAlerts)
    .set({
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedById: user.userId,
    })
    .where(eq(certificationAlerts.id, id))
    .returning()

  if (!row) return c.json({ error: 'Certification alert not found' }, 404)
  return c.json(row)
})

// POST /api/alerts/certifications/generate — scan for expiring certs, create alerts
app.post('/certifications/generate', requireAdmin, async (c) => {
  try {
    const today = new Date()
    const thirtyDaysOut = new Date(today)
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30)
    const todayStr = today.toISOString().split('T')[0]
    const thirtyDaysStr = thirtyDaysOut.toISOString().split('T')[0]

    // Find active certs expiring within 30 days
    const expiringCerts = await db.select({
      id: certificationRecords.id,
      caregiverId: certificationRecords.caregiverId,
      certificationType: certificationRecords.certificationType,
      expiryDate: certificationRecords.expiryDate,
    })
      .from(certificationRecords)
      .where(and(
        eq(certificationRecords.status, 'active'),
        lte(certificationRecords.expiryDate, thirtyDaysStr),
        gte(certificationRecords.expiryDate, todayStr),
      ))

    // Get existing active alerts to avoid duplicates
    const existingAlerts = await db.select({
      certificationRecordId: certificationAlerts.certificationRecordId,
    })
      .from(certificationAlerts)
      .where(eq(certificationAlerts.status, 'active'))

    const existingCertIds = new Set(existingAlerts.map(a => a.certificationRecordId))

    let created = 0
    for (const cert of expiringCerts) {
      if (existingCertIds.has(cert.id)) continue
      if (!cert.expiryDate) continue

      const expiryDate = new Date(cert.expiryDate)
      const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

      await db.insert(certificationAlerts).values({
        caregiverId: cert.caregiverId,
        certificationRecordId: cert.id,
        certificationType: cert.certificationType,
        expiryDate: cert.expiryDate,
        alertType: daysUntilExpiry <= 7 ? 'expiring_urgent' : 'expiring_soon',
        daysUntilExpiry,
      })
      created++
    }

    return c.json({ scanned: expiringCerts.length, created, skippedDuplicates: expiringCerts.length - created })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
