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

/** How far `tz` is from UTC at this instant, in milliseconds. */
function zoneOffsetMs(at: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).reduce((acc: any, p) => (p.type !== 'literal' ? { ...acc, [p.type]: Number(p.value) } : acc), {})
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
    return asUtc - Math.floor(at.getTime() / 1000) * 1000
  } catch {
    return 0
  }
}

/** The UTC instant at which a given local date begins in this zone. */
export function salonDayStart(dateStr: string, tz: string): Date {
  const asUtcMidnight = new Date(`${dateStr}T00:00:00.000Z`).getTime()
  // Subtract the offset twice so a day beginning on a DST boundary settles on the offset actually in
  // force at the start of it.
  let start = new Date(asUtcMidnight - zoneOffsetMs(new Date(asUtcMidnight), tz))
  start = new Date(asUtcMidnight - zoneOffsetMs(start, tz))
  return start
}

/**
 * The instants bounding the salon's own days, for the dashboard's "today" and "next 7 days" windows.
 *
 * The dashboard built these with `new Date(now.getFullYear(), ...)` — the SERVER's local time, which on
 * Render is UTC. So from 19:00 Central the "Appointments Today" tile counted TOMORROW's book: 8 where
 * the shop had 5, on the number a salon glances at to know what its evening looks like. Untouched since
 * the vertical shipped, and missed by the T25 N2 sweep because that went looking for
 * toISOString().slice(0, 10) and this spells the same bug a different way. (Salon T27 H1)
 */
export async function salonDayWindows(companyId: string): Promise<{ tz: string; today: Date; tomorrow: Date; in7: Date; startOfMonth: Date; startOfNextMonth: Date }> {
  const tz = await salonTimezone(companyId)
  const todayStr = calendarDateIn(new Date(), tz)
  const [y, m] = todayStr.split('-').map(Number)
  // Date.UTC here is calendar arithmetic on a date that is ALREADY the shop's — it never asks what
  // time it is. Formatted by hand rather than via toISOString().slice(0, 10) so it cannot be mistaken
  // for the UTC-today bug, by a reader or by check-salon-days-are-the-shop-calendar.ts.
  const pad = (n: number) => String(n).padStart(2, '0')
  const plusDays = (n: number) => {
    const [yy, mm, dd] = todayStr.split('-').map(Number)
    const t = new Date(Date.UTC(yy, mm - 1, dd + n))
    return salonDayStart(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, tz)
  }
  const monthStart = (year: number, month1: number) =>
    salonDayStart(`${year}-${String(month1).padStart(2, '0')}-01`, tz)
  return {
    tz,
    today: plusDays(0),
    tomorrow: plusDays(1),
    in7: plusDays(7),
    startOfMonth: monthStart(y, m),
    startOfNextMonth: m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1),
  }
}
