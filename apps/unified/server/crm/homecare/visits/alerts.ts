// /api/alerts — the office's alert queue (care alerts it raises and works) and certification-expiry alerts. Moved from
// templates/crm-homecare/backend/src/routes/alerts.ts.
//
// The template made all of it requireAdmin (CVHC left it open to every caregiver; office-only there, a deliberate
// difference kept here). Permissions: the care alerts are care-compliance (read / create / update); the certification
// alerts are care-hr (read; update to acknowledge; create to scan). A caregiver holds neither.
//
// Changes: every read and write is the company's; the two lists are { data, pagination } (RULEBOOK §3; the template
// answered bare arrays); the scan's "days until expiry" counts the agency's calendar days (the template used the
// server's UTC date, so after 7 PM Central a certificate expiring "tomorrow" was 0 days away and 30 days out was off
// by one).
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import { alerts, user, certificationAlerts, certificationRecords } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'
import { who } from './shared.ts'

export function createAlertRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // ==================== CERTIFICATION ALERTS ====================
  // (Registered before /:alertId/… so their paths are never read as an alert id.)

  // GET /certifications — certification expiration alerts
  app.get('/certifications', requirePermission('care-hr:read'), async (c) => {
    const { companyId } = who(c)
    const status = c.req.query('status')
    const rows = await db.select({
      id: certificationAlerts.id, caregiverId: certificationAlerts.caregiverId,
      certificationRecordId: certificationAlerts.certificationRecordId, certificationType: certificationAlerts.certificationType,
      expiryDate: certificationAlerts.expiryDate, alertType: certificationAlerts.alertType,
      daysUntilExpiry: certificationAlerts.daysUntilExpiry, status: certificationAlerts.status,
      acknowledgedAt: certificationAlerts.acknowledgedAt, createdAt: certificationAlerts.createdAt,
      caregiverFirstName: user.firstName, caregiverLastName: user.lastName,
    })
      .from(certificationAlerts)
      .leftJoin(user, eq(certificationAlerts.caregiverId, user.id))
      .where(and(eq(certificationAlerts.companyId, companyId), ...(status ? [eq(certificationAlerts.status, status)] : [])))
      .orderBy(asc(certificationAlerts.expiryDate))
      .limit(500)
    return list(c, rows, { page: 1, limit: 500, total: rows.length })
  })

  // PUT /certifications/:id/acknowledge
  app.put('/certifications/:id/acknowledge', requirePermission('care-hr:update'), async (c) => {
    const { companyId, me } = who(c)
    const [row] = await db.update(certificationAlerts)
      .set({ status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedById: me })
      .where(and(eq(certificationAlerts.id, c.req.param('id')), eq(certificationAlerts.companyId, companyId)))
      .returning()
    if (!row) return fail(c, 404, 'Certification alert not found')
    return one(c, row)
  })

  // POST /certifications/generate — scan for certifications expiring within 30 days, one alert each
  app.post('/certifications/generate', requirePermission('care-hr:create'), async (c) => {
    const { companyId } = who(c)
    const todayStr = await core.time.today(companyId)
    const thirtyDaysStr = addDays(todayStr, 30)

    const expiringCerts = await db.select({
      id: certificationRecords.id, caregiverId: certificationRecords.caregiverId,
      certificationType: certificationRecords.certificationType, expiryDate: certificationRecords.expiryDate,
    })
      .from(certificationRecords)
      .where(and(
        eq(certificationRecords.companyId, companyId),
        eq(certificationRecords.status, 'active'),
        lte(certificationRecords.expiryDate, thirtyDaysStr),
        gte(certificationRecords.expiryDate, todayStr),
      ))

    // Active alerts already raised, so a scan never raises the same one twice.
    const existingAlerts = await db.select({ certificationRecordId: certificationAlerts.certificationRecordId })
      .from(certificationAlerts)
      .where(and(eq(certificationAlerts.companyId, companyId), eq(certificationAlerts.status, 'active')))
    const existingCertIds = new Set(existingAlerts.map((a: any) => a.certificationRecordId))

    let created = 0
    for (const cert of expiringCerts) {
      if (existingCertIds.has(cert.id)) continue
      if (!cert.expiryDate) continue
      // Whole calendar days from the agency's today to the expiry date.
      const daysUntilExpiry = Math.round((Date.parse(`${cert.expiryDate}T12:00:00Z`) - Date.parse(`${todayStr}T12:00:00Z`)) / 86400000)
      await db.insert(certificationAlerts).values({
        companyId,
        caregiverId: cert.caregiverId,
        certificationRecordId: cert.id,
        certificationType: cert.certificationType,
        expiryDate: cert.expiryDate,
        alertType: daysUntilExpiry <= 7 ? 'expiring_urgent' : 'expiring_soon',
        daysUntilExpiry,
      })
      created++
    }
    return one(c, { scanned: expiringCerts.length, created, skippedDuplicates: expiringCerts.length - created })
  })

  // ==================== THE OFFICE'S ALERTS ====================

  // GET /?type=&priority=&status=
  app.get('/', requirePermission('care-compliance:read'), async (c) => {
    const { companyId } = who(c)
    const { type, priority, status } = c.req.query()
    const conditions: any[] = [eq(alerts.companyId, companyId)]
    if (type) conditions.push(eq(alerts.alertType, type))
    if (priority) conditions.push(eq(alerts.priority, priority))
    if (status) conditions.push(eq(alerts.status, status))
    const rows = await db
      .select({
        id: alerts.id, alertType: alerts.alertType, priority: alerts.priority, message: alerts.message, status: alerts.status,
        dueDate: alerts.dueDate, relatedEntityType: alerts.relatedEntityType, relatedEntityId: alerts.relatedEntityId,
        acknowledgedAt: alerts.acknowledgedAt, resolvedAt: alerts.resolvedAt, resolution: alerts.resolution, createdAt: alerts.createdAt,
        createdByFirstName: user.firstName, createdByLastName: user.lastName,
      })
      .from(alerts)
      .leftJoin(user, eq(alerts.createdById, user.id))
      .where(and(...conditions))
      .orderBy(desc(alerts.createdAt))
      .limit(200)
    return list(c, rows, { page: 1, limit: 200, total: rows.length })
  })

  // POST /
  app.post('/', requirePermission('care-compliance:create'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    if (!body.alertType || !body.message) return fail(c, 400, 'alertType and message are required')
    const [row] = await db.insert(alerts).values({
      companyId,
      alertType: String(body.alertType),
      priority: body.priority || 'medium',
      message: String(body.message),
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      relatedEntityType: body.relatedEntityType,
      relatedEntityId: body.relatedEntityId,
      createdById: me,
    }).returning()
    return one(c, row, 201)
  })

  /** Move one of the company's alerts to a new status. */
  const setStatus = (status: 'acknowledged' | 'resolved' | 'dismissed') => async (c: any) => {
    const { companyId, me } = who(c)
    const body = status === 'resolved' ? await c.req.json().catch(() => ({})) : {}
    const now = new Date()
    const set: Record<string, any> = status === 'acknowledged'
      ? { status, acknowledgedAt: now, acknowledgedById: me, updatedAt: now }
      : { status, resolvedAt: now, resolvedById: me, updatedAt: now, ...(status === 'resolved' ? { resolution: body.resolution || null } : {}) }
    const [row] = await db.update(alerts).set(set)
      .where(and(eq(alerts.id, c.req.param('alertId')), eq(alerts.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Alert not found')
    return one(c, row)
  }

  // PUT /:alertId/acknowledge, /:alertId/resolve { resolution? }, /:alertId/dismiss
  app.put('/:alertId/acknowledge', requirePermission('care-compliance:update'), setStatus('acknowledged'))
  app.put('/:alertId/resolve', requirePermission('care-compliance:update'), setStatus('resolved'))
  app.put('/:alertId/dismiss', requirePermission('care-compliance:update'), setStatus('dismissed'))

  return app
}
