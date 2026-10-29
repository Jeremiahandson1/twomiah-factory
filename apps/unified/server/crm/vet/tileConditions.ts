// THE PRACTICE'S HOME-SCREEN CONDITIONS — one definition for the dashboard's count and for the list the phone's tile opens.
//
// Three tiles read differently from their lists: "Appointments today" counted the SERVER's midnight while the book listed
// the clinic's day (and the book could not hide cancelled / no-show); "Due in 30 days" counted "before today + 30" while the
// recall list ran "up to today + 30"; and the vaccine count de-duplicated renewed shots in SQL while the list did it in
// JavaScript. Each condition is written once, here; the dashboard's stats and `?tile=` on the list route both call it.
// (apps/unified/tests/store-vet-tiles.test.ts holds count and list equal, with rows that must NOT count.)
import { and, eq, gte, isNotNull, lt, lte, notInArray, sql } from 'drizzle-orm'

/** The filters `GET /api/appointments` accepts as `?tile=`. A value outside the list is refused, never answered as "empty". */
export const APPOINTMENT_TILES = ['today'] as const
/** The filters `GET /api/patients` accepts as `?tile=`. */
export const PATIENT_TILES = ['active'] as const
/** The filters `GET /api/reminders/due` accepts as `?tile=` ("Vaccines overdue", "Due in 30 days"). */
export const REMINDER_TILES = ['overdue', 'due_soon'] as const

/** A cancelled or no-show slot is not work the practice still has to do. (T12 M3) */
export const INACTIVE_APPT = ['cancelled', 'no_show'] as const
/** "Due soon" is the next 30 days, today and the 30th day both in. */
export const DUE_SOON_DAYS = 30

/** The clinic's day `[start, end)`, live rows only. `start`/`end` are the clinic's own day (companyTimeZone + storeDayRange). */
export const appointmentsTodayCondition = (appointment: any, start: Date, end: Date) =>
  and(gte(appointment.startTime, start), lt(appointment.startTime, end), notInArray(appointment.status, [...INACTIVE_APPT]))!

/** "Active patients": living ones. */
export const activePatientCondition = (patient: any) => eq(patient.deceased, false)

/** A YYYY-MM-DD plus whole days, on the calendar (no clock involved). */
export const addDays = (day: string, n: number) => { const t = new Date(`${day}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

/**
 * The vaccinations that count: the LATEST administration (with a due date) per (patient, vaccine), of a living patient — a
 * renewed shot's old row does not nag. DISTINCT ON has no builder form; ties on the given date settle on the id.
 */
export const latestDueVaccinationCondition = (vaccination: any, companyId: string) => sql`${vaccination.id} in (
  select distinct on (v.patient_id, lower(v.vaccine)) v.id
  from vaccination v join patient p on p.id = v.patient_id
  where v.company_id = ${companyId} and v.due_date is not null and p.deceased = false
  order by v.patient_id, lower(v.vaccine), v.given_date desc nulls last, v.id
)`

/**
 * Vaccinations by the clinic's `today` (YYYY-MM-DD):
 *   overdue  → due before today
 *   due_soon → due today up to today + 30 days
 *   by       → due on or before `cutoff` (the recall list's own window, overdue included)
 */
export function dueVaccinationCondition(vaccination: any, companyId: string, today: string, which: 'overdue' | 'due_soon' | { by: string }) {
  const window = which === 'overdue' ? lt(vaccination.dueDate, today)
    : which === 'due_soon' ? and(gte(vaccination.dueDate, today), lte(vaccination.dueDate, addDays(today, DUE_SOON_DAYS)))!
    : lte(vaccination.dueDate, which.by)
  return and(eq(vaccination.companyId, companyId), isNotNull(vaccination.dueDate), latestDueVaccinationCondition(vaccination, companyId), window)!
}
