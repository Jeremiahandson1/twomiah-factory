// Online booking — shared implementation (packages/tenant-backend/src/booking), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables, the calendar a booking lands on
// and its notification/deposit services in; behaviour lives in one place for every CRM.
import { createBookingRoutes, appointmentCalendar } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, contact, bookingSettings, bookableService, onlineBooking, appointment, patient } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import { SPECIES, SPECIES_FALLBACK } from '../config/species.ts'
import { sendRaw } from '../services/email.ts'
import { sendSMS } from '../services/sms.ts'

export default createBookingRoutes({
  db,
  tables: { company, contact, bookingSettings, bookableService, onlineBooking },
  authenticate,
  // Configuring booking (hours, notice, on/off, which services) is manager-and-up. It used to be
  // anyone with a login. (Salon T28 H1)
  requireRole,
  calendar: appointmentCalendar(appointment, {
    contactColumn: 'ownerId', reasonColumn: 'reason', defaults: { type: 'wellness' },
    // Public booking captures the pet → create a linked patient chart so the visit isn't ownerless.
    // The widget's species box is free text; the chart is an enum. Normalise to the SAME vocabulary /api/patients
    // enforces, so "Cat" and "Kitty" don't land as species nothing else recognises. (T12 H5/L9)
    patient: { table: patient, ownerColumn: 'ownerId', linkColumn: 'patientId', nameColumn: 'name', speciesColumn: 'species', species: { allowed: SPECIES, fallback: SPECIES_FALLBACK }, notesColumn: 'notes' },
  }),
  options: {
    requireAddress: false,
    contactType: 'client',
    requirePet: true,
    notify: {
      email: ({ to, subject, html }) => sendRaw({ to, subject, html }),
      sms: (companyId, { toPhone, message }) => sendSMS(companyId, { toPhone, message }),
    },
    createDepositIntent: (args) => import('../services/stripe.ts').then(m => m.createBookingDepositIntent(args)),
  },
})
