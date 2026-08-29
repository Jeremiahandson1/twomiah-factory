import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { appointment, serviceMenu, contact, user } from '../../db/schema.ts'
import { eq, and, gte, lte, ne } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * The book. A salon books a CHAIR for a duration, so endTime is derived from
 * the service's durationMin when the caller doesn't supply one, and a stylist
 * double-book is rejected rather than silently accepted.
 */

const app = new Hono()
app.use('*', authenticate)

const CANCELLED = ['cancelled', 'no_show']

// Resolve endTime: explicit > service duration > 60 min.
async function resolveEnd(companyId: string, startTime: Date, serviceId: string | null, explicitEnd: string | null): Promise<Date> {
  if (explicitEnd) return new Date(explicitEnd)
  let minutes = 60
  if (serviceId) {
    const [svc] = await db.select().from(serviceMenu)
      .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId)))
      .limit(1)
    if (svc?.durationMin) minutes = svc.durationMin
  }
  return new Date(startTime.getTime() + minutes * 60000)
}

// A stylist can only be in one chair at a time. Overlap is start < otherEnd &&
// end > otherStart; cancelled/no-show rows free the slot back up.
async function findConflict(companyId: string, stylistId: string, start: Date, end: Date, ignoreId?: string) {
  // Bound the scan to the surrounding day — a candidate overlap must start
  // before our end, and no salon service runs longer than 24h.
  const rows = await db.select().from(appointment)
    .where(and(
      eq(appointment.companyId, companyId),
      eq(appointment.stylistId, stylistId),
      lte(appointment.startTime, end),
      gte(appointment.startTime, new Date(start.getTime() - 86400000)),
      ...(ignoreId ? [ne(appointment.id, ignoreId)] : []),
    ))
  return rows.find(r => {
    if (CANCELLED.includes(r.status)) return false
    const rs = new Date(r.startTime).getTime()
    const re = r.endTime ? new Date(r.endTime).getTime() : rs + 3600000
    return start.getTime() < re && end.getTime() > rs
  })
}

// GET /appointments — ?from=&to= on startTime, ?stylistId=, ?status=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const from = c.req.query('from')
  const to = c.req.query('to')
  const stylistId = c.req.query('stylistId')
  const status = c.req.query('status')

  const conditions = [eq(appointment.companyId, currentUser.companyId)]
  if (from) conditions.push(gte(appointment.startTime, new Date(from)))
  if (to) conditions.push(lte(appointment.startTime, new Date(to)))
  if (stylistId) conditions.push(eq(appointment.stylistId, stylistId))
  if (status) conditions.push(eq(appointment.status, status))

  const data = await db.select({
    appointment,
    clientName: contact.name,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
    serviceName: serviceMenu.name,
    serviceDurationMin: serviceMenu.durationMin,
    stylistFirstName: user.firstName,
    stylistLastName: user.lastName,
  })
    .from(appointment)
    .leftJoin(contact, eq(appointment.contactId, contact.id))
    .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
    .leftJoin(user, eq(appointment.stylistId, user.id))
    .where(and(...conditions))
    .orderBy(appointment.startTime)

  const rows = data.map((r: any) => ({
    ...r.appointment,
    clientName: r.clientName, clientPhone: r.clientPhone, clientMobile: r.clientMobile,
    serviceName: r.serviceName, serviceDurationMin: r.serviceDurationMin,
    stylistFirstName: r.stylistFirstName, stylistLastName: r.stylistLastName,
  }))
  return c.json({ data: rows })
})

// POST /appointments
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (!body.startTime) return c.json({ error: 'startTime is required' }, 400)

  const startTime = new Date(body.startTime)
  if (Number.isNaN(startTime.getTime())) return c.json({ error: 'startTime is not a valid date' }, 400)
  const serviceId = body.serviceId || null
  const endTime = await resolveEnd(currentUser.companyId, startTime, serviceId, body.endTime || null)
  // A manually-set end before the start was saved verbatim ("9:00 AM – 8:00 AM"). (SCHED-01)
  if (endTime.getTime() <= startTime.getTime()) return c.json({ error: 'The end time must be after the start time.' }, 400)

  if (body.stylistId) {
    const clash = await findConflict(currentUser.companyId, body.stylistId, startTime, endTime)
    if (clash) return c.json({ error: 'That stylist is already booked at this time', conflictId: clash.id }, 409)
  }

  const [created] = await db.insert(appointment).values({
    id: createId(),
    contactId: body.contactId || null,
    stylistId: body.stylistId || null,
    serviceId,
    status: body.status || 'scheduled',
    station: body.station || null,
    startTime,
    endTime,
    quotedPrice: body.quotedPrice ?? null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'appointment', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json(created, 201)
})

// PUT /appointments/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['contactId', 'stylistId', 'serviceId', 'status', 'station', 'startTime', 'endTime', 'quotedPrice', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if (updates.startTime) {
    updates.startTime = new Date(updates.startTime)
    if (Number.isNaN(updates.startTime.getTime())) return c.json({ error: 'startTime is not a valid date' }, 400)
  }
  if (updates.endTime) updates.endTime = new Date(updates.endTime)

  // A drag-and-drop reschedule moves startTime without touching endTime, so
  // re-derive the end whenever the start or the service changed.
  const nextStart: Date = updates.startTime ?? new Date(existing.startTime)
  const nextService = 'serviceId' in updates ? updates.serviceId : existing.serviceId
  if (('startTime' in updates || 'serviceId' in updates) && !('endTime' in updates)) {
    updates.endTime = await resolveEnd(currentUser.companyId, nextStart, nextService, null)
  }
  const nextEnd: Date = updates.endTime ?? (existing.endTime ? new Date(existing.endTime) : new Date(nextStart.getTime() + 3600000))
  const nextStylist = 'stylistId' in updates ? updates.stylistId : existing.stylistId
  const nextStatus = 'status' in updates ? updates.status : existing.status
  // Re-validate the effective pair — editing the end (or dragging the start) must not
  // produce an end at/before the start. (SCHED-01)
  if (nextEnd.getTime() <= nextStart.getTime()) return c.json({ error: 'The end time must be after the start time.' }, 400)

  if (nextStylist && !CANCELLED.includes(nextStatus)) {
    const clash = await findConflict(currentUser.companyId, nextStylist, nextStart, nextEnd, id)
    if (clash) return c.json({ error: 'That stylist is already booked at this time', conflictId: clash.id }, 409)
  }

  const [updated] = await db.update(appointment).set(updates).where(eq(appointment.id, id)).returning()
  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json(updated)
})

// POST /appointments/:id/check-in
app.post('/:id/check-in', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)

  const [updated] = await db.update(appointment)
    .set({ status: 'checked_in', checkedInAt: new Date(), updatedAt: new Date() })
    .where(eq(appointment.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json(updated)
})

// DELETE /appointments/:id — cancel, keeping the row so no-show/cancel rates
// stay measurable.
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)

  const [updated] = await db.update(appointment)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(appointment.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json({ success: true, appointment: updated })
})

export default app
