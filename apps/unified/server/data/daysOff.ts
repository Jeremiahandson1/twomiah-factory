// THE BUSINESS'S DAYS OFF — holidays and other whole days the business is closed (parity tier 2, 11/10: Buildertrend's workday
// exceptions, ServiceTitan's holidays). One calendar for every trade: the rows online booking already keeps in booking_blackout
// with no person and no times (a whole day, for everyone). Online booking reads them as it always did; now the job check
// (techAvailability.checkAvailability — "Check before you book", and each visit of a repeating series), Find a time, the
// Dispatch Board and a maintenance plan's visits read them too. A person's own time off stays theirs (tech_time_off, and a
// booking_blackout row WITH a person); only the whole business's days are here.
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import { bookingBlackout } from '../db/schema/index.ts'

export interface DayOff { id: string; date: string; reason: string | null }

const DAY_MS = 86_400_000
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const wholeBusiness = (companyId: string) => [eq(bookingBlackout.companyId, companyId), isNull(bookingBlackout.userId), isNull(bookingBlackout.startMinute), isNull(bookingBlackout.endMinute)]

/** The business's whole days off from `from` to `to` (YYYY-MM-DD, both included), soonest first. */
export async function daysOffBetween(exec: any, companyId: string, from: string, to: string): Promise<DayOff[]> {
  const rows = await exec.select({ id: bookingBlackout.id, date: bookingBlackout.date, reason: bookingBlackout.reason }).from(bookingBlackout)
    .where(and(...wholeBusiness(companyId), gte(bookingBlackout.date, from), lte(bookingBlackout.date, to))).orderBy(asc(bookingBlackout.date))
  return rows as DayOff[]
}

/** The day off on `day`, or null when the business is open. */
export async function dayOffOn(exec: any, companyId: string, day: string): Promise<DayOff | null> {
  return (await daysOffBetween(exec, companyId, day, day))[0] ?? null
}

/** `day`, or the first day after it the business is open (looked at up to `within` days on; past that, `day` as it was). */
export async function nextOpenDay(exec: any, companyId: string, day: string, within = 30): Promise<string> {
  const closed = new Set((await daysOffBetween(exec, companyId, day, addDays(day, within))).map((d) => d.date))
  for (let k = day, i = 0; i <= within; i++, k = addDays(k, 1)) if (!closed.has(k)) return k
  return day
}

/** Add a whole day off for the business. One a day: the same day again answers the one already there. */
export async function addDayOff(exec: any, companyId: string, day: string, reason: string | null): Promise<DayOff> {
  const there = await dayOffOn(exec, companyId, day)
  if (there) return there
  const [row] = await exec.insert(bookingBlackout).values({ companyId, userId: null, date: day, startMinute: null, endMinute: null, reason }).returning({ id: bookingBlackout.id, date: bookingBlackout.date, reason: bookingBlackout.reason })
  return row as DayOff
}

/** Remove one of the business's days off (never a person's own). True when there was one. */
export async function removeDayOff(exec: any, companyId: string, id: string): Promise<boolean> {
  const gone = await exec.delete(bookingBlackout).where(and(eq(bookingBlackout.id, id), ...wholeBusiness(companyId))).returning({ id: bookingBlackout.id })
  return gone.length > 0
}
