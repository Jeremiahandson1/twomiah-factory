/**
 * The salon's own calendar date — not the server's, and not UTC's.
 *
 * Anything the salon reads as a DAY (a membership start date, the period an invoice line is labelled
 * with, "is this date in the future?") has to be answered on the shop's calendar. Asking UTC instead
 * is wrong in both directions: west of UTC an evening makes tomorrow look like today, east of UTC an
 * early morning makes today look like tomorrow. A 7pm Chicago enrolment was recorded as starting
 * TOMORROW, billed for tomorrow's period, and had its renewal anniversary shifted a day forever after.
 * (Salon T25 N2; the booking window already does it this way — booking/service.ts)
 *
 * The zone is the one the shop set for its booking calendar. A tenant that never opened Booking has
 * none, and America/Chicago is the fleet's fallback there too.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { bookingSettings } from '../../db/schema.ts'

export const DEFAULT_TZ = 'America/Chicago'

/** `d` as YYYY-MM-DD on `tz`'s calendar. Falls back to the UTC day if the zone name is not recognised. */
export function calendarDateIn(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** The shop's timezone, or the fleet default when Booking was never set up. */
export async function salonTimezone(companyId: string): Promise<string> {
  const [bs] = await db.select({ timezone: bookingSettings.timezone }).from(bookingSettings)
    .where(eq(bookingSettings.companyId, companyId)).limit(1)
  return bs?.timezone || DEFAULT_TZ
}

/** Today, on the calendar the people in this salon are looking at. */
export async function salonToday(companyId: string): Promise<string> {
  return calendarDateIn(new Date(), await salonTimezone(companyId))
}
