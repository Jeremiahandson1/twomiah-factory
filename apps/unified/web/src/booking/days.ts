// Calendar-day arithmetic on YYYY-MM-DD keys: no clock, no zone, just the calendar. The booking calendar's week and month
// and the salon book's week (crm/pages/salon/bookWeek.ts) count days the same way, from here. Kept apart from
// ./common.tsx, which reaches for the API client, so a plain module (and its test) can use it.

/** A calendar date (YYYY-MM-DD) as words, without any clock shifting it. */
export const dateWords = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, day)))
}
export const addDays = (d: string, n: number) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10) }
export const weekdayOf = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)).getUTCDay() }
