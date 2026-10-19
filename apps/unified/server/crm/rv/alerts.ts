// Service-to-sales alerts: a salesperson's customer checked into service (repairOrders.ts check-in). Each person sees
// their own. Moved from templates/crm-rv/backend/src/routes/alerts.ts.
import { Hono } from 'hono'
import { eq, and, isNull, desc, count } from 'drizzle-orm'
import { serviceSalesAlert, contact, repairOrder, salesLead, unit } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export function createAlertRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET / — this salesperson's unread alerts (?all=true: dismissed too), with the unread count
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
    const showAll = c.req.query('all') === 'true'
    const page = +(c.req.query('page') || '1')
    const limit = +(c.req.query('limit') || '25')
    const conditions = [eq(serviceSalesAlert.companyId, currentUser.companyId), eq(serviceSalesAlert.salespersonId, currentUser.userId)]
    if (!showAll) conditions.push(isNull(serviceSalesAlert.dismissedAt))
    const where = and(...conditions)
    const data = await db.select({
      alert: serviceSalesAlert,
      customerName: contact.name, customerPhone: contact.phone, customerEmail: contact.email,
      roNumber: repairOrder.roNumber, roStatus: repairOrder.status,
      unitYear: unit.year, unitMake: unit.make, unitModel: unit.modelName,
    })
      .from(serviceSalesAlert)
      .leftJoin(contact, eq(serviceSalesAlert.customerId, contact.id))
      .leftJoin(repairOrder, eq(serviceSalesAlert.repairOrderId, repairOrder.id))
      .leftJoin(salesLead, eq(serviceSalesAlert.salesLeadId, salesLead.id))
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(where)
      .orderBy(desc(serviceSalesAlert.alertedAt))
      .offset((page - 1) * limit)
      .limit(limit)
    const [{ value: total }] = await db.select({ value: count() }).from(serviceSalesAlert).where(where)
    const [{ value: unreadCount }] = await db.select({ value: count() }).from(serviceSalesAlert).where(and(
      eq(serviceSalesAlert.companyId, currentUser.companyId), eq(serviceSalesAlert.salespersonId, currentUser.userId), isNull(serviceSalesAlert.dismissedAt),
    ))
    // A page of alerts and the unread count beside it (the list shape plus one figure the badge reads).
    return one(c, { data, unreadCount: Number(unreadCount), pagination: { page, limit, total: Number(total), pages: limit > 0 ? Math.ceil(Number(total) / limit) : 0 } })
  })

  // GET /count — the badge
  app.get('/count', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
    const [{ value }] = await db.select({ value: count() }).from(serviceSalesAlert).where(and(
      eq(serviceSalesAlert.companyId, currentUser.companyId), eq(serviceSalesAlert.salespersonId, currentUser.userId), isNull(serviceSalesAlert.dismissedAt),
    ))
    return one(c, { count: Number(value) })
  })

  app.post('/:id/dismiss', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user')
    const id = c.req.param('id')
    const [existing] = await db.select().from(serviceSalesAlert)
      .where(and(eq(serviceSalesAlert.id, id), eq(serviceSalesAlert.salespersonId, currentUser.userId))).limit(1)
    if (!existing) return fail(c, 404, 'Alert not found')
    const [updated] = await db.update(serviceSalesAlert).set({ dismissedAt: new Date() }).where(eq(serviceSalesAlert.id, id)).returning()
    return one(c, updated)
  })

  // POST /:id/convert — mark the alert converted (the screen then opens a new lead)
  app.post('/:id/convert', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user')
    const id = c.req.param('id')
    const [alert] = await db.select().from(serviceSalesAlert)
      .where(and(eq(serviceSalesAlert.id, id), eq(serviceSalesAlert.companyId, currentUser.companyId))).limit(1)
    if (!alert) return fail(c, 404, 'Alert not found')
    await db.update(serviceSalesAlert).set({ convertedToLead: true, dismissedAt: new Date() }).where(eq(serviceSalesAlert.id, id))
    return done(c)
  })

  return app
}
