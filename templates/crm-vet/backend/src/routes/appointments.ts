import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { appointment, patient, contact, user } from '../../db/schema.ts'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /appointments — ?from=&to= on startTime, ?providerId=, ?status=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const from = c.req.query('from')
  const to = c.req.query('to')
  const providerId = c.req.query('providerId')
  const status = c.req.query('status')

  const conditions = [eq(appointment.companyId, currentUser.companyId)]
  if (from) conditions.push(gte(appointment.startTime, new Date(from)))
  if (to) conditions.push(lte(appointment.startTime, new Date(to)))
  if (providerId) conditions.push(eq(appointment.providerId, providerId))
  if (status) conditions.push(eq(appointment.status, status))

  const data = await db.select({
    appointment,
    patientName: patient.name,
    ownerName: contact.name,
    ownerPhone: contact.phone,
    providerFirstName: user.firstName,
    providerLastName: user.lastName,
  })
    .from(appointment)
    .leftJoin(patient, eq(appointment.patientId, patient.id))
    .leftJoin(contact, eq(appointment.ownerId, contact.id))
    .leftJoin(user, eq(appointment.providerId, user.id))
    .where(and(...conditions))
    .orderBy(appointment.startTime)

  const rows = data.map((r: any) => ({ ...r.appointment, patientName: r.patientName, ownerName: r.ownerName, ownerPhone: r.ownerPhone, providerFirstName: r.providerFirstName, providerLastName: r.providerLastName }))
  return c.json({ data: rows })
})

// POST /appointments
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(appointment).values({
    id: createId(),
    patientId: body.patientId || null,
    ownerId: body.ownerId || null,
    providerId: body.providerId || null,
    type: body.type || 'wellness',
    status: body.status || 'scheduled',
    room: body.room || null,
    reason: body.reason || null,
    startTime: new Date(body.startTime),
    endTime: body.endTime ? new Date(body.endTime) : null,
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
  const body = await c.req.json()

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'ownerId', 'providerId', 'type', 'status', 'room', 'reason', 'startTime', 'endTime', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('startTime' in updates && updates.startTime) updates.startTime = new Date(updates.startTime)
  if ('endTime' in updates && updates.endTime) updates.endTime = new Date(updates.endTime)

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

export default app
