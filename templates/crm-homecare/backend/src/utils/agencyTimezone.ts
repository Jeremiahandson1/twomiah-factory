// The agency's own calendar: its time zone and its state.
//
// "Today", "this week" and the times printed on a PDF are the AGENCY's, not the server's — a
// Render box runs in UTC, so a visit at 7pm in Chicago is already "tomorrow" there. The zone is a
// setting on the agency (settings.timezone, an IANA name such as "America/Denver"); until an
// agency sets one, AGENCY_TIMEZONE from the environment applies, then US Central, which is what
// this product ran on before the setting existed.
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'

const FALLBACK_TZ = 'America/Chicago'

const validZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export async function agencyTimeZone(): Promise<string> {
  try {
    const [agency] = await db.select({ settings: agencies.settings }).from(agencies).limit(1)
    const tz = (agency?.settings as any)?.timezone
    if (validZone(tz)) return tz
  } catch { /* no agency row yet */ }
  return validZone(process.env.AGENCY_TIMEZONE) ? process.env.AGENCY_TIMEZONE! : FALLBACK_TZ
}

/** The agency's two-letter state ('WI'), upper-cased, or null when it has not been entered. */
export async function agencyState(): Promise<string | null> {
  try {
    const [agency] = await db.select({ state: agencies.state }).from(agencies).limit(1)
    const s = String(agency?.state || '').trim().toUpperCase()
    return s || null
  } catch { return null }
}

/** A Date as the agency's wall-clock date + time, e.g. "10/15/2026, 7:05:00 PM". */
export function formatInZone(d: Date | string | null | undefined, tz: string): string {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', { timeZone: tz })
}
