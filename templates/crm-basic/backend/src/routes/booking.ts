// Online booking — shared implementation (packages/tenant-backend/src/booking), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables, the calendar a booking lands on
// and its notification/deposit services in; behaviour lives in one place for every CRM.
import { createBookingRoutes, jobCalendar } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, contact, bookingSettings, bookableService, onlineBooking, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { sendRaw } from '../services/email.ts'
import { sendSMS } from '../services/sms.ts'

export default createBookingRoutes({
  db,
  tables: { company, contact, bookingSettings, bookableService, onlineBooking },
  authenticate,
  // Configuring booking (hours, notice, on/off, which services) needs company:update — it is company
  // setup, not day-to-day work. It used to be anyone with a login (Salon T28 H1), then anyone from
  // manager up, which left a manager the one company switch they are refused everywhere else (T30 M-R2).
  requirePermission,
  calendar: jobCalendar(job),
  options: {
    /**
     * A STUDIO DOES NOT COME TO YOUR HOUSE. (T42, showcase HIGH)
     *
     * `requireAddress` is what the shared booking widget asks for because the trades show up at an
     * address — its own type comment says so. This template serves showcase (gyms, yoga studios,
     * wedding services, photographers), foodtruck and basic, and every one of those takes the booking
     * at its OWN premises. A customer booking a strength session was made to type a street address
     * before the form would submit.
     *
     * It stays a per-tenant setting (Online Booking › settings), so a tenant that genuinely travels
     * can switch it back on; what changes is the answer this template ships with.
     */
    requireAddress: false,
    contactType: 'lead',
    notify: {
      email: ({ to, subject, html }) => sendRaw({ to, subject, html }),
      sms: (companyId, { toPhone, message }) => sendSMS(companyId, { toPhone, message }),
    },
    createDepositIntent: (args) => import('../services/stripe.ts').then(m => m.createBookingDepositIntent(args)),
  },
})
