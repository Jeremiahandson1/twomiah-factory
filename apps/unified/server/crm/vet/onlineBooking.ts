// A pet owner's online booking, in the practice's own records (VerticalSettings.booking.calendar 'practice'). The live
// vet CRM's booking landed as an appointment under the owner with a patient chart made from the pet the form asked for
// (templates/crm-vet/backend/src/routes/booking.ts: appointmentCalendar + requirePet; the behaviour in
// packages/tenant-backend/src/booking/calendars.ts and service.ts). Here the booking row is the engine's, and this
// writes the chart and the appointment beside it, in the same transaction.
//
// One change from the template: it made a NEW chart on every booking, so an owner booking Bella twice had two Bellas.
// The chart is found again by the owner and the pet's name (case and spacing ignored); a pet marked deceased is not
// reused, so a new pet given an old name gets its own chart.
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { normaliseSpecies } from '@twomiah/tenant-backend'
import { appointment, contact, patient } from '../../db/schema/index.ts'
import type { BookingAddOn } from '../../booking/engine.ts'
import { SPECIES, SPECIES_FALLBACK } from './species.ts'

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

export function createPracticeBooking(opts: { requirePet: boolean }): BookingAddOn {
  return {
    // The live widget's two questions (templates/crm-vet/frontend/public/booking-widget.js), and its limits
    // (packages/tenant-backend booking/routes.ts: petName 120, petSpecies 80).
    questions: [
      { name: 'petName', label: "Pet's name", placeholder: 'e.g. Bella', maxLength: 120, ...(opts.requirePet ? { requiredMessage: "The pet's name is required." } : {}) },
      { name: 'petSpecies', label: 'Species (optional)', placeholder: 'Dog, cat, …', maxLength: 80 },
    ],

    async booked(tx, { companyId, contactId, booking, service, answers }) {
      let patientId: string | null = null
      const petName = answers.petName
      if (petName) {
        const charts = await tx.select({ id: patient.id, name: patient.name, deceased: patient.deceased }).from(patient)
          .where(and(eq(patient.companyId, companyId), eq(patient.ownerId, contactId)))
        const found = charts.find((p: any) => !p.deceased && sameName(p.name, petName))
        if (found) patientId = found.id
        else {
          // The species box is free text; the chart takes the practice's vocabulary, and an answer that can't be placed
          // is kept on the chart's notes (Vet T12 H5/L9). Unanswered is "other": a chart never claims a dog it wasn't told of.
          const typed = answers.petSpecies ?? ''
          const species = normaliseSpecies(typed, { allowed: SPECIES, fallback: SPECIES_FALLBACK })
          const notes = typed && species === SPECIES_FALLBACK && typed.toLowerCase() !== SPECIES_FALLBACK ? `Species as booked: "${typed}"` : null
          const [made] = await tx.insert(patient).values({ id: createId(), companyId, ownerId: contactId, name: petName, species, notes }).returning({ id: patient.id })
          patientId = made.id
        }
      }
      // Somebody booking under a household's shared email typed a name the owner's record doesn't carry: the record is
      // not overwritten, but the name typed is kept on the appointment (Vet T12 L11).
      const [owner] = await tx.select({ name: contact.name }).from(contact).where(eq(contact.id, contactId)).limit(1)
      const accountName = String(owner?.name || '').trim()
      const bookedBy = accountName && booking.customerName && !sameName(accountName, booking.customerName) ? `Booked by ${booking.customerName} (account: ${accountName})` : ''
      const said = [bookedBy, booking.customerNotes].filter(Boolean).join(' — ')
      await tx.insert(appointment).values({
        id: createId(), companyId,
        ownerId: contactId, patientId,
        providerId: booking.assignedUserId ?? null,
        type: 'wellness', status: 'scheduled',
        reason: service.name || 'Online booking',
        startTime: booking.startAt, endTime: booking.endAt,
        notes: `Online booking: ${service.name || 'service'}${said ? ' — ' + said : ''}`,
      })
    },
  }
}
