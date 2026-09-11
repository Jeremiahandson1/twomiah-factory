import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, user, appointment } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { ensureInvoiceForVisit } from '../services/salonCheckout.ts'
import { scheduleReviewRequestForVisit } from '../services/reviews.ts'

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

  if (body.processingMin != null && body.processingMin !== '' && (isNaN(Number(body.processingMin)) || Number(body.processingMin) < 0 || Number(body.processingMin) > 600)) {
    return c.json({ error: 'Processing time must be between 0 and 600 minutes.' }, 400)
  }
  const hasFormula = Array.isArray(body.formula) && body.formula.some((l: any) => (l?.product || l?.shade || '').toString().trim())
  if (!body.serviceId && !hasFormula && !body.result && !body.productsUsed && (body.priceCharged == null || body.priceCharged === '') && !body.notes) {
    return c.json({ error: 'Add a service, a formula, a result or a price — an empty record tells the next stylist nothing.' }, 400)
  }
  // A negative price charged dragged the client's lifetime value negative. (CC-18)
  if (body.priceCharged != null && (isNaN(Number(body.priceCharged)) || Number(body.priceCharged) < 0)) {
    return c.json({ error: 'Price charged cannot be negative.' }, 400)
  }

  // SALON-H4: reuse the record that Complete auto-created for this appointment rather than logging a second visit.
  if (body.appointmentId) {
    const [auto] = await db.select().from(serviceRecord).where(and(eq(serviceRecord.appointmentId, body.appointmentId), eq(serviceRecord.companyId, currentUser.companyId))).limit(1)
    if (auto) {
      const upd: any = { updatedAt: new Date() }
      for (const k of ['stylistId', 'serviceId', 'developerVolume', 'processingMin', 'productsUsed', 'result', 'photoBefore', 'photoAfter', 'priceCharged', 'notes']) if (k in body) upd[k] = body[k] === '' ? null : body[k]
      if (Array.isArray(body.formula)) upd.formula = body.formula
      if (body.performedAt) upd.performedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.performedAt)) ? new Date(`${body.performedAt}T12:00:00.000Z`) : new Date(body.performedAt)
      const [merged] = await db.update(serviceRecord).set(upd).where(eq(serviceRecord.id, auto.id)).returning()
      emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
      return c.json({ ...merged, invoiceId: null, merged: true }, 200)
    }
  }
  const [created] = await db.insert(serviceRecord).values({
    id: createId(),
    contactId: body.contactId,
    appointmentId: body.appointmentId || null,
    stylistId: body.stylistId || null,
    serviceId: body.serviceId || null,
    // A date-only value ("2026-09-11") is a calendar date: store it at noon UTC so it renders as that
    // date in any US timezone instead of UTC midnight rolling back a day. (SALON-H9)
    performedAt: body.performedAt ? (/^\d{4}-\d{2}-\d{2}$/.test(String(body.performedAt)) ? new Date(`${body.performedAt}T12:00:00.000Z`) : new Date(body.performedAt)) : new Date(),
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

  // Logging the service closes the visit: create the sale (once per appointment) and queue the
  // review request. Neither may fail the record write. (SALON-H4 / H2)
  let invoiceId: string | null = null
  try {
    let serviceName: string | null = null
    if (created.serviceId) {
      const [svc] = await db.select({ name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, created.serviceId)).limit(1)
      serviceName = svc?.name || null
    }
    const inv = await ensureInvoiceForVisit({ companyId: currentUser.companyId, contactId: created.contactId, appointmentId: created.appointmentId, serviceName, price: Number(created.priceCharged) })
    invoiceId = inv?.id || null
  } catch (e: any) { console.warn('[service-records] sale not created:', e?.message || e) }
  scheduleReviewRequestForVisit({ companyId: currentUser.companyId, contactId: created.contactId }).catch((e) => console.warn('[service-records] review schedule failed:', e?.message || e))

  await audit.log({ action: 'create', entity: 'service_record', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  return c.json({ ...created, invoiceId }, 201)
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
