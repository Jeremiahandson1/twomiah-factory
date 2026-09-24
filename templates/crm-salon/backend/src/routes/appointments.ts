import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { appointment, serviceMenu, contact, user, serviceRecord, teamMember } from '../../db/schema.ts'
import { eq, and, gte, lte, ne, sql, or } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { ensureInvoiceForVisit } from '../services/salonCheckout.ts'
import { scheduleReviewRequestForVisit } from '../services/reviews.ts'
import { resolveStylist, unknownStylist, stylistIdOf, type StylistRef } from '../utils/stylist.ts'
import { isRealCalendarDay } from '../shared/index.ts'
import { salonTimezone, calendarDateIn } from '../utils/salonDate.ts'

/**
 * The book. A salon books a CHAIR for a duration, so endTime is derived from
 * the service's durationMin when the caller doesn't supply one, and a stylist
 * double-book is rejected rather than silently accepted.
 */

const app = new Hono()
app.use('*', authenticate)

const CANCELLED = ['cancelled', 'no_show']
const APPT_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_chair', 'completed', 'no_show', 'cancelled']
const MAX_APPT_MS = 12 * 3600_000 // no salon service runs longer than a working day (SALON-M3)

// An online booking mirrors its appointment's status so the Bookings list never says "confirmed"
// for a cancelled visit. (SALON-N10)
async function syncOnlineBooking(appointmentId: string, status: string) {
  const mapped = status === 'cancelled' ? 'cancelled' : status === 'no_show' ? 'no_show' : status === 'completed' ? 'completed' : 'confirmed'
  try { await db.execute(sql`UPDATE online_booking SET status = ${mapped}, updated_at = NOW() WHERE appointment_id = ${appointmentId}`) } catch { /* no booking row */ }
}

// Resolve endTime: explicit > service duration > 60 min.
/**
 * The service, if it is on THIS salon's menu. An unknown id used to reach the insert and come back as the
 * generic foreign-key message ("A related record does not exist, or is still in use.", 409) — which names
 * no field, suggests a conflict where there is none, and offers the opposite problem as a possibility.
 * A service from another tenant is as absent as one that was never created. (Salon T27 N17)
 */
async function ownService(companyId: string, serviceId: string) {
  const [svc] = await db.select({ id: serviceMenu.id }).from(serviceMenu)
    .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
  return svc || null
}

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

