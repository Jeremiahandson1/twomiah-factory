import { Hono } from 'hono'
import { roundsToNothing } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { appointment, serviceMenu, contact, user, serviceRecord, teamMember, invoice } from '../../db/schema.ts'
import { eq, and, gte, lte, ne, sql, or } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { ensureInvoiceForVisit, invoiceIdForVisit, VOIDED_ON_CANCEL } from '../services/salonCheckout.ts'
import { keepFromRecord, AUTO_VISIT_NOTE, CANCELLED_VISIT_LABEL, REPAIR_MARK } from '../services/clientFormulas.ts'
import { scheduleReviewRequestForVisit } from '../services/reviews.ts'
import { resolveStylist, unknownStylist, stylistIdOf, type StylistRef } from '../utils/stylist.ts'
import { isRealCalendarDay } from '../shared/index.ts'
import { awardForCompletedVisit, reverseForCancelledVisit, priceForVisit } from '../services/loyaltyAward.ts'
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
 * generic foreign-key message ("A related record does not exist, or is still in use.", 409) â€” which names
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
  // Match on whichever column holds this stylist â€” a roster stylist can be double-booked exactly as
  // easily as a login one, and the check has to follow them into their own column. (T20 H1)
  const heldBy = stylist.stylistId
    ? eq(appointment.stylistId, stylist.stylistId)
    : eq(appointment.stylistMemberId, stylist.stylistMemberId!)
  // Bound the scan to the surrounding day â€” a candidate overlap must start
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

// Closing a visit: create the sale once and queue the review request. Never throws â€” the status
// change must succeed even if billing or reviews hiccup. (SALON-H4 / H2)
async function onVisitCompleted(row: typeof appointment.$inferSelect): Promise<string | null> {
  if (!row.contactId) return null
  let invoiceId: string | null = null

  // ONE price for this visit, worked out once.
  //
  // RR0929 N8: the sale below resolved the price as "what was quoted, else what the menu charges",
  // and the visit record further down re-declared `const price = Number(row.quotedPrice)` with no
  // menu fallback. So a booking taken without a quoted price â€” which is most of them, the price
  // comes off the service â€” billed the client correctly and wrote the visit at priceCharged null,
  // and the client's chart showed $0.00 beside an invoice for $32.55. The same function, two
  // prices, the second shadowing the first.
  //
  // Resolved here so the two cannot diverge again: the sale and the visit are the same event and
  // must agree about what it cost.
  let price = Number(row.quotedPrice)
  let serviceName: string | null = null
  try {
    if (row.serviceId) {
      const [svc] = await db.select({ name: serviceMenu.name, price: serviceMenu.price }).from(serviceMenu).where(eq(serviceMenu.id, row.serviceId)).limit(1)
      serviceName = svc?.name || null
      if (!(price > 0)) price = Number(svc?.price)
    }
  } catch (e: any) { console.warn('[appointments] service menu not read:', e?.message || e) }

  try {
    const inv = await ensureInvoiceForVisit({ companyId: row.companyId, contactId: row.contactId, appointmentId: row.id, serviceName, price })
    invoiceId = inv?.id || null
  } catch (e: any) { console.warn('[appointments] sale not created:', e?.message || e) }
  // The visit itself: a completed appointment IS a visit, so write the service record (once) â€”
  // visit count, last visit, due-back and the formula history all hang off it. The stylist adds the
  // formula from the client's page; Log Service still works and simply edits this row. (SALON-H4)
  try {
    const [rec] = await db.select({ id: serviceRecord.id }).from(serviceRecord).where(and(eq(serviceRecord.appointmentId, row.id), eq(serviceRecord.companyId, row.companyId))).limit(1)
    if (!rec) {
      // â€¦the price resolved above, not a second reading of quotedPrice. (RR0929 N8)
      await db.insert(serviceRecord).values({
        // carry the chair through to the visit, whichever column holds the stylist (T20 H1)
        id: createId(), contactId: row.contactId, appointmentId: row.id,
        stylistId: row.stylistId || null, stylistMemberId: (row as any).stylistMemberId || null,
        serviceId: row.serviceId || null,
        performedAt: new Date(row.startTime), formula: [], priceCharged: price > 0 ? String(price) : null,
        notes: AUTO_VISIT_NOTE, companyId: row.companyId,
      } as any)
    }
  } catch (e: any) { console.warn('[appointments] visit record not created:', e?.message || e) }
  // Loyalty rides on the same event: the client sat in the chair and paid, which is the moment
  // points are earned and a punch card gets its punch. Idempotent on the appointment id, so a
  // status flipped back and forth cannot pay out twice. Never fatal â€” a misconfigured programme
  // must not stop a visit being completed or its invoice raised.
  try {
    const price = await priceForVisit(row.companyId, row.serviceId, row.quotedPrice)
    await awardForCompletedVisit({
      companyId: row.companyId, contactId: row.contactId, appointmentId: row.id,
      serviceId: row.serviceId, price,
      // Which bill these points came off. Raised a few lines above, in this same step. (LY0928 L1)
      invoiceId,
    })
  } catch (e: any) { console.warn('[appointments] loyalty not awarded:', e?.message || e) }

  scheduleReviewRequestForVisit({ companyId: row.companyId, contactId: row.contactId }).catch((e) => console.warn('[appointments] review schedule failed:', e?.message || e))
  return invoiceId
}

