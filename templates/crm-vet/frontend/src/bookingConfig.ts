// What this vertical does differently in the shared Online Booking page (see ./shared).
import type { BookingConfig } from './shared'

export const BOOKING: BookingConfig = { calendarLabel: 'Appointment', calendarPath: () => '/crm/appointments', concurrentLabel: 'Rooms bookable at once', concurrentHelp: 'Online bookings per time slot — the number of exam rooms or providers taking online appointments. Front-desk appointments count too.' }