// Thrown inside the booking transaction so a detected clash rolls back the insert/update and is
// answered as a 409 (with conflictId) after the transaction unwinds. (SALON double-book race)
class ApptConflict extends Error { constructor(public payload: any) { super('appointment conflict') } }
// One mutex per business for the whole check-then-write: two staff saving the same chair/stylist slot
// at the same instant are serialised, so the overlap scan an insert relies on can't be raced. Held only
// for the few ms of the check + write, released at commit.
const apptLock = (tx: any, companyId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':appt'}))`)

// A stylist can only be in one chair at a time. Overlap is start < otherEnd &&
// end > otherStart; cancelled/no-show rows free the slot back up.
async function findConflict(companyId: string, stylist: StylistRef, start: Date, end: Date, ignoreId?: string, exec: any = db) {
  // Match on whichever column holds this stylist — a roster stylist can be double-booked exactly as
  // easily as a login one, and the check has to follow them into their own column. (T20 H1)
  const heldBy = stylist.stylistId
    ? eq(appointment.stylistId, stylist.stylistId)
    : eq(appointment.stylistMemberId, stylist.stylistMemberId!)
  // Bound the scan to the surrounding day — a candidate overlap must start
  // before our end, and no salon service runs longer than 24h.
  const rows = await exec.select().from(appointment)
    .where(and(
      eq(appointment.companyId, companyId),
      heldBy,
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

// A chair/room is a physical resource too: two clients booked into "Chair 2" at the same time is a
// double-book even with no stylist assigned. Station names are compared trimmed + case-insensitive. (SALON-H10)
async function findStationConflict(companyId: string, station: string, start: Date, end: Date, ignoreId?: string, exec: any = db) {
  const wanted = station.trim().toLowerCase()
  if (!wanted) return undefined
  const rows = await exec.select().from(appointment)
    .where(and(
      eq(appointment.companyId, companyId),
      lte(appointment.startTime, end),
      gte(appointment.startTime, new Date(start.getTime() - 86400000)),
      ...(ignoreId ? [ne(appointment.id, ignoreId)] : []),
    ))
  return rows.find(r => {
    if (CANCELLED.includes(r.status) || r.status === 'completed') return false
    if ((r.station || '').trim().toLowerCase() !== wanted) return false
    const rs = new Date(r.startTime).getTime()
    const re = r.endTime ? new Date(r.endTime).getTime() : rs + 3600000
    return start.getTime() < re && end.getTime() > rs
  })
}

// Closing a visit: create the sale once and queue the review request. Never throws — the status
// change must succeed even if billing or reviews hiccup. (SALON-H4 / H2)
async function onVisitCompleted(row: typeof appointment.$inferSelect): Promise<string | null> {
  if (!row.contactId) return null
  let invoiceId: string | null = null
  try {
    let price = Number(row.quotedPrice)
    let serviceName: string | null = null
    if (row.serviceId) {
      const [svc] = await db.select({ name: serviceMenu.name, price: serviceMenu.price }).from(serviceMenu).where(eq(serviceMenu.id, row.serviceId)).limit(1)
      serviceName = svc?.name || null
      if (!(price > 0)) price = Number(svc?.price)
    }
    const inv = await ensureInvoiceForVisit({ companyId: row.companyId, contactId: row.contactId, appointmentId: row.id, serviceName, price })
    invoiceId = inv?.id || null
  } catch (e: any) { console.warn('[appointments] sale not created:', e?.message || e) }
  // The visit itself: a completed appointment IS a visit, so write the service record (once) —
  // visit count, last visit, due-back and the formula history all hang off it. The stylist adds the
  // formula from the client's page; Log Service still works and simply edits this row. (SALON-H4)
  try {
    const [rec] = await db.select({ id: serviceRecord.id }).from(serviceRecord).where(and(eq(serviceRecord.appointmentId, row.id), eq(serviceRecord.companyId, row.companyId))).limit(1)
    if (!rec) {
      const price = Number(row.quotedPrice)
      await db.insert(serviceRecord).values({
        // carry the chair through to the visit, whichever column holds the stylist (T20 H1)
        id: createId(), contactId: row.contactId, appointmentId: row.id,
        stylistId: row.stylistId || null, stylistMemberId: (row as any).stylistMemberId || null,
        serviceId: row.serviceId || null,
        performedAt: new Date(row.startTime), formula: [], priceCharged: price > 0 ? String(price) : null,
        notes: 'Logged automatically when the appointment was completed.', companyId: row.companyId,
      } as any)
    }
  } catch (e: any) { console.warn('[appointments] visit record not created:', e?.message || e) }
  scheduleReviewRequestForVisit({ companyId: row.companyId, contactId: row.contactId }).catch((e) => console.warn('[appointments] review schedule failed:', e?.message || e))
  return invoiceId
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
  // filter on either column — the caller knows one stylist id, not which table it came from (T20 H1)
  if (stylistId) conditions.push(or(eq(appointment.stylistId, stylistId), eq(appointment.stylistMemberId, stylistId))!)
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
    stylistMemberName: teamMember.name,
  })
    .from(appointment)
    .leftJoin(contact, eq(appointment.contactId, contact.id))
    .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
    .leftJoin(user, eq(appointment.stylistId, user.id))
    // a roster stylist's name lives in team_member (T20 H1)
    .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
    .where(and(...conditions))
    .orderBy(appointment.startTime)

  const rows = data.map((r: any) => {
    // The book asked for a stylist and gets one back the same way, whichever column holds them —
    // the caller never has to know there are two. (T20 H1)
    const memberFirst = String(r.stylistMemberName || '').trim().split(/\s+/)[0] || null
    const memberLast = String(r.stylistMemberName || '').trim().split(/\s+/).slice(1).join(' ') || null
    return {
      ...r.appointment,
      stylistId: stylistIdOf(r.appointment),
      clientName: r.clientName, clientPhone: r.clientPhone, clientMobile: r.clientMobile,
      serviceName: r.serviceName, serviceDurationMin: r.serviceDurationMin,
      stylistFirstName: r.stylistFirstName ?? memberFirst,
      stylistLastName: r.stylistLastName ?? memberLast,
    }
  })
  return c.json({ data: rows })
})

// POST /appointments
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (!body.startTime) return c.json({ error: 'startTime is required' }, 400)

  // 30 February is not a day. JS does not say so — it rolls to 2 March — so a booking for 2027-02-30
  // came back 201 and landed five weeks from where anyone would look for it. (Salon T27 N8)
  if (!isRealCalendarDay(body.startTime)) {
    return c.json({ error: `${String(body.startTime).slice(0, 10)} is not a real calendar date — check the day and month.`, code: 'BAD_DATE' }, 400)
  }
  if (body.endTime && !isRealCalendarDay(body.endTime)) {
    return c.json({ error: `${String(body.endTime).slice(0, 10)} is not a real calendar date — check the day and month.`, code: 'BAD_DATE' }, 400)
  }
  const startTime = new Date(body.startTime)
  if (Number.isNaN(startTime.getTime())) return c.json({ error: 'startTime is not a valid date' }, 400)
  if (body.status && !APPT_STATUSES.includes(body.status)) return c.json({ error: `status must be one of ${APPT_STATUSES.join(', ')}` }, 400)
  if (body.quotedPrice != null && body.quotedPrice !== '' && (isNaN(Number(body.quotedPrice)) || Number(body.quotedPrice) < 0)) return c.json({ error: 'Quoted price cannot be negative.' }, 400)
  if (body.contactId) {
    const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
    if (!ct) return c.json({ error: 'That client does not exist.' }, 404)
  }
  const serviceId = body.serviceId || null
  // Named here, the way the client two lines up already is. (Salon T27 N17)
  if (serviceId && !(await ownService(currentUser.companyId, serviceId))) return c.json({ error: 'That service is not on your Service Menu.' }, 404)
  const endTime = await resolveEnd(currentUser.companyId, startTime, serviceId, body.endTime || null)
  // A manually-set end before the start was saved verbatim ("9:00 AM – 8:00 AM"). (SCHED-01)
  if (endTime.getTime() <= startTime.getTime()) return c.json({ error: 'The end time must be after the start time.' }, 400)
  if (endTime.getTime() - startTime.getTime() > MAX_APPT_MS) return c.json({ error: 'An appointment cannot run longer than 12 hours.' }, 400)

  // A stylist may be a login user or a roster member; work out which before writing. An id that is
  // neither is a 400 naming the field, not a foreign-key 409 that names nothing. (T20 H1)
  // Either field. This read body.stylistId alone, so a caller sending stylistMemberId got their
  // value echoed back with nobody assigned — silent, and the roster stylist is exactly the case
  // resolveStylist() was written for: it has taken a user id OR a team-member id since T20 H1.
  // (Salon T27 N17)
  const stylist = await resolveStylist(currentUser.companyId, body.stylistId ?? body.stylistMemberId)
  if (!stylist) return unknownStylist(c, body.stylistId)

  let created
  try {
    created = await db.transaction(async (tx: any) => {
      await apptLock(tx, currentUser.companyId)
      if (stylist.stylistId || stylist.stylistMemberId) {
        const clash = await findConflict(currentUser.companyId, stylist, startTime, endTime, undefined, tx)
        if (clash) throw new ApptConflict({ error: 'That stylist is already booked at this time', conflictId: clash.id })
      }
      if (body.station) {
        const clash = await findStationConflict(currentUser.companyId, String(body.station), startTime, endTime, undefined, tx)
        if (clash) throw new ApptConflict({ error: `${String(body.station).trim()} is already booked at this time`, conflictId: clash.id })
      }
      const [row] = await tx.insert(appointment).values({
        id: createId(),
        contactId: body.contactId || null,
        stylistId: stylist.stylistId,
        stylistMemberId: stylist.stylistMemberId,
        serviceId,
        status: body.status || 'scheduled',
        station: body.station || null,
        startTime,
        endTime,
        quotedPrice: body.quotedPrice ?? null,
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
  // answer with the stylist id the caller gave us, whichever column it landed in (T20 H1)
  return c.json({ ...created, stylistId: stylistIdOf(created) }, 201)
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
  if ('status' in updates && !APPT_STATUSES.includes(updates.status)) return c.json({ error: `status must be one of ${APPT_STATUSES.join(', ')}` }, 400)
  if ('quotedPrice' in updates && updates.quotedPrice != null && updates.quotedPrice !== '' && (isNaN(Number(updates.quotedPrice)) || Number(updates.quotedPrice) < 0)) return c.json({ error: 'Quoted price cannot be negative.' }, 400)
  if (updates.startTime) {
    updates.startTime = new Date(updates.startTime)
    if (Number.isNaN(updates.startTime.getTime())) return c.json({ error: 'startTime is not a valid date' }, 400)
  }
  if (updates.endTime) updates.endTime = new Date(updates.endTime)

  // A drag-and-drop reschedule moves startTime without touching endTime, so
  // re-derive the end whenever the start or the service changed.
  const nextStart: Date = updates.startTime ?? new Date(existing.startTime)
  const nextService = 'serviceId' in updates ? updates.serviceId : existing.serviceId
  if ('serviceId' in updates && updates.serviceId && !(await ownService(currentUser.companyId, updates.serviceId))) return c.json({ error: 'That service is not on your Service Menu.' }, 404)
  if (('startTime' in updates || 'serviceId' in updates) && !('endTime' in updates)) {
    updates.endTime = await resolveEnd(currentUser.companyId, nextStart, nextService, null)
  }
  const nextEnd: Date = updates.endTime ?? (existing.endTime ? new Date(existing.endTime) : new Date(nextStart.getTime() + 3600000))
  // Reassigning the chair has to land in the right column, and the stylist has to exist. (T20 H1)
  let nextStylist: StylistRef = { stylistId: existing.stylistId, stylistMemberId: (existing as any).stylistMemberId ?? null }
  if ('stylistId' in updates) {
    const resolved = await resolveStylist(currentUser.companyId, updates.stylistId ?? (updates as any).stylistMemberId)
    if (!resolved) return unknownStylist(c, updates.stylistId)
    nextStylist = resolved
    updates.stylistId = resolved.stylistId
    updates.stylistMemberId = resolved.stylistMemberId
  }
  const nextStatus = 'status' in updates ? updates.status : existing.status
  // Completing an appointment WRITES A VISIT dated to its start time, and a visit can only be dated to
  // a day that has happened — Log Service says so in as many words and refuses. Complete did not ask,
  // so an appointment five weeks out could be completed from The Book, producing a service record
  // dated in the future and a sale to go with it. Two doors into the same act, one of them unlocked.
  // (Salon T27 N4)
  //
  // The test is a future DAY, not a future instant. Finishing the 2pm client at 1:55 is an ordinary
  // afternoon, and an earlier version of this refused it — the existing roster test books today at
  // 22:00 and completes it, and went red, correctly. "A day that has happened" is the same wording the
  // visit rule uses, so the two now agree instead of one being stricter than the act it guards.
  if (nextStatus === 'completed' && existing.status !== 'completed') {
    const tz = await salonTimezone(currentUser.companyId)
    const apptDay = calendarDateIn(nextStart, tz)
    const today = calendarDateIn(new Date(), tz)
    if (apptDay > today) {
      return c.json({
        error: `That appointment is booked for ${apptDay}, which has not happened yet — completing it would record a visit on a future date. Move it to today first if the client came in early.`,
        code: 'FUTURE_APPOINTMENT',
      }, 400)
    }
  }
  // Re-validate the effective pair — editing the end (or dragging the start) must not
  // produce an end at/before the start. (SCHED-01)
  if (nextEnd.getTime() <= nextStart.getTime()) return c.json({ error: 'The end time must be after the start time.' }, 400)
  if (nextEnd.getTime() - nextStart.getTime() > MAX_APPT_MS) return c.json({ error: 'An appointment cannot run longer than 12 hours.' }, 400)

  const nextStation = 'station' in updates ? updates.station : existing.station
  let updated
  try {
    updated = await db.transaction(async (tx: any) => {
      await apptLock(tx, currentUser.companyId)
      if ((nextStylist.stylistId || nextStylist.stylistMemberId) && !CANCELLED.includes(nextStatus)) {
        const clash = await findConflict(currentUser.companyId, nextStylist, nextStart, nextEnd, id, tx)
        if (clash) throw new ApptConflict({ error: 'That stylist is already booked at this time', conflictId: clash.id })
      }
      if (nextStation && !CANCELLED.includes(nextStatus) && nextStatus !== 'completed') {
        const clash = await findStationConflict(currentUser.companyId, String(nextStation), nextStart, nextEnd, id, tx)
        if (clash) throw new ApptConflict({ error: `${String(nextStation).trim()} is already booked at this time`, conflictId: clash.id })
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
  if (nextStatus !== existing.status) await syncOnlineBooking(id, nextStatus)
  const invoiceId = nextStatus === 'completed' && existing.status !== 'completed' ? await onVisitCompleted(updated) : null
  return c.json({ ...updated, stylistId: stylistIdOf(updated), invoiceId })
})

// POST /appointments/:id/check-in
app.post('/:id/check-in', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)

  // Checking in a CANCELLED or no-show appointment quietly revived it: 200, status checked_in, and a
  // slot the salon had given away was occupied again. Cancelling is a decision; undoing it is
  // rebooking, which is a different act with a different conversation. (Salon T27 N4)
  if (CANCELLED.includes(existing.status)) {
    return c.json({
      error: `That appointment was ${existing.status === 'no_show' ? 'marked a no-show' : 'cancelled'} and cannot be checked in. Book a new appointment for this client.`,
      code: 'APPOINTMENT_NOT_LIVE',
    }, 409)
  }
  if (existing.status === 'completed') {
    return c.json({ error: 'That appointment has already been completed.', code: 'APPOINTMENT_NOT_LIVE' }, 409)
  }

  const [updated] = await db.update(appointment)
    .set({ status: 'checked_in', checkedInAt: new Date(), updatedAt: new Date() })
    .where(eq(appointment.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json({ ...updated, stylistId: stylistIdOf(updated) })
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
  await syncOnlineBooking(id, 'cancelled')

  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json({ success: true, appointment: updated })
})

export default app
