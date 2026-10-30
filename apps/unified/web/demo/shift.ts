// The recorded data was taken on one day; the visitor opens it on another. Every date in it moves by the same whole number
// of days, so "today's jobs" are today's and "next week" is next week. A date is a string that IS one (YYYY-MM-DD, or an
// ISO moment) — prose that merely contains a date is left alone — and a key that is one (a day's bucket) moves with it.
const DAY_MS = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?=$|[T ])/
const KEY_DATE = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** The calendar day `days` after `ymd` (YYYY-MM-DD), in UTC so no zone or daylight-saving hour can move it. */
export function addDays(ymd: string, days: number): string {
  const m = DATE.exec(ymd)
  if (!m) return ymd
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS
  const d = new Date(t)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  const a = DATE.exec(from), b = DATE.exec(to)
  if (!a || !b) return 0
  return Math.round((Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))) / DAY_MS)
}

/** Today's date on the visitor's own clock, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A string moved by `days` if it is a date or a moment; any other string comes back unchanged. */
export function shiftString(s: string, days: number): string {
  if (!days) return s
  const m = DATE.exec(s)
  if (!m) return s
  return addDays(s.slice(0, 10), days) + s.slice(10)
}

/** A copy of any JSON value with every date in it (and every day-keyed object key) moved by `days`. */
export function shiftValue<T>(value: T, days: number): T {
  if (!days) return value
  const walk = (v: any): any => {
    if (typeof v === 'string') return shiftString(v, days)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {}
      for (const [k, x] of Object.entries(v)) out[KEY_DATE.test(k) ? addDays(k, days) : k] = walk(x)
      return out
    }
    return v
  }
  return walk(value)
}
