import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { appointment, patient, contact, user } from '../../db/schema.ts'
import { eq, and, gte, lte, ne, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// Documented value sets (see schema.ts comments on appointment.type/status).
// Free-text here silently corrupted calendar filters and status pills, so we
// pin them down and reject anything off-list with a 400 instead of a 500.
const APPT_TYPES = ['wellness', 'sick', 'surgery', 'dental', 'recheck', 'grooming', 'euthanasia']
const APPT_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled']
const DEFAULT_APPT_MINUTES = 30

// Parse a client-supplied datetime, returning null (not an Invalid Date) on junk.
function parseWhen(v: any): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// A provider can't be in two exam rooms at once. Look for any non-cancelled
// appointment for the same provider whose [start,end) overlaps the new one.
// Returns the first clashing row, or null. Callers may override with
// body.allowConflict for the rare intentional double-book.
// Thrown inside the booking transaction so a detected clash rolls back the write and is answered as a
// 409 after the transaction unwinds. One advisory lock per business serialises the whole check-then-write
// so two staff saving the same provider slot at once can't both pass the overlap scan. (vet double-book race)
class ApptConflict extends Error { constructor(public payload: any) { super('appointment conflict') } }
const apptLock = (tx: any, companyId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':appt'}))`)

async function findProviderConflict(
  companyId: string,
  providerId: string,
  start: Date,
  end: Date,
  ignoreId?: string,
  exec: any = db
) {
  const rows = await exec.select().from(appointment).where(and(
    eq(appointment.companyId, companyId),
    eq(appointment.providerId, providerId),
    ne(appointment.status, 'cancelled'),
  ))
  for (const r of rows) {
    if (ignoreId && r.id === ignoreId) continue
    const rStart = new Date(r.startTime)
    const rEnd = r.endTime ? new Date(r.endTime) : new Date(rStart.getTime() + DEFAULT_APPT_MINUTES * 60000)
    if (start < rEnd && end > rStart) return r
  }
  return null
}

/**
 * An exam room can't hold two appointments at once either. The provider check has always been here; a room was
 * never checked, so two vets could be booked into "Room 7" at 11:00 and the schedule simply stacked them with no
 * warning. Same overlap rule, same non-cancelled filter. (Vet T12 M5)
 */
async function findRoomConflict(
  companyId: string,
  room: string,
  start: Date,
  end: Date,
  ignoreId?: string,
  exec: any = db
) {
  const trimmed = String(room || '').trim()
  if (!trimmed) return null
  const rows = await exec.select().from(appointment).where(and(
    eq(appointment.companyId, companyId),
    sql`lower(trim(${appointment.room})) = ${trimmed.toLowerCase()}`,
    ne(appointment.status, 'cancelled'),
  ))
  for (const r of rows) {
    if (ignoreId && r.id === ignoreId) continue
    const rStart = new Date(r.startTime)
    const rEnd = r.endTime ? new Date(r.endTime) : new Date(rStart.getTime() + DEFAULT_APPT_MINUTES * 60000)
    if (start < rEnd && end > rStart) return r
  }
  return null
}

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

  const start = parseWhen(body.startTime)
  if (!start) return c.json({ error: 'A valid start time is required' }, 400)
  const end = parseWhen(body.endTime)
  if (end && end <= start) return c.json({ error: 'End time must be after the start time' }, 400)

  const type = body.type || 'wellness'
  if (!APPT_TYPES.includes(type)) return c.json({ error: `Invalid appointment type. Expected one of: ${APPT_TYPES.join(', ')}` }, 400)
  const status = body.status || 'scheduled'
  if (!APPT_STATUSES.includes(status)) return c.json({ error: `Invalid status. Expected one of: ${APPT_STATUSES.join(', ')}` }, 400)

  const effEnd = end || new Date(start.getTime() + DEFAULT_APPT_MINUTES * 60000)
  let created
  try {
    created = await db.transaction(async (tx: any) => {
      await apptLock(tx, currentUser.companyId)
      if (body.providerId && !body.allowConflict) {
        const clash = await findProviderConflict(currentUser.companyId, body.providerId, start, effEnd, undefined, tx)
        if (clash) throw new ApptConflict({
          error: 'This provider already has an appointment in that time slot.',
          conflict: { id: clash.id, startTime: clash.startTime, endTime: clash.endTime },
        })
      }
      if (body.room && !body.allowConflict) {
        const clash = await findRoomConflict(currentUser.companyId, body.room, start, effEnd, undefined, tx)
        if (clash) throw new ApptConflict({
          error: `${String(body.room).trim()} is already booked for that time.`,
          conflict: { id: clash.id, startTime: clash.startTime, endTime: clash.endTime },
        })
      }
      const [row] = await tx.insert(appointment).values({
        id: createId(),
        patientId: body.patientId || null,
        ownerId: body.ownerId || null,
        providerId: body.providerId || null,
        type,
        status,
        room: body.room || null,
        reason: body.reason || null,
        startTime: start,
        endTime: end,
        notes: body.notes || null,
        companyId: currentUser.companyId,
      }).returning()
      return row
    })
  } catch (e: any) {
    if (e instanceof ApptConflict) return c.json(e.payload, 409)
    throw e
  }

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

  if ('type' in updates && !APPT_TYPES.includes(updates.type)) {
    return c.json({ error: `Invalid appointment type. Expected one of: ${APPT_TYPES.join(', ')}` }, 400)
  }
  if ('status' in updates && !APPT_STATUSES.includes(updates.status)) {
    return c.json({ error: `Invalid status. Expected one of: ${APPT_STATUSES.join(', ')}` }, 400)
  }
  if ('startTime' in updates) {
    const s = parseWhen(updates.startTime)
    if (!s) return c.json({ error: 'A valid start time is required' }, 400)
    updates.startTime = s
  }
  if ('endTime' in updates && updates.endTime) {
    const e = parseWhen(updates.endTime)
    if (!e) return c.json({ error: 'Invalid end time' }, 400)
    updates.endTime = e
  }
  const effStart: Date = updates.startTime || new Date(existing.startTime)
  const effEnd: Date = (updates.endTime ?? existing.endTime)
    ? new Date(updates.endTime ?? (existing.endTime as any))
    : new Date(effStart.getTime() + DEFAULT_APPT_MINUTES * 60000)
  if (effEnd <= effStart) return c.json({ error: 'End time must be after the start time' }, 400)

  const effProvider = 'providerId' in updates ? updates.providerId : existing.providerId
  const effStatus = 'status' in updates ? updates.status : existing.status
  const effRoom = 'room' in updates ? updates.room : existing.room
  let updated
  try {
    updated = await db.transaction(async (tx: any) => {
      await apptLock(tx, currentUser.companyId)
      if (effProvider && effStatus !== 'cancelled' && !body.allowConflict) {
        const clash = await findProviderConflict(currentUser.companyId, effProvider, effStart, effEnd, id, tx)
        if (clash) throw new ApptConflict({
          error: 'This provider already has an appointment in that time slot.',
          conflict: { id: clash.id, startTime: clash.startTime, endTime: clash.endTime },
        })
      }
      if (effRoom && effStatus !== 'cancelled' && !body.allowConflict) {
        const clash = await findRoomConflict(currentUser.companyId, effRoom, effStart, effEnd, id, tx)
        if (clash) throw new ApptConflict({
          error: `${String(effRoom).trim()} is already booked for that time.`,
          conflict: { id: clash.id, startTime: clash.startTime, endTime: clash.endTime },
        })
      }
      const [row] = await tx.update(appointment).set(updates).where(eq(appointment.id, id)).returning()
      return row
    })
  } catch (e: any) {
    if (e instanceof ApptConflict) return c.json(e.payload, 409)
    throw e
  }
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

// DELETE /appointments/:id — "Cancel" from the calendar. Soft-cancel (status='cancelled'), never a
// hard delete: the visit stays on the patient's history and in reporting, and the provider's slot frees
// up. An already-cancelled row is left as-is (idempotent). (vet cancel kept history — #112 missed vet)
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)
  if (existing.status === 'cancelled') return c.json(existing)

  const [updated] = await db.update(appointment)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(appointment.id, id))
    .returning()
  await audit.log({ action: 'cancel', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json(updated)
})

export default app
