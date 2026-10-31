// A client's online booking, in the salon's own book (VerticalSettings.booking.calendar 'chair'). The live salon CRM's
// booking landed as an appointment in The Book (templates/crm-salon/backend/src/routes/booking.ts: appointmentCalendar
// with contactColumn 'contactId', the behaviour in packages/tenant-backend/src/booking/calendars.ts). The unified engine
// had dropped it: an online booking sat in the Bookings list and never reached the stylist's book, so the chair looked
// free and the desk could sell the same time again (fix-h, "a confirmed booking shows on the schedule for every vertical
// that has both bookings and a schedule"). As with the vet's practice book (crm/vet/onlineBooking.ts), the booking row is
// the engine's and this writes the appointment beside it, in the same transaction.
//
// What follows the booking, and what doesn't: a move moves the appointment (time and stylist), a cancel or a no-show
// marks it so. Completing is the desk's — completing an appointment in The Book is the visit: it raises the sale, writes
// the visit record and awards loyalty (appointments.ts), which a status copied across would skip.
//
// What a client books is the Service Menu (salon live test, 2026-10-25). The menu's "Bookable online" box was read by
// nothing — the template's widget read it through a catalogue of its own (packages/tenant-backend booking/catalog.ts),
// which the move to the unified engine left behind — so /book offered the engine's own list (a provisioned
// "Consultation"), and an online booking reached The Book with no menu item: no price from the menu, no loyalty on the
// service, no rebooking reminder. Now each menu item ticked "Bookable online" IS a booking service: the menu's own writes
// keep its booking_service row (keepOnlineService, linked by service_menu_id), the engine offers only linked rows
// (BookingAddOn.serviceList), and a booking of one writes the appointment with that menu item. Linking a row rather than
// teaching the engine a second kind of service keeps every booking, deposit, buffer and reminder on the one table they
// already hang off; the menu stays the only place a service's name, length and price are changed.
import { and, eq, gt, gte, inArray, isNull, lt, ne, notExists, notInArray, or } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { findOff, offSpans } from './timeOff.ts'
import { readTeamOrder } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, bookBlock, booking, bookingService, company, contact, serviceMenu } from '../../db/schema/index.ts'
import { findStylistConflict } from './held.ts'
import { piecesOf } from './segments.ts'
import { calendarDateIn } from './days.ts'
import { lockAppointmentBook } from '../../data/salon.ts'
import { BookingError, slugify, type BookingAddOn } from '../../booking/engine.ts'
import { policyWords, type CardOnFile } from './cardOnFile.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import { createIntakeForms } from './intakeForms.ts'
import { offeredServiceId, patchTestHold, ruleOnFor, settingsOf, stateFor, stylistPickOn, stylistRequiredOn } from './patchTest.ts'

/** The list a salon's online booking is, in the words the refusals and Booking settings use. */
export const SERVICE_LIST = 'Service Menu'

type MenuItem = typeof serviceMenu.$inferSelect

/**
 * The menu item's booking service, kept in step by every write to the menu (crm/salon/serviceMenu.ts), in the same
 * transaction: ticked "Bookable online" and on the menu, it is offered with the menu's name, description, length and
 * price (and whether that price is a "from" price); unticked or taken off the menu, it is switched off — never deleted, so a booking already made keeps its service
 * and its time. Its address (/book/<slug>) is made once from the name and kept: a link a client saved still works after
 * a rename. The rebook interval stays the menu's (the salon's Rebooking reads it), so the engine's own rebook email is
 * never set here — one client, one reminder.
 */
export async function keepOnlineService(exec: any, m: MenuItem) {
  const offered = m.bookableOnline && m.active
  const values = { name: m.name, description: m.description ?? null, durationMinutes: m.durationMin, price: m.price ?? null, priceIsFrom: m.priceIsFrom, rebookIntervalDays: null, active: offered, updatedAt: new Date() }
  const [linked] = await exec.select({ id: bookingService.id }).from(bookingService).where(and(eq(bookingService.companyId, m.companyId), eq(bookingService.serviceMenuId, m.id))).limit(1)
  if (linked) { await exec.update(bookingService).set(values).where(eq(bookingService.id, linked.id)); return }
  if (!offered) return
  const base = slugify(m.name) || 'service'
  const [taken] = await exec.select({ id: bookingService.id }).from(bookingService).where(and(eq(bookingService.companyId, m.companyId), eq(bookingService.slug, base))).limit(1)
  await exec.insert(bookingService).values({ companyId: m.companyId, serviceMenuId: m.id, slug: taken ? `${base.slice(0, 50)}-${m.id.slice(0, 8).toLowerCase()}` : base, ...values })
}

