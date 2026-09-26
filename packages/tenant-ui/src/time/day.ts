// What day is it, on the screen the person is looking at?
//
// `new Date().toISOString().slice(0, 10)` is the UTC day, not theirs. From 19:00 Central — 20:00 Eastern,
// 17:00 Pacific — it is already tomorrow in UTC, so a screen that asks the question that way rolls over
// while the crew is still working. The Dispatch Board opened on tomorrow and its "Today" button jumped
// forward a day; the technician's "Today" tab emptied and filled with tomorrow's work, at exactly the hour
// someone is closing out the day's jobs. Meanwhile the Schedule page computed the day LOCALLY and stayed
// on today, so the two screens disagreed about what day it was. (Evergreen BUG-28)
//
// This is the browser half of the same bug the server had: there, `businessToday()` in
// packages/tenant-backend/src/invoicing/money.ts asks the COMPANY's zone. On the client there is no
// company zone to ask — and the right answer is different anyway. A dispatcher looking at a screen means
// the day on the wall behind them, so the browser's own local day is the correct question here, not UTC
// and not a configured zone.
//
// Dates are compared as `YYYY-MM-DD` strings throughout the CRM (`scheduledDate.startsWith(today)`,
// `key === localDayKey(d)`), so these return that shape rather than a Date.

/** The calendar day of `d` where the viewer is sitting, as `YYYY-MM-DD`. Never UTC. */
export const localDayKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Today, on the viewer's own calendar. The replacement for `new Date().toISOString().split('T')[0]`. */
export const todayKey = (): string => localDayKey(new Date())

/**
 * Step a `YYYY-MM-DD` key forward or back by whole days.
 *
 * Built on LOCAL NOON, deliberately. The obvious version — `new Date(key)`, `setDate(getDate() + n)`,
 * `toISOString()` — mixes three clocks: `new Date('2026-09-25')` parses as midnight UTC, `setDate` then
 * moves it in local time, and `toISOString` reads it back in UTC. Those cancel out on most days, which is
 * why it looked fine, but midnight is also the one instant a DST change can delete or repeat: on a
 * spring-forward day the arithmetic lands in a gap and the board skips a day or shows the same one twice.
 * Noon is never in a gap.
 */
export const dayKeyPlus = (key: string, days: number): string => {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return todayKey()
  const at = new Date(y, m - 1, d, 12, 0, 0, 0)
  at.setDate(at.getDate() + days)
  return localDayKey(at)
}