/**
 * The note onVisitCompleted puts on the record it writes, and the label a rescued formula carries.
 *
 * Both are DEFINED in services/clientFormulas.ts and re-exported here for the routes that already
 * import them from this file. One definition, deliberately: that module is the one that decides what
 * counts as a stylist's own work when it lifts a formula onto a client, and a second copy of the
 * string is a second answer to the same question, waiting to disagree. The first version of this did
 * leave the decision to each caller, and the two callers promptly disagreed â€” the repair stripped the
 * system's note and the cancel path kept it, so cancelling an untouched visit wrote "Logged
 * automaticallyâ€¦" onto a client's card as if a colourist had typed it. (FULL0929 F1)
 */
export { AUTO_VISIT_NOTE, CANCELLED_VISIT_LABEL, REPAIR_MARK as CANCELLED_VISIT_NOTE }

// Reopening a visit: give back what it earned. Never throws â€” cancelling has to succeed. (LY0928 M1)
async function onVisitUncompleted(row: typeof appointment.$inferSelect): Promise<void> {
  try {
    await reverseForCancelledVisit({ companyId: row.companyId, appointmentId: row.id, serviceId: row.serviceId })
  } catch (e: any) { console.warn('[appointments] loyalty not reversed:', e?.message || e) }

  // â€¦and the bill goes with them. LYR N5: a completed $65 visit set to cancelled gave back its
  // points, its punch and its earned-to-date, and left INV-00240 for $70.53 sitting in Outstanding
  // â€” the salon showing money owed for an appointment it had just agreed did not happen.
  //
  // The decision, stated because the retest asked for one: cancelling voids the bill, on the same
  // rule the visit-delete path uses. Voiding keeps the number and the audit trail instead of
  // deleting anything, and money that was actually collected stops it â€” a client who paid is owed
  // a refund or a credit, which is a person's decision, not something a status flip should make.
  // Completing the appointment again puts the same bill back (see ensureInvoiceForVisit).
  try {
    const [bill] = await db.select().from(invoice)
      .where(and(eq(invoice.companyId, row.companyId), eq(invoice.appointmentId, row.id))).limit(1)
    if (bill && bill.status !== 'void' && bill.status !== 'refunded') {
      const held = Math.round((Number(bill.amountPaid || 0) - Number(bill.amountRefunded || 0)) * 100) / 100
      if (held <= 0.005) {
        const note = String(bill.notes || '')
        await db.update(invoice).set({
          status: 'void',
          notes: note ? `${note}\n${VOIDED_ON_CANCEL}` : VOIDED_ON_CANCEL,
          updatedAt: new Date(),
        } as any).where(eq(invoice.id, bill.id))
        emitToCompany(row.companyId, EVENTS.REFRESH, { entity: 'invoice' })
      }
    }
  } catch (e: any) { console.warn('[appointments] sale not voided:', e?.message || e) }

  // â€¦and so does the VISIT RECORD.
  //
  // FULL0929 F1: the points went back and the bill was voided, and the service record stayed. So
  // the client's chart still held a visit that did not happen â€” counted in their visit total, used
  // as their last visit, and, worst of all, feeding the rebooking reminder: LYR2 Papa sits on the
  // Due to Rebook list for 8 October because of a cut that was cancelled. A reminder to come back
  // for an appointment the salon agreed never took place is the one thing here a CLIENT sees.
  //
  // Deleting a visit has voided its invoice since T22; this is the other direction, which was never
  // built. The record is DELETED rather than flagged, because the salon's own rule is that a
  // completed appointment IS the visit â€” re-completing writes it again (onVisitCompleted), so a
  // disowned row left behind would become a duplicate the moment anyone reopened the appointment.
  //
  // It used to have to CHOOSE. A record a stylist had written a formula or a note on was kept and
  // marked, because a colourist's record of what went on a real head of hair is not a status flip's
  // to destroy â€” and the cost was that the phantom visit went on counting toward that client's
  // rebooking reminder. That was a compromise, and it was named as one in the retest brief.
  //
  // It no longer has to choose. A formula belongs to the CLIENT, not to a booking (Mangomint keeps
  // colour formulas as pinned client notes for exactly this reason), so the work is lifted onto the
  // client's own card FIRST and the record then goes with the visit that did not happen. Nothing
  // clinical is lost and no ghost drives a reminder. See services/clientFormulas.ts.
  try {
    const [rec] = await db.select().from(serviceRecord)
      .where(and(eq(serviceRecord.companyId, row.companyId), eq(serviceRecord.appointmentId, row.id))).limit(1)
    if (rec) {
      const kept = await keepFromRecord(row.companyId, rec, CANCELLED_VISIT_LABEL)
      if (kept) console.warn(`[appointments] formula from visit ${rec.id} kept on client ${rec.contactId} before the record was removed`)
      await db.delete(serviceRecord).where(eq(serviceRecord.id, rec.id))
      emitToCompany(row.companyId, EVENTS.REFRESH, { entity: 'service_record' })
      if (kept) emitToCompany(row.companyId, EVENTS.REFRESH, { entity: 'client_profile' })
    }
  } catch (e: any) { console.warn('[appointments] visit record not removed:', e?.message || e) }
}

