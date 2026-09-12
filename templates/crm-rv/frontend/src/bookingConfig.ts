// What this vertical does differently in the shared Online Booking page (see ./shared).
import type { BookingConfig } from './shared'

export const BOOKING: BookingConfig = { calendarLabel: 'Job', calendarPath: (id) => `/crm/jobs/${id}`, concurrentLabel: 'Bays bookable at once', concurrentHelp: 'How many service jobs can start in the same time slot — the number of bays taking online work. Jobs scheduled from the office count too.' }
