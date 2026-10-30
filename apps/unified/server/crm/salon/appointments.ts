// The book. Moved from templates/crm-salon/backend/src/routes/appointments.ts.
//
// A salon books a CHAIR for a duration, so endTime is derived from the service's durationMin when the caller doesn't
// supply one, and a stylist (or station) double-book is refused rather than silently accepted. Completing an appointment
// is the visit: it raises the sale, writes the visit record, awards loyalty and queues the review request. Cancelling
// a completed one gives all of that back.
//
// Not moved: the template mirrored each status onto its own online-booking row (online_booking, SALON-N10). That module
// is replaced by the one booking engine (server/booking), which keeps its own bookings' status.
import { Hono } from 'hono'
import { and, count, eq, gte, lte, ne, or } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { roundsToNothing, isRealCalendarDay } from '@twomiah/tenant-backend'
import { appointment, serviceMenu, contact, user, serviceRecord, teamMember, invoice, company } from '../../db/schema/index.ts'
import { lockAppointmentBook } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, listAll } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { calendarDateIn } from './days.ts'
import { checkFilter } from '@twomiah/tenant-backend'
import { APPOINTMENT_TILES, appointmentsTodayCondition } from './tileConditions.ts'
import { maySeePrices, menuPrice } from './prices.ts'
import { CANCELLED_VISIT_LABEL } from './formulas.ts'
import { VOIDED_ON_CANCEL } from './checkout.ts'
import { resolveStylist, unknownStylist, stylistIdOf, type StylistRef } from './people.ts'
import type { SalonServices } from './services.ts'
import { calendarDayWords } from '../../core/dayWords.ts'
import { OWN_BOOK_SETTING, inOwnChair, isOwnChair, ownBookOnlyFrom } from './bookScope.ts'
import { removeVisitPhotoFiles, visitPhotoFilesOf } from './visitPhotos.ts'
import { PATCH_TEST_RULE, PATCH_TEST_SERVICE, offeredServiceId, settingsOf, ruleOn, ruleOnFor, patchTestHold, stateFor } from './patchTest.ts'

const CANCELLED = ['cancelled', 'no_show']
const APPT_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_chair', 'completed', 'no_show', 'cancelled']
const MAX_APPT_MS = 12 * 3600_000 // no salon service runs longer than a working day (SALON-M3)
const EDITABLE = ['contactId', 'stylistId', 'serviceId', 'status', 'station', 'startTime', 'endTime', 'quotedPrice', 'notes'] as const

type AppointmentRow = typeof appointment.$inferSelect

/** A clash found inside the booking transaction: rolls the write back and is answered as a 409 after it unwinds. */
class ApptConflict extends Error { constructor(public sentence: string) { super('appointment conflict') } }

const overlaps = (r: AppointmentRow, start: Date, end: Date) => {
  const rs = new Date(r.startTime).getTime()
  const re = r.endTime ? new Date(r.endTime).getTime() : rs + 3600000
  return start.getTime() < re && end.getTime() > rs
}