/**
 * A new salon that takes bookings starts with one menu item a client can book — a 30-minute Consultation, on the menu
 * and offered online — rather than a booking-only service the menu never shows (modules/provision.ts startingBookings).
 */
export async function startingMenuService(tx: any, companyId: string) {
  const [m] = await tx.insert(serviceMenu).values({ companyId, name: 'Consultation', category: 'other', durationMin: 30, bookableOnline: true }).returning()
  await keepOnlineService(tx, m)
}

/** Appointments that no longer hold the chair (appointments.ts CANCELLED). */
const INACTIVE = ['cancelled', 'no_show']
/** An appointment saved without an end holds an hour (appointments.ts overlaps). */
const DEFAULT_MINUTES = 60

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

export function createChairBooking(opts: { cards?: () => CardOnFile | null; isFeatureEnabled?: (companyId: string, feature: string) => Promise<boolean>; db?: any } = {}): BookingAddOn {
  return {
    questions: [],
    serviceList: { name: SERVICE_LIST },

    // Clients choose their stylist (Settings › The Book; the feature `client_stylist_pick`): off unless the salon switched it on.
    // The salon's intake and consent forms, offered on the booking's page (feature `intake_forms`); none until the salon builds one.
    forms: opts.db ? (() => {
      const kept = createIntakeForms({ db: opts.db })
      const on = async (companyId: string) => !!opts.isFeatureEnabled && await opts.isFeatureEnabled(companyId, 'intake_forms')
      return {
        async pending(a: { companyId: string; contactId: string; serviceMenuId: string | null }) {
          return (await on(a.companyId)) ? (await kept.pending(a.companyId, a.contactId, a.serviceMenuId)).map((f) => ({ id: f.id, name: f.name, kind: f.kind, intro: f.intro, questions: f.questions as any[] })) : []
        },
        async submit(a: { companyId: string; contactId: string; serviceMenuId: string | null; token: string }, formId: string, answers: Record<string, unknown>, signedName: string) {
          return (await on(a.companyId)) ? kept.submit(a, formId, answers, signedName) : 'Forms are not available.'
        },
      }
    })() : undefined,

    people: {
      async enabled(companyId) {
        if (!opts.db || !opts.isFeatureEnabled || !(await opts.isFeatureEnabled(companyId, 'client_stylist_pick'))) return false
        return stylistPickOn(await settingsOf(opts.db, companyId))
      },
      // The salon's own team order (Settings › The Book › Team order): the stylists a client may choose between follow it.
      async order(companyId) { return opts.db ? readTeamOrder(await settingsOf(opts.db, companyId)) : [] },
      // "Choice required": the client must pick a named stylist; "anyone" is not offered (Settings › The Book).
      async required(companyId) {
        if (!opts.db || !opts.isFeatureEnabled || !(await opts.isFeatureEnabled(companyId, 'client_stylist_pick'))) return false
        return stylistRequiredOn(await settingsOf(opts.db, companyId))
      },
    },

    // The salon's card step at online booking (Settings › Card on file: who is asked — nobody by default). A customer who must leave
    // a card has their time held, like a deposit's, until Stripe's own page has kept it on the salon's own account.
    card: {
      async needed({ companyId, email }) {
        const cards = opts.cards?.()
        if (!cards || !opts.isFeatureEnabled || !(await opts.isFeatureEnabled(companyId, 'card_on_file'))) return false
        const policy = await cards.policyOf(companyId)
        if (policy.cardRequirement === 'off') return false
        if (!(await cards.connectedAccount(companyId))) return false
        const [known] = await cards.db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, companyId), eq(contact.email, email))).limit(1)
        if (known) {
          if ((await cards.cardsOf(companyId, known.id)).length) return false
          if (policy.cardRequirement === 'new_clients') {
            const [seen] = await cards.db.select({ id: appointment.id }).from(appointment).where(and(eq(appointment.companyId, companyId), eq(appointment.contactId, known.id), notInArray(appointment.status, INACTIVE))).limit(1)
            if (seen) return false
          }
        }
        return true
      },
      async terms(companyId) {
        const cards = opts.cards?.()
        return cards ? policyWords(await cards.policyOf(companyId)) : ''
      },
      async page({ companyId, contactId, token }) {
        const cards = opts.cards?.()
        if (!cards) return null
        const made = await cards.startSetup(companyId, contactId, 'client_online', null, `${siteOrigin()}/booking/${token}?card=saved`, { booking_token: token })
        return made?.url ?? null
      },
    },

    async booked(tx, { companyId, contactId, booking: b, service, by }) {
      // A service that needs a patch test is not bookable ONLINE without a passing one on record, when the salon asked for that
      // rule (patchTest.ts); the desk books it with a reason instead (appointments.ts).
      if (by === 'customer' && service.serviceMenuId) {
        const [menu] = await tx.select({ requiresPatchTest: serviceMenu.requiresPatchTest, name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, service.serviceMenuId)).limit(1)
        if (menu?.requiresPatchTest && (await ruleOnFor(tx, companyId))) {
          const [zone] = await tx.select({ tz: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1)
          const hold = patchTestHold((await stateFor(tx, contactId, calendarDateIn(new Date(), zone?.tz || 'UTC'))).state, menu.name || service.name || '')
          if (hold) {
            // Owner's decision 2026-10-30: when the salon has named its patch-test appointment, the client is offered THAT to book
            // first (and the colour after it has passed) instead of being turned away; without one they are asked to call.
            const offerId = offeredServiceId(await settingsOf(tx, companyId))
            const [offer] = offerId && offerId !== service.serviceMenuId
              ? await tx.select({ slug: bookingService.slug, name: bookingService.name }).from(bookingService)
                .where(and(eq(bookingService.companyId, companyId), eq(bookingService.serviceMenuId, offerId), eq(bookingService.active, true))).limit(1)
              : []
            if (offer) throw new BookingError(`${hold} Book a patch test first — you can book this once it has passed.`, 409, 'patch_test', { offerSlug: offer.slug, offerName: offer.name })
            throw new BookingError(`${hold} Please call us to arrange a patch test, then book.`, 409, 'patch_test')
          }
        }
      }
      // The Book's own lock, so a desk appointment being saved this moment and this booking can't both take the chair
      // (appointments.ts takes it around every create and move).
      await lockAppointmentBook(tx, companyId)
      // The service's own processing gap, as the menu says (processing time): the colourist is free in it, so the booking holds
      // only the hands-on parts of its time — here, and in the clash check against the Book (held.ts).
      let proc: { afterMin: number; min: number } | null = null
      if (service.serviceMenuId) {
        const [m] = await tx.select({ a: serviceMenu.processingAfterMin, m: serviceMenu.processingMin }).from(serviceMenu).where(eq(serviceMenu.id, service.serviceMenuId)).limit(1)
        if (m?.m && m.m > 0) proc = { afterMin: m.a ?? 0, min: m.m }
      }
      if (b.assignedUserId) {
        if (await findStylistConflict(tx, companyId, { stylistId: b.assignedUserId, stylistMemberId: null }, b.startAt, b.endAt, undefined, proc)) throw new BookingError('That time has just been taken — please pick another.', 409, 'taken')
        // Time the salon has blocked off (lunch, training): this stylist's, or everybody's.
        const [blocked] = await tx.select({ id: bookBlock.id }).from(bookBlock).where(and(
          eq(bookBlock.companyId, companyId), or(eq(bookBlock.stylistId, b.assignedUserId), and(isNull(bookBlock.stylistId), isNull(bookBlock.stylistMemberId))),
          lt(bookBlock.startTime, b.endAt), gt(bookBlock.endTime, b.startAt))).limit(1)
        if (blocked) throw new BookingError('That time has just been taken — please pick another.', 409, 'taken')
        // A day off or a closed day (timeOff.ts): the same, and the client is never told why.
        if (await findOff(tx, companyId, [{ stylist: { stylistId: b.assignedUserId, stylistMemberId: null }, start: b.startAt, end: b.endAt }])) throw new BookingError('That time has just been taken — please pick another.', 409, 'taken')
      }
      // The name typed is kept on the appointment when the client record (found by email) carries another (Vet T12 L11).
      const [owner] = await tx.select({ name: contact.name }).from(contact).where(eq(contact.id, contactId)).limit(1)
      const accountName = String(owner?.name || '').trim()
      const bookedBy = accountName && b.customerName && !sameName(accountName, b.customerName) ? `Booked by ${b.customerName} (client: ${accountName})` : ''
      const said = [bookedBy, b.customerNotes].filter(Boolean).join(' — ')
      const [appt] = await tx.insert(appointment).values({
        id: createId(), companyId, contactId,
        stylistId: b.assignedUserId ?? null,
        // The menu item booked (keepOnlineService): the visit's sale, its loyalty and the client's rebooking date all
        // read it (appointments.ts, loyaltyAward.ts, rebookingDue.ts). A booking made before its service was on the menu
        // has none, as before.
        serviceId: service.serviceMenuId ?? null,
        status: 'scheduled',
        // Its length is the menu's (the booking's end is the service's duration), and its price the one quoted online —
        // the menu's at the moment of booking. The name stays on the notes as booked, should the menu item be renamed.
        startTime: b.startAt, endTime: b.endAt,
        processingAfterMin: proc?.afterMin ?? null, processingMin: proc?.min ?? null,
        quotedPrice: service.price != null && Number(service.price) > 0 ? String(service.price) : null,
        notes: `Online booking: ${service.name || 'service'}${said ? ' — ' + said : ''}`,
      }).returning({ id: appointment.id })
      return { appointmentId: appt.id }
    },

    async changed(exec, b, change) {
      if (!b.appointmentId) return
      const own = and(eq(appointment.id, b.appointmentId), eq(appointment.companyId, b.companyId), notInArray(appointment.status, ['completed', 'in_chair', 'checked_in']))
      if (change === 'moved') await exec.update(appointment).set({ startTime: b.startAt, endTime: b.endAt, stylistId: b.assignedUserId ?? null, updatedAt: new Date() }).where(own)
      else if (b.status === 'cancelled' || b.status === 'no_show') await exec.update(appointment).set({ status: b.status, updatedAt: new Date(), ...(b.status === 'cancelled' ? { cancelledAt: b.cancelledAt ?? new Date() } : {}) }).where(own)
    },

    // The Book's own appointments hold their time online, as the template's did (calendars.ts busy): the stylist's time
    // when one is named, everybody's when not. An appointment a booking made is that booking's time already.
    async busy(exec, companyId, from, to) {
      const out: Array<{ userId: string | null; start: Date; end: Date }> = []
      const rows = await exec.select({ id: appointment.id, start: appointment.startTime, end: appointment.endTime, stylistId: appointment.stylistId, memberId: appointment.stylistMemberId, pa: appointment.processingAfterMin, pm: appointment.processingMin }).from(appointment)
        .where(and(
          eq(appointment.companyId, companyId),
          gte(appointment.startTime, new Date(from.getTime() - 24 * 3_600_000)), lt(appointment.startTime, to),
          notInArray(appointment.status, INACTIVE),
          notExists(exec.select({ id: booking.id }).from(booking).where(and(eq(booking.appointmentId, appointment.id), ne(booking.status, 'cancelled')))),
        ))
      // A visit with several services holds each stylist only for the services they do.
      const itemised = rows.length ? await exec.select({ appointmentId: appointmentItem.appointmentId, stylistId: appointmentItem.stylistId, offset: appointmentItem.startOffsetMin, minutes: appointmentItem.durationMin, pa: appointmentItem.processingAfterMin, pm: appointmentItem.processingMin }).from(appointmentItem).where(inArray(appointmentItem.appointmentId, rows.map((r: any) => r.id))) : []
      const hasItems = new Set<string>(itemised.map((i: any) => i.appointmentId))
      const push = (userId: string | null, startMs: number, endMs: number, p: { afterMin: number | null; min: number | null } | null) => {
        for (const piece of piecesOf(startMs, endMs, p)) out.push({ userId, start: new Date(piece.start), end: new Date(piece.end) })
      }
      // A chair-only stylist (a roster member, no login) is never offered online, so their appointment takes nobody's
      // online time; one with no stylist at all takes everybody's, as the vet's unassigned appointment does.
      for (const r of rows) {
        if (hasItems.has(r.id) || !(r.stylistId || !r.memberId)) continue
        const start = new Date(r.start).getTime()
        push(r.stylistId ?? null, start, r.end ? new Date(r.end).getTime() : start + DEFAULT_MINUTES * 60_000, { afterMin: r.pa, min: r.pm })
      }
      for (const it of itemised) {
        const r = rows.find((x: any) => x.id === it.appointmentId)
        if (!r || !it.stylistId) continue
        const start = new Date(r.start).getTime() + it.offset * 60_000
        push(it.stylistId, start, start + it.minutes * 60_000, { afterMin: it.pa, min: it.pm })
      }
      // Blocked time (lunch, training): the stylist's, or everybody's when no stylist is named.
      const blocks = await exec.select({ stylistId: bookBlock.stylistId, memberId: bookBlock.stylistMemberId, start: bookBlock.startTime, end: bookBlock.endTime }).from(bookBlock)
        .where(and(eq(bookBlock.companyId, companyId), lt(bookBlock.startTime, to), gt(bookBlock.endTime, from)))
      for (const k of blocks) if (k.stylistId || !k.memberId) out.push({ userId: k.stylistId ?? null, start: new Date(k.start), end: new Date(k.end) })
      // Approved time off and closed days (timeOff.ts): a stylist's, or everybody's.
      for (const o of await offSpans(exec, companyId, from, to)) if (o.stylistId || !o.stylistMemberId) out.push({ userId: o.stylistId ?? null, start: o.start, end: o.end })
      return out
    },
  }
}
