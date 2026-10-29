// The practice's appointment book: a time with a provider, in a room, for a patient. Moved from
// templates/crm-vet/backend/src/routes/appointments.ts. The registry signs the person in and applies the
// 'appointment_scheduling' gate (the template's sidebar gate; its index.ts mounted it ungated).
import { Hono } from 'hono'
import { eq, and, gte, lte, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { appointment, patient, contact, user } from '../../db/schema/index.ts'
import { lockAppointmentBook, appointmentsInRoom } from '../../data/vetAppointments.ts'
import { checkFilter, companyTimeZone, storeDayRange } from '@twomiah/tenant-backend'
import type { CrmDeps } from '../deps.ts'
import { APPOINTMENT_TILES, appointmentsTodayCondition } from './tileConditions.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'

// Documented value sets (see the schema's comments on appointment.type/status). Free text here silently corrupted
// calendar filters and status pills, so they are pinned down and anything off-list is a 400, not a 500.
const APPT_TYPES = ['wellness', 'sick', 'surgery', 'dental', 'recheck', 'grooming', 'euthanasia']
const APPT_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled']
const DEFAULT_APPT_MINUTES = 30

/** A client-supplied datetime, or null (not an Invalid Date) on junk. */
function parseWhen(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(v as string)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Thrown inside the booking transaction so a detected clash rolls back the write and is answered as a 409 after the
 * transaction unwinds. The template's reply also carried the clashing slot (`conflict: { id, startTime, endTime }`);
 * no screen read it, so the refusal is { error, code } (RULEBOOK §3).
 */
class ApptConflict extends Error { constructor(public sentence: string) { super('appointment conflict') } }

const overlaps = (r: any, start: Date, end: Date) => {
  const rStart = new Date(r.startTime)
  const rEnd = r.endTime ? new Date(r.endTime) : new Date(rStart.getTime() + DEFAULT_APPT_MINUTES * 60000)
  return start < rEnd && end > rStart
}

export function createVetAppointmentRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const app = new Hono<AppEnv>()

  /**
   * A provider can't be in two exam rooms at once: any non-cancelled appointment for the same provider whose
   * [start,end) overlaps the new one. Callers may override with body.allowConflict for an intentional double-book.
   */
  async function findProviderConflict(exec: any, companyId: string, providerId: string, start: Date, end: Date, ignoreId?: string) {
    const rows = await exec.select().from(appointment).where(and(
      eq(appointment.companyId, companyId), eq(appointment.providerId, providerId), ne(appointment.status, 'cancelled'),
    ))
    return rows.find((r: any) => (!ignoreId || r.id !== ignoreId) && overlaps(r, start, end)) || null
  }

  /**
   * An exam room can't hold two appointments at once either: same overlap rule, same non-cancelled filter. Two vets
   * were bookable into "Room 7" at 11:00 with no warning. (Vet T12 M5)
   */
  async function findRoomConflict(exec: any, companyId: string, room: string, start: Date, end: Date, ignoreId?: string) {
    if (!String(room || '').trim()) return null
    const rows = await appointmentsInRoom(exec, companyId, String(room))
    return rows.find((r: any) => (!ignoreId || r.id !== ignoreId) && overlaps(r, start, end)) || null
  }

  // GET /appointments — ?from=&to= on startTime, ?providerId=, ?status=. A list reply (the template: { data } alone).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const { from, to, providerId, status, tile } = c.req.query()
    // ?tile=today is the home screen's "Appointments today": the clinic's day, live rows only (./tileConditions.ts — the
    // dashboard's count calls the same condition). An unknown tile is refused, not answered as an empty book.
    const badTile = checkFilter(c, 'tile', tile, APPOINTMENT_TILES)
    if (badTile) return badTile

    const conditions = [eq(appointment.companyId, currentUser.companyId)]
    if (tile === 'today') { const day = storeDayRange(await companyTimeZone(db, currentUser.companyId)); conditions.push(appointmentsTodayCondition(appointment, day.start, day.end)) }
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
    return listAll(c, rows)
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    const start = parseWhen(body.startTime)
    if (!start) return fail(c, 400, 'A valid start time is required')
    const end = parseWhen(body.endTime)
    if (end && end <= start) return fail(c, 400, 'End time must be after the start time')

    const type = body.type || 'wellness'
    if (!APPT_TYPES.includes(type)) return fail(c, 400, `Invalid appointment type. Expected one of: ${APPT_TYPES.join(', ')}`)
    const status = body.status || 'scheduled'
    if (!APPT_STATUSES.includes(status)) return fail(c, 400, `Invalid status. Expected one of: ${APPT_STATUSES.join(', ')}`)

    const effEnd = end || new Date(start.getTime() + DEFAULT_APPT_MINUTES * 60000)
    let created: any
    try {
      created = await db.transaction(async (tx: any) => {
        await lockAppointmentBook(tx, currentUser.companyId)
        if (body.providerId && !body.allowConflict) {
          if (await findProviderConflict(tx, currentUser.companyId, body.providerId, start, effEnd)) throw new ApptConflict('This provider already has an appointment in that time slot.')
        }
        if (body.room && !body.allowConflict) {
          if (await findRoomConflict(tx, currentUser.companyId, body.room, start, effEnd)) throw new ApptConflict(`${String(body.room).trim()} is already booked for that time.`)
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
    } catch (e) {
      if (e instanceof ApptConflict) return fail(c, 409, e.sentence, 'appointment_conflict')
      throw e
    }

    await audit.log({ action: 'create', entity: 'appointment', entityId: created.id, metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(appointment)
      .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Appointment not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['patientId', 'ownerId', 'providerId', 'type', 'status', 'room', 'reason', 'startTime', 'endTime', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]

    if ('type' in updates && !APPT_TYPES.includes(updates.type)) return fail(c, 400, `Invalid appointment type. Expected one of: ${APPT_TYPES.join(', ')}`)
    if ('status' in updates && !APPT_STATUSES.includes(updates.status)) return fail(c, 400, `Invalid status. Expected one of: ${APPT_STATUSES.join(', ')}`)
    if ('startTime' in updates) {
      const s = parseWhen(updates.startTime)
      if (!s) return fail(c, 400, 'A valid start time is required')
      updates.startTime = s
    }
    if ('endTime' in updates && updates.endTime) {
      const e = parseWhen(updates.endTime)
      if (!e) return fail(c, 400, 'Invalid end time')
      updates.endTime = e
    }
    const effStart: Date = updates.startTime || new Date(existing.startTime)
    const effEnd: Date = (updates.endTime ?? existing.endTime)
      ? new Date(updates.endTime ?? existing.endTime)
      : new Date(effStart.getTime() + DEFAULT_APPT_MINUTES * 60000)
    if (effEnd <= effStart) return fail(c, 400, 'End time must be after the start time')

    const effProvider = 'providerId' in updates ? updates.providerId : existing.providerId
    const effStatus = 'status' in updates ? updates.status : existing.status
    const effRoom = 'room' in updates ? updates.room : existing.room
    let updated: any
    try {
      updated = await db.transaction(async (tx: any) => {
        await lockAppointmentBook(tx, currentUser.companyId)
        if (effProvider && effStatus !== 'cancelled' && !body.allowConflict) {
          if (await findProviderConflict(tx, currentUser.companyId, effProvider, effStart, effEnd, id)) throw new ApptConflict('This provider already has an appointment in that time slot.')
        }
        if (effRoom && effStatus !== 'cancelled' && !body.allowConflict) {
          if (await findRoomConflict(tx, currentUser.companyId, effRoom, effStart, effEnd, id)) throw new ApptConflict(`${String(effRoom).trim()} is already booked for that time.`)
        }
        const [row] = await tx.update(appointment).set(updates).where(eq(appointment.id, id)).returning()
        return row
      })
    } catch (e) {
      if (e instanceof ApptConflict) return fail(c, 409, e.sentence, 'appointment_conflict')
      throw e
    }
    await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, updated)
  })

  app.post('/:id/check-in', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [existing] = await db.select().from(appointment)
      .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Appointment not found')

    const [updated] = await db.update(appointment)
      .set({ status: 'checked_in', checkedInAt: new Date(), updatedAt: new Date() })
      .where(eq(appointment.id, id))
      .returning()

    await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, updated)
  })

  // DELETE /appointments/:id — "Cancel" from the calendar. A soft cancel (status 'cancelled'), never a hard delete:
  // the visit stays on the patient's history and in reporting, and the provider's slot frees up. An already-cancelled
  // row is left as it is.
  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [existing] = await db.select().from(appointment)
      .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Appointment not found')
    if (existing.status === 'cancelled') return one(c, existing)

    const [updated] = await db.update(appointment)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(appointment.id, id))
      .returning()
    await audit.log({ action: 'cancel', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, updated)
  })

  return app
}