export function createAppointmentRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit, logger } = d
  const { requirePermission, requireAnyPermission } = d.permissions
  const canSeeMoney = (u: any) => maySeePrices(canSeeWith(d.permissions), u)
  const live = d.realtime
  const { clock, checkout, formulas, loyalty, book } = salon
  const warn = (what: string, e: any) => logger.warn(`[appointments] ${what}`, { error: e?.message || String(e) })
  const app = new Hono<AppEnv>()

  /**
   * Someone else's appointment, to a seat narrowed to its own chair (./bookScope.ts; owner's decision 2026-10-25): the
   * answer an appointment that is not there gets, because to that seat it is not in the book.
   */
  const notInBook = (c: any) => fail(c, 404, 'Appointment not found')
  /** The refusal for writing an appointment into a chair a narrowed seat does not hold. */
  const notYourChair = (c: any) => fail(c, 403, 'You can only book into your own chair. Ask the front desk or a manager to book another stylist.', 'OWN_BOOK_ONLY')

  /**
   * THE OWNER'S SWITCH: "Stylists see only their own appointments" (Settings › The Book). Read by every seat that opens
   * the book, so the screen can say whose chairs it shows: `ownOnly` is this seat's answer — the one every read and
   * write below applies — and `ownStylistIds` the ids that are its chair, for the stylist picker.
   */
  app.get('/book-settings', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const own = await book.ownChairOf(u)
    return one(c, { [OWN_BOOK_SETTING]: await book.switchOn(u.companyId), ownOnly: !!own, ownStylistIds: own ? [own.userId, ...own.memberIds] : [] })
  })

  /** Who may flip it is who may change the company (company:update — the owner and admins), as Settings › Company. */
  app.put('/book-settings', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body[OWN_BOOK_SETTING] !== 'boolean') return fail(c, 400, 'Say whether stylists see only their own appointments: on or off.', 'BAD_SETTING', { [OWN_BOOK_SETTING]: 'On or off.' })
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = ownBookOnlyFrom(settings)
    const after = body[OWN_BOOK_SETTING] as boolean
    // Merged onto the stored settings: the rest of the blob (plan, tax, loyalty) is not this screen's to touch.
    await db.update(company).set({ settings: { ...settings, [OWN_BOOK_SETTING]: after }, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    await audit.log({ action: 'update', entity: 'company', entityId: u.companyId, metadata: { [OWN_BOOK_SETTING]: { before, after } }, req: { user: u } })
    live.emitToCompany(u.companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
    const own = await book.ownChairOf(u)
    return one(c, { [OWN_BOOK_SETTING]: after, ownOnly: !!own, ownStylistIds: own ? [own.userId, ...own.memberIds] : [] })
  })

  /**
   * The salon's patch-test rule (patchTest.ts): off by default; on, a service that needs a patch test is held back online
   * without a passing one on record, and booked at the desk only with a reason. Read by anyone who reads the Book; changed by
   * whoever changes the company, as the switch above.
   */
  app.get('/patch-test-rule', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, { [PATCH_TEST_RULE]: await ruleOnFor(db, u.companyId), [PATCH_TEST_SERVICE]: offeredServiceId(await settingsOf(db, u.companyId)) })
  })
  // PUT { patchTestRule?: boolean, patchTestServiceId?: string | null } — the switch, and (optional) the menu service a held client is
  // offered online to book first. Either may be sent alone.
  app.put('/patch-test-rule', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const hasRule = PATCH_TEST_RULE in body, hasService = PATCH_TEST_SERVICE in body
    if (!hasRule && !hasService) return fail(c, 400, 'Say whether patch-test services are held back: on or off.', 'BAD_SETTING', { [PATCH_TEST_RULE]: 'On or off.' })
    if (hasRule && typeof body[PATCH_TEST_RULE] !== 'boolean') return fail(c, 400, 'Say whether patch-test services are held back: on or off.', 'BAD_SETTING', { [PATCH_TEST_RULE]: 'On or off.' })
    let serviceId: string | null | undefined
    if (hasService) {
      serviceId = body[PATCH_TEST_SERVICE] ? String(body[PATCH_TEST_SERVICE]) : null
      if (serviceId) {
        const [svc] = await db.select({ id: serviceMenu.id, online: serviceMenu.bookableOnline, requires: serviceMenu.requiresPatchTest }).from(serviceMenu)
          .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, u.companyId))).limit(1)
        if (!svc) return fail(c, 400, 'That service is not on your menu.', 'BAD_SETTING', { [PATCH_TEST_SERVICE]: 'Pick a service from your menu.' })
        if (!svc.online) return fail(c, 400, 'The patch-test appointment has to be bookable online, or the client could not book it.', 'BAD_SETTING', { [PATCH_TEST_SERVICE]: 'Pick a service that is bookable online.' })
        if (svc.requires) return fail(c, 400, 'The patch-test appointment cannot itself need a patch test.', 'BAD_SETTING', { [PATCH_TEST_SERVICE]: 'Pick a service that does not need a patch test.' })
      }
    }
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = { [PATCH_TEST_RULE]: ruleOn(settings), [PATCH_TEST_SERVICE]: offeredServiceId(settings) }
    const after = { ...before, ...(hasRule ? { [PATCH_TEST_RULE]: body[PATCH_TEST_RULE] } : {}), ...(hasService ? { [PATCH_TEST_SERVICE]: serviceId } : {}) }
    await db.update(company).set({ settings: { ...settings, ...after }, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    await audit.log({ action: 'update', entity: 'company', entityId: u.companyId, metadata: { patchTest: { before, after } }, req: { user: u } })
    return one(c, after)
  })

  /** The service, if it is on THIS salon's menu — an unknown id is named, not a foreign-key 409. (Salon T27 N17) */
  async function ownService(companyId: string, serviceId: string) {
    const [svc] = await db.select({ id: serviceMenu.id }).from(serviceMenu)
      .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
    return svc || null
  }

  /** endTime: explicit, else the service's duration, else 60 minutes. */
  async function resolveEnd(companyId: string, startTime: Date, serviceId: string | null, explicitEnd: string | null): Promise<Date> {
    if (explicitEnd) return new Date(explicitEnd)
    let minutes = 60
    if (serviceId) {
      const [svc] = await db.select().from(serviceMenu).where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
      if (svc?.durationMin) minutes = svc.durationMin
    }
    return new Date(startTime.getTime() + minutes * 60000)
  }

  /** A stylist is in one chair at a time, matched on whichever column holds them (T20 H1); cancelled rows free the slot. */
  async function findConflict(companyId: string, stylist: StylistRef, start: Date, end: Date, ignoreId?: string, exec: any = db) {
    const heldBy = stylist.stylistId ? eq(appointment.stylistId, stylist.stylistId) : eq(appointment.stylistMemberId, stylist.stylistMemberId!)
    const rows: AppointmentRow[] = await exec.select().from(appointment).where(and(
      eq(appointment.companyId, companyId), heldBy,
      lte(appointment.startTime, end), gte(appointment.startTime, new Date(start.getTime() - 86400000)),
      ...(ignoreId ? [ne(appointment.id, ignoreId)] : []),
    ))
    return rows.find((r) => !CANCELLED.includes(r.status) && overlaps(r, start, end))
  }

  /** A chair or room is a resource too, compared trimmed and case-insensitive. (SALON-H10) */
  async function findStationConflict(companyId: string, station: string, start: Date, end: Date, ignoreId?: string, exec: any = db) {
    const wanted = station.trim().toLowerCase()
    if (!wanted) return undefined
    const rows: AppointmentRow[] = await exec.select().from(appointment).where(and(
      eq(appointment.companyId, companyId),
      lte(appointment.startTime, end), gte(appointment.startTime, new Date(start.getTime() - 86400000)),
      ...(ignoreId ? [ne(appointment.id, ignoreId)] : []),
    ))
    return rows.find((r) => !CANCELLED.includes(r.status) && r.status !== 'completed' && (r.station || '').trim().toLowerCase() === wanted && overlaps(r, start, end))
  }

  /** Closing a visit — the sale, the visit record, loyalty, the review request — one way, wherever it closes (visit.ts). */
  const onVisitCompleted = (row: AppointmentRow, actor?: any) => salon.visits.closeVisit(row, actor)

  /**
   * Reopening a visit gives back what it earned (LY0928 M1), voids the bill it raised unless money was taken (LYR N5),
   * and removes the visit record — its formula lifted onto the client's card first (FULL0929 F1). Never throws.
   */
  async function onVisitUncompleted(row: AppointmentRow): Promise<void> {
    try {
      await loyalty.reverseForCancelledVisit({ companyId: row.companyId, appointmentId: row.id, serviceId: row.serviceId })
    } catch (e) { warn('loyalty not reversed', e) }

    try {
      const [bill] = await db.select().from(invoice).where(and(eq(invoice.companyId, row.companyId), eq(invoice.appointmentId, row.id))).limit(1)
      if (bill && bill.status !== 'void' && bill.status !== 'refunded') {
        const held = Math.round((Number(bill.amountPaid || 0) - Number(bill.amountRefunded || 0)) * 100) / 100
        if (held <= 0.005) {
          const note = String(bill.notes || '')
          await db.update(invoice).set({ status: 'void', notes: note ? `${note}\n${VOIDED_ON_CANCEL}` : VOIDED_ON_CANCEL, updatedAt: new Date() } as any).where(eq(invoice.id, bill.id))
          live.emitToCompany(row.companyId, live.EVENTS.REFRESH, { entity: 'invoice' })
        }
      }
    } catch (e) { warn('sale not voided', e) }

    try {
      const [rec] = await db.select().from(serviceRecord).where(and(eq(serviceRecord.companyId, row.companyId), eq(serviceRecord.appointmentId, row.id))).limit(1)
      if (rec) {
        const kept = await formulas.keepFromRecord(row.companyId, rec, CANCELLED_VISIT_LABEL)
        if (kept) logger.warn('[appointments] formula kept on the client before the visit record was removed', { recordId: rec.id, contactId: rec.contactId })
        // Its before / after photo files go with it (./visitPhotos.ts, every deletion path): read now, dropped after.
        const photoFiles = await visitPhotoFilesOf(db, row.companyId, { visitIds: [rec.id] })
        await db.delete(serviceRecord).where(eq(serviceRecord.id, rec.id))
        removeVisitPhotoFiles(d.services.storage, photoFiles)
        live.emitToCompany(row.companyId, live.EVENTS.REFRESH, { entity: 'service_record' })
        if (kept) live.emitToCompany(row.companyId, live.EVENTS.REFRESH, { entity: 'client_profile' })
      }
    } catch (e) { warn('visit record not removed', e) }
  }

  /** The stylist named back the way it was given, whichever column holds them (T20 H1). */
  const named = (row: AppointmentRow) => ({ ...row, stylistId: stylistIdOf(row) })

  /**
   * GET /appointments — ?from=&to= on startTime, ?contactId=, ?stylistId=, ?status=, ?page=&limit=. A date window bounds
   * the answer on its own and stays unlimited (the book asks for one day and must get all of it); a windowless request
   * is paged. The contact filter is honoured (an operator cancelled 525 appointments when it was ignored).
   */
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const { from, to, contactId, stylistId, status, tile } = c.req.query()
    // ?tile=today is the home screen's "Appointments today": the shop's day, live rows only (./tileConditions.ts — the
    // dashboard's count calls the same condition).
    const badTile = checkFilter(c, 'tile', tile, APPOINTMENT_TILES)
    if (badTile) return badTile
    const conditions = [eq(appointment.companyId, currentUser.companyId)]
    if (tile === 'today') { const w = await clock.salonDayWindows(currentUser.companyId); conditions.push(appointmentsTodayCondition(appointment, w.today, w.tomorrow)) }
    if (from) conditions.push(gte(appointment.startTime, new Date(from)))
    if (to) conditions.push(lte(appointment.startTime, new Date(to)))
    if (contactId) conditions.push(eq(appointment.contactId, contactId))
    if (stylistId) conditions.push(or(eq(appointment.stylistId, stylistId), eq(appointment.stylistMemberId, stylistId))!)
    if (status) conditions.push(eq(appointment.status, status))
    // A seat narrowed to its own chair reads only that chair — the day, the week, the paged list and the count alike.
    const own = await book.ownChairOf(currentUser)
    if (own) conditions.push(inOwnChair(own))

    const windowed = !!(from || to || tile)
    const page = Math.max(1, Number(c.req.query('page') || '1') || 1)
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || '100') || 100))

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
      .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
      .where(and(...conditions))
      .orderBy(appointment.startTime)

    const data: any[] = windowed ? await q : await q.limit(limit).offset((page - 1) * limit)
    const rows = data.map((r) => {
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
    // A window is the whole of it: one page holding every row.
    if (windowed) return listAll(c, rows)
    const [{ total }] = await db.select({ total: count() }).from(appointment).where(and(...conditions))
    return list(c, rows, { page, limit, total: Number(total) })
  })

  app.post('/', requirePermission('schedule:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (!body.startTime) return fail(c, 400, 'startTime is required')

    // 30 February is not a day; JS rolls it to 2 March. (Salon T27 N8)
    if (!isRealCalendarDay(body.startTime)) return fail(c, 400, `${String(body.startTime).slice(0, 10)} is not a real calendar date — check the day and month.`, 'BAD_DATE')
    if (body.endTime && !isRealCalendarDay(body.endTime)) return fail(c, 400, `${String(body.endTime).slice(0, 10)} is not a real calendar date — check the day and month.`, 'BAD_DATE')
    const startTime = new Date(body.startTime)
    if (Number.isNaN(startTime.getTime())) return fail(c, 400, 'startTime is not a valid date')
    if (body.status && !APPT_STATUSES.includes(body.status)) return fail(c, 400, `status must be one of ${APPT_STATUSES.join(', ')}`)
    if (body.quotedPrice != null && body.quotedPrice !== '' && (isNaN(Number(body.quotedPrice)) || Number(body.quotedPrice) < 0)) return fail(c, 400, 'Quoted price cannot be negative.')
    // A positive amount that stores as 0.00. Zero stays allowed — a complimentary fringe trim is real. (T51)
    if (roundsToNothing(body.quotedPrice)) return fail(c, 400, `${body.quotedPrice} rounds to $0.00 — enter 0 if it is free, or at least one cent.`)
    // A salon appointment with no client wrote a visit belonging to nobody. (Salon T30 L3)
    if (!body.contactId) return fail(c, 400, 'An appointment needs a client — choose one before saving.')
    {
      const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
      if (!ct) return fail(c, 404, 'That client does not exist.')
    }
    const serviceId = body.serviceId || null
    if (serviceId && !(await ownService(currentUser.companyId, serviceId))) return fail(c, 404, 'That service is not on your Service Menu.')
    // A seat that may not see prices books at the menu's price, chosen here, and cannot set another (./prices.ts).
    if (!(await canSeeMoney(currentUser))) body.quotedPrice = await menuPrice(db, currentUser.companyId, serviceId)
    // A service that needs a patch test, for a client without a passing one on record (when the salon switched the rule on):
    // booked only with a reason, kept on the appointment. (patchTest.ts)
    let patchNote = ''
    if (serviceId && body.status !== 'cancelled') {
      const [menu] = await db.select({ name: serviceMenu.name, requiresPatchTest: serviceMenu.requiresPatchTest }).from(serviceMenu).where(eq(serviceMenu.id, serviceId)).limit(1)
      if (menu?.requiresPatchTest && (await ruleOnFor(db, currentUser.companyId))) {
        const hold = patchTestHold((await stateFor(db, body.contactId, await clock.salonToday(currentUser.companyId))).state, menu.name || '')
        if (hold) {
          const why = String(body.patchTestOverrideReason || '').trim()
          if (why.length < 3) return fail(c, 409, `${hold} To book it anyway, say why.`, 'PATCH_TEST_NEEDED', { patchTestOverrideReason: 'Say why you are booking it anyway.' })
          patchNote = `Booked without a passing patch test — ${why.slice(0, 300)}`
        }
      }
    }
    const endTime = await resolveEnd(currentUser.companyId, startTime, serviceId, body.endTime || null)
    if (endTime.getTime() <= startTime.getTime()) return fail(c, 400, 'The end time must be after the start time.')
    if (endTime.getTime() - startTime.getTime() > MAX_APPT_MS) return fail(c, 400, 'An appointment cannot run longer than 12 hours.')

    // Either field: a login user or a roster stylist. (T20 H1, Salon T27 N17)
    // A seat narrowed to its own chair books into it: named nobody, it is the stylist (an unassigned booking would
    // vanish from its own book the moment it was saved); named somebody else, it is refused.
    const own = await book.ownChairOf(currentUser)
    const asked = body.stylistId ?? body.stylistMemberId
    const stylist = await resolveStylist(db, currentUser.companyId, own && (asked == null || asked === '') ? own.userId : asked)
    if (!stylist) return unknownStylist(c, body.stylistId)
    if (own && !isOwnChair(own, stylist)) return notYourChair(c)

    let created: AppointmentRow
    try {
      created = await db.transaction(async (tx: any) => {
        await lockAppointmentBook(tx, currentUser.companyId)
        if (stylist.stylistId || stylist.stylistMemberId) {
          if (await findConflict(currentUser.companyId, stylist, startTime, endTime, undefined, tx)) throw new ApptConflict('That stylist is already booked at this time')
        }
        if (body.station) {
          if (await findStationConflict(currentUser.companyId, String(body.station), startTime, endTime, undefined, tx)) throw new ApptConflict(`${String(body.station).trim()} is already booked at this time`)
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
          notes: [patchNote, body.notes].filter(Boolean).join(' — ') || null,
          companyId: currentUser.companyId,
        }).returning()
        return row
      })
    } catch (e) {
      // The template also sent the clashing appointment's id; nothing read it.
      if (e instanceof ApptConflict) return fail(c, 409, e.sentence, 'APPOINTMENT_CONFLICT')
      throw e
    }

    await audit.log({ action: 'create', entity: 'appointment', entityId: created.id, metadata: created, req: { user: currentUser } })
    live.emitToCompany(currentUser.companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, named(created), 201)
  })

  app.put('/:id', requirePermission('schedule:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing]: AppointmentRow[] = await db.select().from(appointment)
      .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Appointment not found')
    const own = await book.ownChairOf(currentUser)
    if (own && !isOwnChair(own, existing)) return notInBook(c)

    // Whitelisted — companyId and id are never set from the body.
    const updates: Record<string, any> = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    // Not a price-seat: the price is never theirs to change; a new service re-prices at the menu's own price (./prices.ts).
    if (!(await canSeeMoney(currentUser))) {
      delete updates.quotedPrice
      if (updates.serviceId && updates.serviceId !== existing.serviceId) updates.quotedPrice = await menuPrice(db, currentUser.companyId, updates.serviceId)
    }
    if ('status' in updates && !APPT_STATUSES.includes(updates.status)) return fail(c, 400, `status must be one of ${APPT_STATUSES.join(', ')}`)
    // The moment it was cancelled is kept: a late-cancel fee is measured from it (cardOnFile.ts). Reopened, it has none.
    if ('status' in updates) {
      if (updates.status === 'cancelled' && existing.status !== 'cancelled') updates.cancelledAt = new Date()
      else if (updates.status !== 'cancelled' && existing.status === 'cancelled') updates.cancelledAt = null
    }
    if ('quotedPrice' in updates && updates.quotedPrice != null && updates.quotedPrice !== '' && (isNaN(Number(updates.quotedPrice)) || Number(updates.quotedPrice) < 0)) return fail(c, 400, 'Quoted price cannot be negative.')
    if ('quotedPrice' in updates && roundsToNothing(updates.quotedPrice)) return fail(c, 400, `${updates.quotedPrice} rounds to $0.00 — enter 0 if it is free, or at least one cent.`)
    if (updates.startTime) {
      updates.startTime = new Date(updates.startTime)
      if (Number.isNaN(updates.startTime.getTime())) return fail(c, 400, 'startTime is not a valid date')
    }
    if (updates.endTime) updates.endTime = new Date(updates.endTime)

    // A drag-and-drop reschedule moves the start without the end: re-derive it when the start or the service changed.
    const nextStart: Date = updates.startTime ?? new Date(existing.startTime)
    const nextService = 'serviceId' in updates ? updates.serviceId : existing.serviceId
    if ('serviceId' in updates && updates.serviceId && !(await ownService(currentUser.companyId, updates.serviceId))) return fail(c, 404, 'That service is not on your Service Menu.')
    if (('startTime' in updates || 'serviceId' in updates) && !('endTime' in updates)) {
      updates.endTime = await resolveEnd(currentUser.companyId, nextStart, nextService, null)
    }
    const nextEnd: Date = updates.endTime ?? (existing.endTime ? new Date(existing.endTime) : new Date(nextStart.getTime() + 3600000))
    let nextStylist: StylistRef = { stylistId: existing.stylistId, stylistMemberId: existing.stylistMemberId ?? null }
    if ('stylistId' in updates) {
      const resolved = await resolveStylist(db, currentUser.companyId, updates.stylistId ?? updates.stylistMemberId)
      if (!resolved) return unknownStylist(c, updates.stylistId)
      // Handing the appointment to another chair (or to nobody) is not a narrowed seat's to do.
      if (own && !isOwnChair(own, resolved)) return notYourChair(c)
      nextStylist = resolved
      updates.stylistId = resolved.stylistId
      updates.stylistMemberId = resolved.stylistMemberId
    }
    const nextStatus = 'status' in updates ? updates.status : existing.status
    // Completing WRITES A VISIT dated to its start, and a visit can only be dated to a day that has happened — a future
    // DAY, not a future instant (finishing the 2pm client at 1:55 is an ordinary afternoon). (Salon T27 N4)
    if (nextStatus === 'completed' && existing.status !== 'completed') {
      const tz = await clock.salonTimezone(currentUser.companyId)
      const apptDay = calendarDateIn(nextStart, tz)
      if (apptDay > calendarDateIn(new Date(), tz)) {
        return fail(c, 400, `That appointment is booked for ${apptDay}, which has not happened yet — completing it would record a visit on a future date. Move it to today first if the client came in early.`, 'FUTURE_APPOINTMENT')
      }
    }
    // The effective pair. (SCHED-01)
    if (nextEnd.getTime() <= nextStart.getTime()) return fail(c, 400, 'The end time must be after the start time.')
    if (nextEnd.getTime() - nextStart.getTime() > MAX_APPT_MS) return fail(c, 400, 'An appointment cannot run longer than 12 hours.')

    const nextStation = 'station' in updates ? updates.station : existing.station
    let updated: AppointmentRow
    try {
      updated = await db.transaction(async (tx: any) => {
        await lockAppointmentBook(tx, currentUser.companyId)
        if ((nextStylist.stylistId || nextStylist.stylistMemberId) && !CANCELLED.includes(nextStatus)) {
          if (await findConflict(currentUser.companyId, nextStylist, nextStart, nextEnd, id, tx)) throw new ApptConflict('That stylist is already booked at this time')
        }
        if (nextStation && !CANCELLED.includes(nextStatus) && nextStatus !== 'completed') {
          if (await findStationConflict(currentUser.companyId, String(nextStation), nextStart, nextEnd, id, tx)) throw new ApptConflict(`${String(nextStation).trim()} is already booked at this time`)
        }
        const [row] = await tx.update(appointment).set(updates).where(eq(appointment.id, id)).returning()
        return row
      })
    } catch (e) {
      if (e instanceof ApptConflict) return fail(c, 409, e.sentence, 'APPOINTMENT_CONFLICT')
      throw e
    }
    await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    live.emitToCompany(currentUser.companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
    // Completing raises the sale; already completed (five of six simultaneous requests) still answers with the bill.
    const invoiceId = nextStatus === 'completed'
      ? (existing.status !== 'completed' ? await onVisitCompleted(updated, currentUser) : await checkout.invoiceIdForVisit(currentUser.companyId, id))
      : null
    if (existing.status === 'completed' && CANCELLED.includes(nextStatus)) await onVisitUncompleted(updated)
    return one(c, { ...named(updated), invoiceId })
  })

  // Checking a client in is the front desk's job as well as the stylist's: `schedule:check-in` opens this and nothing else in the
  // book (a move, a complete and a cancel stay `schedule:update`). Owner's decision, 2026-10-29.
  app.post('/:id/check-in', requireAnyPermission(['schedule:update', 'schedule:check-in']), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing]: AppointmentRow[] = await db.select().from(appointment)
      .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Appointment not found')
    { const own = await book.ownChairOf(currentUser); if (own && !isOwnChair(own, existing)) return notInBook(c) }

    // Checking in a cancelled or no-show appointment quietly revived it. (Salon T27 N4)
    if (CANCELLED.includes(existing.status)) {
      return fail(c, 409, `That appointment was ${existing.status === 'no_show' ? 'marked a no-show' : 'cancelled'} and cannot be checked in. Book a new appointment for this client.`, 'APPOINTMENT_NOT_LIVE')
    }
    if (existing.status === 'completed') return fail(c, 409, 'That appointment has already been completed.', 'APPOINTMENT_NOT_LIVE')
    // Checking in says they are HERE — on the shop's calendar day. (T28 L5)
    {
      const tz = await clock.salonTimezone(currentUser.companyId)
      const apptDay = calendarDateIn(new Date(existing.startTime), tz)
      if (apptDay > calendarDateIn(new Date(), tz)) {
        return fail(c, 409, `That appointment is on ${calendarDayWords(apptDay)}, not today — check the client in when they arrive.`, 'APPOINTMENT_NOT_TODAY')
      }
    }

    const [updated] = await db.update(appointment).set({ status: 'checked_in', checkedInAt: new Date(), updatedAt: new Date() }).where(eq(appointment.id, id)).returning()
    await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    live.emitToCompany(currentUser.companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, named(updated))
  })

  // DELETE — cancel, keeping the row so no-show and cancel rates stay measurable.
  app.delete('/:id', requirePermission('schedule:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing]: AppointmentRow[] = await db.select().from(appointment)
      .where(and(eq(appointment.id, id), eq(appointment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Appointment not found')
    { const own = await book.ownChairOf(currentUser); if (own && !isOwnChair(own, existing)) return notInBook(c) }

    const [updated] = await db.update(appointment).set({ status: 'cancelled', updatedAt: new Date(), ...(existing.status !== 'cancelled' ? { cancelledAt: new Date() } : {}) }).where(eq(appointment.id, id)).returning()
    // Cancelling from the book and from the list are the same act. (LY0928 M1)
    if (existing.status === 'completed') await onVisitUncompleted(updated)

    await audit.log({ action: 'update', entity: 'appointment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    live.emitToCompany(currentUser.companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
    return one(c, { success: true, appointment: updated })
  })

  return app
}
