import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { repairOrder, contact, vehicle, salesLead, serviceSalesAlert, user } from '../../db/schema.ts'
import { eq, and, count, desc, isNull } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /repair-orders — RO list
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [eq(repairOrder.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(repairOrder.status, status))

  const where = and(...conditions)

  const data = await db.select({
    ro: repairOrder,
    customerName: contact.name,
    customerPhone: contact.phone,
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    vehicleVin: vehicle.vin,
  })
    .from(repairOrder)
    .leftJoin(contact, eq(repairOrder.customerId, contact.id))
    .leftJoin(vehicle, eq(repairOrder.vehicleId, vehicle.id))
    .where(where)
    .orderBy(desc(repairOrder.writeUpDate))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() }).from(repairOrder).where(where)

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// POST /repair-orders — create RO
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  // Auto-generate RO number
  const [{ value: roCount }] = await db.select({ value: count() }).from(repairOrder).where(eq(repairOrder.companyId, currentUser.companyId))
  const roNumber = body.roNumber || `RO-${String(Number(roCount) + 1).padStart(5, '0')}`

  const [created] = await db.insert(repairOrder).values({
    id: createId(),
    roNumber,
    customerId: body.customerId,
    vehicleId: body.vehicleId || null,
    customerVehicleInfo: body.customerVehicleInfo || null,
    status: body.status || 'open',
    services: body.services || [],
    advisorName: body.advisorName || null,
    technicianId: body.technicianId || null,
    estimatedTotal: body.estimatedTotal || null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit(currentUser, 'repair_order', created.id, 'created', null, created)
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'repair_order' })
  return c.json(created, 201)
})

// PUT /repair-orders/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(repairOrder).where(and(eq(repairOrder.id, id), eq(repairOrder.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Repair order not found' }, 404)

  const updates: any = { ...body, updatedAt: new Date() }
  if (body.status === 'closed' && !existing.completedAt) updates.completedAt = new Date()

  const [updated] = await db.update(repairOrder).set(updates).where(eq(repairOrder.id, id)).returning()
  await audit(currentUser, 'repair_order', id, 'updated', existing, updated)
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'repair_order' })
  return c.json(updated)
})

// POST /repair-orders/:id/check-in — THE SERVICE-TO-SALES BRIDGE
app.post('/:id/check-in', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // 1. Find the RO
  const [ro] = await db.select().from(repairOrder)
    .where(and(eq(repairOrder.id, id), eq(repairOrder.companyId, currentUser.companyId)))
    .limit(1)
  if (!ro) return c.json({ error: 'Repair order not found' }, 404)

  // 2. Mark RO as in_progress
  await db.update(repairOrder).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(repairOrder.id, id))

  // 3. Service-to-Sales Bridge: look up the customer's open sales leads
  let alertCreated = false
  let alertRecord: any = null

  if (ro.customerId) {
    // Find open sales leads for this customer assigned to a salesperson
    const openLeads = await db.select({
      lead: salesLead,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
    })
      .from(salesLead)
      .leftJoin(vehicle, eq(salesLead.vehicleId, vehicle.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        // Open stages only
        eq(salesLead.stage, 'new'),
      ))
      .limit(5)

    // Also check contacted/demo stages
    const activeLeads = await db.select({
      lead: salesLead,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
    })
      .from(salesLead)
      .leftJoin(vehicle, eq(salesLead.vehicleId, vehicle.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        eq(salesLead.stage, 'contacted'),
      ))
      .limit(5)

    const demoLeads = await db.select({
      lead: salesLead,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
    })
      .from(salesLead)
      .leftJoin(vehicle, eq(salesLead.vehicleId, vehicle.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        eq(salesLead.stage, 'demo'),
      ))
      .limit(5)

    const deskingLeads = await db.select({
      lead: salesLead,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
    })
      .from(salesLead)
      .leftJoin(vehicle, eq(salesLead.vehicleId, vehicle.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        eq(salesLead.stage, 'desking'),
      ))
      .limit(5)

    const allActiveLeads = [...openLeads, ...activeLeads, ...demoLeads, ...deskingLeads]

    // Get customer name
    const [customer] = await db.select().from(contact).where(eq(contact.id, ro.customerId)).limit(1)
    const customerName = customer?.name || 'Unknown customer'

    for (const leadRow of allActiveLeads) {
      if (!leadRow.lead.assignedTo) continue

      const vehicleDesc = [leadRow.vehicleYear, leadRow.vehicleMake, leadRow.vehicleModel].filter(Boolean).join(' ') || 'a vehicle'
      const message = `${customerName} just checked into service. Last interested in: ${vehicleDesc}. RO: ${ro.roNumber}`

      ;[alertRecord] = await db.insert(serviceSalesAlert).values({
        id: createId(),
        repairOrderId: ro.id,
        salesLeadId: leadRow.lead.id,
        salespersonId: leadRow.lead.assignedTo,
        customerId: ro.customerId,
        alertMessage: message,
        companyId: currentUser.companyId,
      }).returning()

      alertCreated = true

      // Real-time notification to the salesperson
      // TODO: Upgrade to WebSocket push or FCM for instant delivery
      // Currently: emit socket event that frontend polls/listens for
      emitToCompany(currentUser.companyId, EVENTS.REFRESH, {
        entity: 'service_sales_alert',
        targetUserId: leadRow.lead.assignedTo,
        alert: { id: alertRecord.id, message },
      })
    }
  }

  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'repair_order' })
  return c.json({
    success: true,
    roStatus: 'in_progress',
    alertTriggered: alertCreated,
    alert: alertRecord,
  })
})

export default app
