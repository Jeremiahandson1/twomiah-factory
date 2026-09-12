// What this vertical does differently in the shared Online Booking page (see ./shared).
import type { BookingConfig } from './shared'

export const BOOKING: BookingConfig = { calendarLabel: 'Appointment', calendarPath: () => '/crm/appointments', serviceMenuPath: '/crm/service-menu', concurrentLabel: 'Chairs bookable at once', concurrentHelp: 'Online bookings per time slot — the number of stylists taking online clients. Desk bookings count too.' }
