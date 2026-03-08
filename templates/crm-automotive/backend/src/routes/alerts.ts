import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceSalesAlert, contact, repairOrder, salesLead, vehicle } from '../../db/schema.ts'
import { eq, and, isNull, desc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /alerts — salesperson's unread alerts
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const showAll = c.req.query('all') === 'true'
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [
    eq(serviceSalesAlert.companyId, currentUser.companyId),
    eq(serviceSalesAlert.salespersonId, currentUser.id),
  ]
  if (!showAll) {
    conditions.push(isNull(serviceSalesAlert.dismissedAt))
  }

  const where = and(...conditions)

  const data = await db.select({
    alert: serviceSalesAlert,
    customerName: contact.name,
    customerPhone: contact.phone,
    customerEmail: contact.email,
    roNumber: repairOrder.roNumber,
    roStatus: repairOrder.status,
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
  })
    .from(serviceSalesAlert)
    .leftJoin(contact, eq(serviceSalesAlert.customerId, contact.id))
    .leftJoin(repairOrder, eq(serviceSalesAlert.repairOrderId, repairOrder.id))
    .leftJoin(salesLead, eq(serviceSalesAlert.salesLeadId, salesLead.id))
    .leftJoin(vehicle, eq(salesLead.vehicleId, vehicle.id))
    .where(where)
    .orderBy(desc(serviceSalesAlert.alertedAt))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() }).from(serviceSalesAlert).where(where)
  const [{ value: unreadCount }] = await db.select({ value: count() }).from(serviceSalesAlert).where(and(
    eq(serviceSalesAlert.companyId, currentUser.companyId),
    eq(serviceSalesAlert.salespersonId, currentUser.id),
    isNull(serviceSalesAlert.dismissedAt),
  ))

  return c.json({
    data,
    unreadCount: Number(unreadCount),
    pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
  })
})

// GET /alerts/count — quick badge count
app.get('/count', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const [{ value }] = await db.select({ value: count() }).from(serviceSalesAlert).where(and(
    eq(serviceSalesAlert.companyId, currentUser.companyId),
    eq(serviceSalesAlert.salespersonId, currentUser.id),
    isNull(serviceSalesAlert.dismissedAt),
  ))
  return c.json({ count: Number(value) })
})

// POST /alerts/:id/dismiss
app.post('/:id/dismiss', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(serviceSalesAlert)
    .where(and(eq(serviceSalesAlert.id, id), eq(serviceSalesAlert.salespersonId, currentUser.id)))
    .limit(1)
  if (!existing) return c.json({ error: 'Alert not found' }, 404)

  const [updated] = await db.update(serviceSalesAlert)
    .set({ dismissedAt: new Date() })
    .where(eq(serviceSalesAlert.id, id))
    .returning()

  return c.json(updated)
})

// POST /alerts/:id/convert — create a new sales lead from alert
app.post('/:id/convert', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [alert] = await db.select().from(serviceSalesAlert)
    .where(and(eq(serviceSalesAlert.id, id), eq(serviceSalesAlert.companyId, currentUser.companyId)))
    .limit(1)
  if (!alert) return c.json({ error: 'Alert not found' }, 404)

  // Mark alert as converted
  await db.update(serviceSalesAlert).set({ convertedToLead: true, dismissedAt: new Date() }).where(eq(serviceSalesAlert.id, id))

  return c.json({ success: true })
})

export default app
