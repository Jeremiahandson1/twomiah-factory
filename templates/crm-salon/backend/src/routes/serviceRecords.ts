import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, user, appointment } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * The formula log — what was actually done in the chair. This is the salon's
 * clinical record: it makes a colour repeatable by any stylist in the shop, and
 * its performedAt + the service's rebookIntervalDays are what the reminder
 * engine reads to decide who is due back.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /service-records — ?contactId=, ?stylistId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.query('contactId')
  const stylistId = c.req.query('stylistId')

  const conditions = [eq(serviceRecord.companyId, currentUser.companyId)]
  if (contactId) conditions.push(eq(serviceRecord.contactId, contactId))
  if (stylistId) conditions.push(eq(serviceRecord.stylistId, stylistId))

  const data = await db.select({
    record: serviceRecord,
    clientName: contact.name,
    serviceName: serviceMenu.name,
    stylistFirstName: user.firstName,
    stylistLastName: user.lastName,
  })
    .from(serviceRecord)
    .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
    .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .where(and(...conditions))
    .orderBy(desc(serviceRecord.performedAt))
    .limit(200)

  const rows = data.map((r: any) => ({
    ...r.record,
    clientName: r.clientName, serviceName: r.serviceName,
    stylistFirstName: r.stylistFirstName, stylistLastName: r.stylistLastName,
  }))
  return c.json({ data: rows })
})

// GET /service-records/:id
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [row] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId)))
    .limit(1)
  if (!row) return c.json({ error: 'Service record not found' }, 404)

  return c.json(row)
})

// POST /service-records — writing a record completes its appointment, so the
// front desk never has to close the ticket twice.
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.contactId !== 'string' || !body.contactId) {
    return c.json({ error: 'contactId is required' }, 400)
  }

  const [ct] = await db.select().from(contact)
    .where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!ct) return c.json({ error: 'Client not found' }, 404)

  const [created] = await db.insert(serviceRecord).values({
    id: createId(),
    contactId: body.contactId,
    appointmentId: body.appointmentId || null,
    stylistId: body.stylistId || null,
    serviceId: body.serviceId || null,
    performedAt: body.performedAt ? new Date(body.performedAt) : new Date(),
    formula: Array.isArray(body.formula) ? body.formula : [],
    developerVolume: body.developerVolume || null,
    processingMin: body.processingMin ?? null,
    productsUsed: body.productsUsed || null,
    result: body.result || null,
    photoBefore: body.photoBefore || null,
    photoAfter: body.photoAfter || null,
    priceCharged: body.priceCharged ?? null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  if (created.appointmentId) {
    await db.update(appointment)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(appointment.id, created.appointmentId), eq(appointment.companyId, currentUser.companyId)))
  }

  await audit.log({ action: 'create', entity: 'service_record', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  return c.json(created, 201)
})

// PUT /service-records/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Service record not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['appointmentId', 'stylistId', 'serviceId', 'performedAt', 'formula', 'developerVolume', 'processingMin', 'productsUsed', 'result', 'photoBefore', 'photoAfter', 'priceCharged', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if (updates.performedAt) updates.performedAt = new Date(updates.performedAt)

  const [updated] = await db.update(serviceRecord).set(updates).where(eq(serviceRecord.id, id)).returning()
  await audit.log({ action: 'update', entity: 'service_record', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  return c.json(updated)
})

// DELETE /service-records/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Service record not found' }, 404)

  await db.delete(serviceRecord).where(eq(serviceRecord.id, id))
  await audit.log({ action: 'delete', entity: 'service_record', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  return c.json({ success: true })
})

export default app