// GET /appointments â€” ?from=&to= on startTime, ?contactId=, ?stylistId=, ?status=, ?page=&limit=
//
// Two things were wrong with this list, and the second one cost a tenant its book.
//
// It took no contactId. Asking for one client's appointments returned EVERY appointment the
// company has, with no error and no clue â€” the answer to a different question, in the shape of
// the right one. An operator script asked for one client's visits so it could tidy up after
// itself, got all 525, and cancelled the lot. Silently ignoring a filter is not a smaller bug
// than refusing it; it is a bigger one, because the caller cannot tell.
//
// And it was unbounded. from/to are OPTIONAL, so a bare GET / returns the whole table: four
// years of a busy salon in one response.
//
// Bounding it needed care, because the book is the one caller and it must not silently lose
// appointments off the end of a day. So: a date WINDOW is itself a bound, and a windowed request
// stays unlimited exactly as before â€” the calendar's behaviour does not change. It is the
// WINDOWLESS request that gets a page, and it says so in the response, so a caller can tell the
// difference between "that is all of them" and "that is the first hundred".
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const from = c.req.query('from')
  const to = c.req.query('to')
  const contactId = c.req.query('contactId')
  const stylistId = c.req.query('stylistId')
  const status = c.req.query('status')

  const conditions = [eq(appointment.companyId, currentUser.companyId)]
  if (from) conditions.push(gte(appointment.startTime, new Date(from)))
  if (to) conditions.push(lte(appointment.startTime, new Date(to)))
  if (contactId) conditions.push(eq(appointment.contactId, contactId))
  // filter on either column â€” the caller knows one stylist id, not which table it came from (T20 H1)
  if (stylistId) conditions.push(or(eq(appointment.stylistId, stylistId), eq(appointment.stylistMemberId, stylistId))!)
  if (status) conditions.push(eq(appointment.status, status))

  // A window bounds the answer on its own; without one, page it.
  const windowed = !!(from || to)
  const page = Math.max(1, Number(c.req.query('page') || '1') || 1)
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || '100') || 100))
  const offset = (page - 1) * limit

  const q = db.select({
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

  // A windowed request is left exactly as it was â€” no LIMIT at all, rather than a large one
  // standing in for none. The book asks for one day and must get all of it.
  const data = windowed ? await q : await q.limit(limit).offset(offset)

  const rows = data.map((r: any) => {
    // The book asked for a stylist and gets one back the same way, whichever column holds them â€”
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
  // `data` keeps its shape, so the book is untouched. A windowless caller also gets `pagination`,
  // which is how it can tell "all of them" from "the first page of them".
  if (windowed) return c.json({ data: rows })
  const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` }).from(appointment)
    .leftJoin(contact, eq(appointment.contactId, contact.id))
    .where(and(...conditions)) as any
  return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// POST /appointments
app.post('/', requirePermission('schedule:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (!body.startTime) return c.json({ error: 'startTime is required' }, 400)

  // 30 February is not a day. JS does not say so â€” it rolls to 2 March â€” so a booking for 2027-02-30
  // came back 201 and landed five weeks from where anyone would look for it. (Salon T27 N8)
  if (!isRealCalendarDay(body.startTime)) {
    return c.json({ error: `${String(body.startTime).slice(0, 10)} is not a real calendar date â€” check the day and month.`, code: 'BAD_DATE' }, 400)
  }
  if (body.endTime && !isRealCalendarDay(body.endTime)) {
    return c.json({ error: `${String(body.endTime).slice(0, 10)} is not a real calendar date â€” check the day and month.`, code: 'BAD_DATE' }, 400)
  }
  const startTime = new Date(body.startTime)
  if (Number.isNaN(startTime.getTime())) return c.json({ error: 'startTime is not a valid date' }, 400)
  if (body.status && !APPT_STATUSES.includes(body.status)) return c.json({ error: `status must be one of ${APPT_STATUSES.join(', ')}` }, 400)
  if (body.quotedPrice != null && body.quotedPrice !== '' && (isNaN(Number(body.quotedPrice)) || Number(body.quotedPrice) < 0)) return c.json({ error: 'Quoted price cannot be negative.' }, 400)
  // â€¦and not a positive amount that stores as 0.00 on a decimal(â€¦,2) column: a chair quoted at
  // nothing, which the stylist then has to argue about at the till. Zero stays allowed â€” a
  // complimentary fringe trim is real. (T51 follow-up)
  if (roundsToNothing(body.quotedPrice)) return c.json({ error: `${body.quotedPrice} rounds to $0.00 â€” enter 0 if it is free, or at least one cent.` }, 400)
  // An appointment is a chair booked for somebody. Without a client it could still be created AND
  // completed, which then wrote a visit belonging to nobody â€” and the New Appointment form has always
  // refused it ("A client is required"), so the server was the only thing that disagreed. A contractor
  // job with no customer is a real case; a salon appointment with no client is not. (Salon T30 L3)
  if (!body.contactId) return c.json({ error: 'An appointment needs a client â€” choose one before saving.' }, 400)
  {
    const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
    if (!ct) return c.json({ error: 'That client does not exist.' }, 404)
  }
  const serviceId = body.serviceId || null
  // Named here, the way the client two lines up already is. (Salon T27 N17)
  if (serviceId && !(await ownService(currentUser.companyId, serviceId))) return c.json({ error: 'That service is not on your Service Menu.' }, 404)
  const endTime = await resolveEnd(currentUser.companyId, startTime, serviceId, body.endTime || null)
  // A manually-set end before the start was saved verbatim ("9:00 AM â€“ 8:00 AM"). (SCHED-01)
  if (endTime.getTime() <= startTime.getTime()) return c.json({ error: 'The end time must be after the start time.' }, 400)
  if (endTime.getTime() - startTime.getTime() > MAX_APPT_MS) return c.json({ error: 'An appointment cannot run longer than 12 hours.' }, 400)

  // A stylist may be a login user or a roster member; work out which before writing. An id that is
  // neither is a 400 naming the field, not a foreign-key 409 that names nothing. (T20 H1)
  // Either field. This read body.stylistId alone, so a caller sending stylistMemberId got their
  // value echoed back with nobody assigned â€” silent, and the roster stylist is exactly the case
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
app.put('/:id', requirePermission('schedule:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(appointment)
    .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Appointment not found' }, 404)

  // Whitelist editable columns â€” never let companyId/id be reassigned from the body.
  const EDITABLE = ['contactId', 'stylistId', 'serviceId', 'status', 'station', 'startTime', 'endTime', 'quotedPrice', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('status' in updates && !APPT_STATUSES.includes(updates.status)) return c.json({ error: `status must be one of ${APPT_STATUSES.join(', ')}` }, 400)
  if ('quotedPrice' in updates && updates.quotedPrice != null && updates.quotedPrice !== '' && (isNaN(Number(updates.quotedPrice)) || Number(updates.quotedPrice) < 0)) return c.json({ error: 'Quoted price cannot be negative.' }, 400)
  // The same rule on the edit â€” where a price gets corrected and re-mistyped. (T51 follow-up)
  if ('quotedPrice' in updates && roundsToNothing(updates.quotedPrice)) return c.json({ error: `${updates.quotedPrice} rounds to $0.00 â€” enter 0 if it is free, or at least one cent.` }, 400)
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
  // a day that has happened â€” Log Service says so in as many words and refuses. Complete did not ask,
  // so an appointment five weeks out could be completed from The Book, producing a service record
  // dated in the future and a sale to go with it. Two doors into the same act, one of them unlocked.
  // (Salon T27 N4)
  //
  // The test is a future DAY, not a future instant. Finishing the 2pm client at 1:55 is an ordinary
  // afternoon, and an earlier version of this refused it â€” the existing roster test books today at
  // 22:00 and completes it, and went red, correctly. "A day that has happened" is the same wording the
  // visit rule uses, so the two now agree instead of one being stricter than the act it guards.
  if (nextStatus === 'completed' && existing.status !== 'completed') {
    const tz = await salonTimezone(currentUser.companyId)
    const apptDay = calendarDateIn(nextStart, tz)
    const today = calendarDateIn(new Date(), tz)
    if (apptDay > today) {
      return c.json({
        error: `That appointment is booked for ${apptDay}, which has not happened yet â€” completing it would record a visit on a future date. Move it to today first if the client came in early.`,
        code: 'FUTURE_APPOINTMENT',
      }, 400)
    }
  }
  // Re-validate the effective pair â€” editing the end (or dragging the start) must not
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
  // Completing it raises the sale. NOT completing it â€” because it was already completed, which is
  // what five of six simultaneous requests see â€” still answers with the bill this visit has, so a
  // screen that links to the invoice afterwards has something to link to. (Salon RR8 observation)
  const invoiceId = nextStatus === 'completed'
    ? (existing.status !== 'completed' ? await onVisitCompleted(updated) : await invoiceIdForVisit(currentUser.companyId, id))
    : null
  // â€¦and the other direction. A visit that is cancelled or marked a no-show after it was completed
  // gives its points and its punch back, or a salon could fill a card by completing and cancelling
  // the same appointment over and over. (LY0928 M1)
  if (existing.status === 'completed' && CANCELLED.includes(nextStatus)) await onVisitUncompleted(updated)
  return c.json({ ...updated, stylistId: stylistIdOf(updated), invoiceId })
})

// POST /appointments/:id/check-in
app.post('/:id/check-in', requirePermission('schedule:update'), async (c) => {
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

  // Checking someone in says they are HERE, so it cannot happen weeks before the appointment. A visit 25
  // days out checked in with 200 while Complete on that same appointment was correctly refused as not
  // yet happened (T27 N4) â€” the two halves of one visit disagreeing about whether it had started.
  // Answered on the shop's calendar: an early client on the day is fine, next month's is not. (T28 L5)
  {
    const tz = await salonTimezone(currentUser.companyId)
    const today = calendarDateIn(new Date(), tz)
    const apptDay = calendarDateIn(new Date(existing.startTime), tz)
    if (apptDay > today) {
      return c.json({
        error: `That appointment is on ${apptDay}, not today â€” check the client in when they arrive.`,
        code: 'APPOINTMENT_NOT_TODAY',
      }, 409)
    }
  }

  const [updated] = await db.update(appointment)
    .set({ status: 'checked_in', checkedInAt: new Date(), updatedAt: new Date() })
    .where(eq(appointment.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json({ ...updated, stylistId: stylistIdOf(updated) })
})

// DELETE /appointments/:id â€” cancel, keeping the row so no-show/cancel rates
// stay measurable.
app.delete('/:id', requirePermission('schedule:update'), async (c) => {
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
  // Same rule as the status flip above: a completed visit that is cancelled gives its points and its
  // punch back. Cancelling from the book and cancelling from the list are the same act. (LY0928 M1)
  if (existing.status === 'completed') await onVisitUncompleted(updated)

  await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'appointment' })
  return c.json({ success: true, appointment: updated })
})

export default app
