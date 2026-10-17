// What this vertical does differently in the shared Online Booking page (see ./shared).
import type { BookingConfig } from './shared'

// The wording was crm-fieldservice's — "Techs bookable at once", "service calls", "technicians" —
// on a template shared by gyms, yoga studios, photographers, food trucks and general small
// businesses. None of them dispatch a technician. (T42)
export const BOOKING: BookingConfig = { calendarLabel: 'Job', calendarPath: (id) => `/crm/jobs/${id}`, concurrentLabel: 'Bookings at the same time', concurrentHelp: 'How many appointments can start in the same slot — the number of people, rooms or stations able to take one. Anything booked from the office counts too.' }
