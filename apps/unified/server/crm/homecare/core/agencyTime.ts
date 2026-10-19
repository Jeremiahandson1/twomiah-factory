// The agency's clock — the ONE place home care decides what time zone the agency lives in. Moved from
// templates/crm-homecare/backend/src/services/agencyTime.ts. The SQL halves (localTs, localDate, dayStartUtc, dayEndUtc,
// nowUtc) are in server/data/homecareCore.ts.
//
// Reports, the dashboard, the live board, billing, payroll, EVV weeks, reminders, the caregiver's clock-in match,
// care-plan schedules, incident files, notification quiet hours and PDFs all count calendar days the way the office
// lives them. The server and the database run UTC, so:
//
//   the zone = company.timezone (the office's own setting)
//            → else AGENCY_TIMEZONE from the environment
//            → else the usual zone for the company's state
//            → else America/Chicago (the zone this product shipped with).
//
// Changes from the template: the agency is the signed-in person's `company` row (the template read its database's
// only `agencies` row), so every read takes the company's id; "today" is computed from the server's clock in the zone
// (the template asked the database's NOW(); the same instant). The pure functions are unchanged.
import { eq } from 'drizzle-orm'
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

// Primary IANA zone per US state / territory. States split across zones use the zone most of the population lives
// in; an agency on the other side of the line sets company.timezone.
const STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
  GU: 'Pacific/Guam', VI: 'America/St_Thomas',
}

export const DEFAULT_TIMEZONE = 'America/Chicago'

/** True when `tz` is a zone this runtime (and therefore Postgres' tz database) recognises. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** The zone for a company row: its own setting, else AGENCY_TIMEZONE, else its state's, else the default. */
export function resolveTimezone(agency: { timezone?: string | null; state?: string | null } | null | undefined): string {
  if (agency?.timezone && isValidTimezone(agency.timezone)) return agency.timezone
  if (isValidTimezone(process.env.AGENCY_TIMEZONE)) return process.env.AGENCY_TIMEZONE
  const st = String(agency?.state || '').trim().toUpperCase()
  return STATE_ZONES[st] || DEFAULT_TIMEZONE
}

/** 'YYYY-MM-DD' of an instant in a zone. */
export function ymdIn(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** 'HH:MM:SS' (24h) of an instant in a zone. */
export function hmsIn(at: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const g = (t: string) => p.find((x) => x.type === t)?.value || '00'
  return `${g('hour')}:${g('minute')}:${g('second')}`
}

/** A display time like 9:05 AM in the agency's zone. */
export function fmtClock(at: Date, tz: string): string {
  return at.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
}

/** A Date as the agency's wall-clock date + time, e.g. "10/15/2026, 7:05:00 PM". */
export function formatInZone(d: Date | string | null | undefined, tz: string): string {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', { timeZone: tz })
}

/** `date` + n days, as YYYY-MM-DD (pure calendar arithmetic, no zone involved). */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The Sunday (YYYY-MM-DD) of the Sun–Sat week containing `ymd` (pure calendar arithmetic). */
export function sundayOfWeek(ymd: string): string {
  return addDays(ymd, -new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`).getUTCDay())
}

/** True for a strict YYYY-MM-DD that is a real calendar date. */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** Anything that can run a query-builder select: `d.db`, or a transaction handle (never read `db` inside a tx). */
type Q = { select: (...a: any[]) => any }

export function createAgencyTime(d: CrmDeps) {
  /** The company's own timezone and state (null when there is no such company). */
  async function row(companyId: string, q: Q = d.db): Promise<{ timezone: string | null; state: string | null } | null> {
    const [a] = await q.select({ timezone: company.timezone, state: company.state }).from(company).where(eq(company.id, companyId)).limit(1)
    return a ?? null
  }

  /** The agency's zone, read fresh (one row — no cache to go stale after an edit). */
  async function timezone(companyId: string, q: Q = d.db): Promise<string> {
    try {
      return resolveTimezone(await row(companyId, q))
    } catch {
      return resolveTimezone(null)
    }
  }

  /** The agency's two-letter state ('WI'), upper-cased, or null when it has not been entered. */
  async function state(companyId: string, q: Q = d.db): Promise<string | null> {
    try {
      const s = String((await row(companyId, q))?.state || '').trim().toUpperCase()
      return s || null
    } catch { return null }
  }

  /** Today's date (YYYY-MM-DD) on the agency's clock. */
  async function today(companyId: string, tz?: string, q: Q = d.db): Promise<string> {
    return ymdIn(new Date(), tz || await timezone(companyId, q))
  }

  /** The agency's date and wall-clock time at an instant (default: now). */
  async function now(companyId: string, at: Date = new Date()): Promise<{ date: string; time: string; tz: string }> {
    const tz = await timezone(companyId)
    return { date: ymdIn(at, tz), time: hmsIn(at, tz), tz }
  }

  /**
   * The Sunday of the agency's CURRENT Sun–Sat week. The week-at-a-time screens (Client Hours by Week, Portal Claim
   * Days) open here when they are not asked for a week — this week, on the agency's clock.
   */
  async function weekStart(companyId: string): Promise<string> {
    return sundayOfWeek(await today(companyId))
  }

  /**
   * A screen's ?startDate / ?endDate filter as instants on the agency's clock: a calendar day (YYYY-MM-DD) runs from the
   * agency's midnight to its next midnight; anything else is taken as the instant it names. `before` is exclusive. A
   * log written at 8 PM Central on the 16th is the 16th's (the filters cut days at UTC midnight, so it fell on the 17th).
   */
  async function range(companyId: string, startDate?: string | null, endDate?: string | null): Promise<{ from?: Date; before?: Date }> {
    const instant = (v: string) => { const t = new Date(v); return isNaN(t.getTime()) ? undefined : t }
    const tz = (isYmd(startDate) || isYmd(endDate)) ? await timezone(companyId) : ''
    const from = !startDate ? undefined : isYmd(startDate) ? zonedWallTimeToUtc(startDate, '00:00', tz) : instant(startDate)
    const endAt = !endDate ? undefined : isYmd(endDate) ? zonedWallTimeToUtc(addDays(endDate, 1), '00:00', tz) : instant(endDate)
    const before = endAt && !isYmd(endDate) ? new Date(endAt.getTime() + 1) : endAt
    return { from, before }
  }

  return { timezone, state, today, now, weekStart, range }
}

export type AgencyTime = ReturnType<typeof createAgencyTime>
