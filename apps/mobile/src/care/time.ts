/**
 * Calendar-date and clock helpers for the caregiver app (Twomiah Care).
 *
 * Pure functions — no React Native imports — so tests/mobile/care-app.test.ts can run them under
 * plain `bun run`. Dates are 'YYYY-MM-DD' calendar strings and times are 'HH:MM' or 'HH:MM:SS',
 * the shapes the home care backend sends (to_char(..., 'YYYY-MM-DD' / 'HH24:MI:SS')). Calendar
 * arithmetic goes through Date.UTC so the phone's own time zone can never shift a day.
 */

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** The phone's local calendar day for a Date. */
export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return [y, (m || 1) - 1, d || 1]
}

export function isYmd(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymdParts(ymd)
  const t = new Date(Date.UTC(y, m, d) + days * 86400000)
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** Whole calendar days from a to b. */
export function dayDiff(aYmd: string, bYmd: string): number {
  return Math.round((Date.UTC(...ymdParts(bYmd)) - Date.UTC(...ymdParts(aYmd))) / 86400000)
}

/** 0 = Sunday … 6 = Saturday, for the calendar date itself. */
export function dowOfYmd(ymd: string): number {
  return new Date(Date.UTC(...ymdParts(ymd))).getUTCDay()
}

/** 'HH:MM:SS' | 'HH:MM' → minutes after midnight, or null. */
export function minutesOf(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t))
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 'HH:MM:SS' → 'HH:MM'. */
export function hm(t: string | null | undefined): string {
  const m = minutesOf(t)
  return m == null ? '' : `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** '13:05:00' → '1:05 PM'. */
export function formatTime12(t: string | null | undefined): string {
  const m = minutesOf(t)
  if (m == null) return ''
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m % 60)} ${h < 12 ? 'AM' : 'PM'}`
}

/** Length of a shift in minutes; an end before the start wraps past midnight. */
export function shiftMinutes(start: string | null | undefined, end: string | null | undefined): number {
  const s = minutesOf(start), e = minutesOf(end)
  if (s == null || e == null) return 0
  let d = e - s
  if (d < 0) d += 24 * 60
  return d
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Monday, Oct 5'. Built by hand — Hermes' Intl support differs between builds. */
export function formatYmdLong(ymd: string): string {
  if (!isYmd(String(ymd).slice(0, 10))) return String(ymd || '')
  const [, m, d] = ymdParts(ymd)
  return `${WEEKDAYS[dowOfYmd(ymd)]}, ${MONTHS[m]} ${d}`
}

/** 'Mon, Oct 5'. */
export function formatYmdShort(ymd: string): string {
  if (!isYmd(String(ymd).slice(0, 10))) return String(ymd || '')
  const [, m, d] = ymdParts(ymd)
  return `${WEEKDAYS[dowOfYmd(ymd)].slice(0, 3)}, ${MONTHS[m]} ${d}`
}

/** A timestamp (ISO string or Date) as the phone's '1:05 PM'. */
export function formatClock(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return ''
  const d = v instanceof Date ? v : new Date(v)
  if (isNaN(d.getTime())) return ''
  return formatTime12(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
}

/** Seconds → '01:02:03'. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`
}

/** '45 min' / '2h' / '2h 15m'. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}
