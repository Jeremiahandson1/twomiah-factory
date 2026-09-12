// Wall-clock helpers for online booking. Everything the customer sees ("10:00 on Tuesday") is in the
// business's own timezone; everything stored is UTC. A UTC server that used getHours() stored a
// Chicago 1:00 PM as 13:00Z — five hours early — which is why these exist.

export const DAY_MS = 86_400_000
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type DayName = typeof DAYS[number]
export interface DayHours { start: string; end: string; enabled: boolean }
export type WorkingHours = Record<string, DayHours>

export const isIsoDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
export const isHm = (s: unknown) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const hmToMinutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export const minutesToHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

/** A usable IANA zone, or the fallback when the stored value is missing/garbage. */
export function safeTz(tz: unknown, fallback = 'America/Chicago'): string {
  if (typeof tz !== 'string' || !tz) return fallback
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return fallback }
}
export function isValidTz(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** Convert a wall-clock date + time in a named zone to the UTC instant (DST-aware). */
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [h, m] = timeStr.split(':').map(Number)
  const asUtc = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)
  if (Number.isNaN(asUtc.getTime())) return asUtc
  const local = new Date(asUtc.toLocaleString('en-US', { timeZone }))
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(asUtc.getTime() - (local.getTime() - utc.getTime()))
}

/** The zone-local calendar date, minutes-since-midnight and weekday of an instant. */
export function tzParts(d: Date, timeZone: string): { date: string; minutes: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const hour = Number(get('hour')) % 24
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')), weekday: get('weekday').toLowerCase() }
}

/** ISO date + n calendar days (UTC arithmetic on the date only, so no DST drift). */
export function addDays(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function parseHours(raw: unknown): WorkingHours {
  if (!raw) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
  return raw as WorkingHours
}

export function defaultWorkingHours(start = '09:00', end = '17:00'): WorkingHours {
  const out: WorkingHours = {}
  for (const d of DAYS) out[d] = { start, end, enabled: d !== 'saturday' && d !== 'sunday' }
  return out
}

/** Human "Tue, Sep 15 at 10:00 AM" in the business's zone. */
export function formatWhen(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)
}
