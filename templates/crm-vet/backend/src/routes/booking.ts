// Online booking — shared implementation (packages/tenant-backend/src/booking), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables, the calendar a booking lands on
// and its notification/deposit services in; behaviour lives in one place for every CRM.
import { createBookingRoutes, appointmentCalendar } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, contact, bookingSettings, bookableService, onlineBooking, appointment, patient } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { sendRaw } from '../services/email.ts'
import { sendSMS } from '../services/sms.ts'

export default createBookingRoutes({
  db,
  tables: { company, contact, bookingSettings, bookableService, onlineBooking },
  authenticate,
  calendar: appointmentCalendar(appointment, {
    contactColumn: 'ownerId', reasonColumn: 'reason', defaults: { type: 'wellness' },
    // Public booking captures the pet → create a linked patient chart so the visit isn't ownerless.
    patient: { table: patient, ownerColumn: 'ownerId', linkColumn: 'patientId', nameColumn: 'name', speciesColumn: 'species' },
  }),
  options: {
    requireAddress: false,
    contactType: 'client',
    notify: {
      email: ({ to, subject, html }) => sendRaw({ to, subject, html }),
      sms: (companyId, { toPhone, message }) => sendSMS(companyId, { toPhone, message }),
    },
    createDepositIntent: (args) => import('../services/stripe.ts').then(m => m.createBookingDepositIntent(args)),
  },
})
