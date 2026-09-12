// What this vertical does differently in the shared Online Booking page (see ./shared).
import type { BookingConfig } from './shared'

export const BOOKING: BookingConfig = { calendarLabel: 'Job', calendarPath: (id) => `/crm/jobs/${id}`, concurrentLabel: 'Techs bookable at once', concurrentHelp: 'How many service calls can start in the same time slot — the number of technicians taking online work. Calls scheduled from the office count too.' }
