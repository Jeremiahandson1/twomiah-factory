// What this vertical does differently in the shared Online Booking page (see ./shared).
import type { BookingConfig } from './shared'

export const BOOKING: BookingConfig = { calendarLabel: 'Job', calendarPath: (id) => `/crm/jobs/${id}`, concurrentLabel: 'Bookings per time slot', concurrentHelp: 'How many online bookings one time slot can take. Jobs scheduled from the office count too.' }
