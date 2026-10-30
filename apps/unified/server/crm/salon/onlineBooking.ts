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
import { and, eq, gte, lt, lte, ne, notExists, notInArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { appointment, booking, bookingService, contact, serviceMenu } from '../../db/schema/index.ts'
import { lockAppointmentBook } from '../../data/salon.ts'
import { BookingError, slugify, type BookingAddOn } from '../../booking/engine.ts'
import { patchTestHold, ruleOnFor, stateFor } from './patchTest.ts'

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

export function createChairBooking(): BookingAddOn {
  return {
    questions: [],
    serviceList: { name: SERVICE_LIST },

    async booked(tx, { companyId, contactId, booking: b, service, by }) {
      // A service that needs a patch test is not bookable ONLINE without a passing one on record, when the salon asked for that
      // rule (patchTest.ts); the desk books it with a reason instead (appointments.ts).
      if (by === 'customer' && service.serviceMenuId) {
        const [menu] = await tx.select({ requiresPatchTest: serviceMenu.requiresPatchTest, name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, service.serviceMenuId)).limit(1)
        if (menu?.requiresPatchTest && (await ruleOnFor(tx, companyId))) {
          const hold = patchTestHold((await stateFor(tx, contactId, new Date().toISOString().slice(0, 10))).state, menu.name || service.name || '')
          if (hold) throw new BookingError(`${hold} Please call us to arrange a patch test, then book.`, 409, 'patch_test')
        }
      }
      // The Book's own lock, so a desk appointment being saved this moment and this booking can't both take the chair
      // (appointments.ts takes it around every create and move).
      await lockAppointmentBook(tx, companyId)
      if (b.assignedUserId) {
        const rows = await tx.select({ start: appointment.startTime, end: appointment.endTime, status: appointment.status }).from(appointment)
          .where(and(eq(appointment.companyId, companyId), eq(appointment.stylistId, b.assignedUserId), lte(appointment.startTime, b.endAt), gte(appointment.startTime, new Date(b.startAt.getTime() - 86_400_000))))
        const clash = rows.find((r: any) => !INACTIVE.includes(r.status) && new Date(r.start) < b.endAt && (r.end ? new Date(r.end) : new Date(new Date(r.start).getTime() + DEFAULT_MINUTES * 60_000)) > b.startAt)
        if (clash) throw new BookingError('That time has just been taken — please pick another.', 409, 'taken')
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
      const rows = await exec.select({ start: appointment.startTime, end: appointment.endTime, stylistId: appointment.stylistId, memberId: appointment.stylistMemberId }).from(appointment)
        .where(and(
          eq(appointment.companyId, companyId),
          gte(appointment.startTime, new Date(from.getTime() - 24 * 3_600_000)), lt(appointment.startTime, to),
          notInArray(appointment.status, INACTIVE),
          notExists(exec.select({ id: booking.id }).from(booking).where(and(eq(booking.appointmentId, appointment.id), ne(booking.status, 'cancelled')))),
        ))
      // A chair-only stylist (a roster member, no login) is never offered online, so their appointment takes nobody's
      // online time; one with no stylist at all takes everybody's, as the vet's unassigned appointment does.
      return rows.filter((r: any) => r.stylistId || !r.memberId).map((r: any) => {
        const start = new Date(r.start)
        return { userId: r.stylistId ?? null, start, end: r.end ? new Date(r.end) : new Date(start.getTime() + DEFAULT_MINUTES * 60_000) }
      })
    },
  }
}
