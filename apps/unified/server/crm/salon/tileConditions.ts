// THE SALON'S HOME-SCREEN CONDITIONS — one definition for the dashboard's count and for the list the phone's tile opens.
//
// "Appointments today" counted the book's live rows in the shop's day; the Book's list could not ask for that (it took one
// status), so a tile reading 11 could open a list of 13 (the cancelled and no-shows). The condition lives here, the dashboard's
// count and `GET /api/appointments?tile=today` both call it. (apps/unified/tests/mobile-home-tiles.test.ts holds them equal.)
import { and, eq, gte, lt, notInArray } from 'drizzle-orm'

/** The filters `GET /api/appointments` accepts as `?tile=`. A value outside the list is refused, never answered as "empty". */
export const APPOINTMENT_TILES = ['today'] as const

/** Cancelled and no-show rows are not appointments the desk has to serve. (SALON-N9) */
export const LIVE_STATUSES = ['cancelled', 'no_show'] as const
export const liveAppointment = (appointment: any) => notInArray(appointment.status, [...LIVE_STATUSES])

/** The book for the shop's day `[today, tomorrow)` — live rows only. `today`/`tomorrow` come from the salon clock (days.ts). */
export const appointmentsTodayCondition = (appointment: any, today: Date, tomorrow: Date) =>
  and(gte(appointment.startTime, today), lt(appointment.startTime, tomorrow), liveAppointment(appointment))!

/** The filters `GET /api/memberships/enrollments` accepts as `?tile=`. */
export const MEMBERSHIP_TILES = ['active'] as const
/** "Members": enrolments that are active. The dashboard's count and `?tile=active` both call this. */
export const activeEnrollmentCondition = (enrollment: any) => eq(enrollment.status, 'active')
