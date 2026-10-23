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
import { and, eq, gte, lt, lte, ne, notExists, notInArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { appointment, booking, contact } from '../../db/schema/index.ts'
import { lockAppointmentBook } from '../../data/salon.ts'
import { BookingError, type BookingAddOn } from '../../booking/engine.ts'

/** Appointments that no longer hold the chair (appointments.ts CANCELLED). */
const INACTIVE = ['cancelled', 'no_show']
/** An appointment saved without an end holds an hour (appointments.ts overlaps). */
const DEFAULT_MINUTES = 60

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

export function createChairBooking(): BookingAddOn {
  return {
    questions: [],

    async booked(tx, { companyId, contactId, booking: b, service }) {
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
        status: 'scheduled',
        startTime: b.startAt, endTime: b.endAt,
        // The online service isn't a Service Menu row; its price is what was quoted, and its name is on the notes.
        quotedPrice: service.price != null && Number(service.price) > 0 ? String(service.price) : null,
        notes: `Online booking: ${service.name || 'service'}${said ? ' — ' + said : ''}`,
      }).returning({ id: appointment.id })
      return { appointmentId: appt.id }
    },

    async changed(exec, b, change) {
      if (!b.appointmentId) return
      const own = and(eq(appointment.id, b.appointmentId), eq(appointment.companyId, b.companyId), notInArray(appointment.status, ['completed', 'in_chair', 'checked_in']))
      if (change === 'moved') await exec.update(appointment).set({ startTime: b.startAt, endTime: b.endAt, stylistId: b.assignedUserId ?? null, updatedAt: new Date() }).where(own)
      else if (b.status === 'cancelled' || b.status === 'no_show') await exec.update(appointment).set({ status: b.status, updatedAt: new Date() }).where(own)
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
