// The holidays a US service business usually closes for, by year — offered on Settings › Days off in one press (DaysOffPage.tsx).
const pad = (n: number) => String(n).padStart(2, '0')
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
/** The nth weekday (0 = Sunday) of a month, or the last one when n is -1. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    return key(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay()
  return key(y, m, lastDay - ((last - weekday + 7) % 7))
}
/** The holidays most US service businesses close for — offered in one press, each removable. */
export function usualHolidays(y: number): Array<{ date: string; reason: string }> {
  return [
    { date: key(y, 1, 1), reason: "New Year's Day" },
    { date: nthWeekday(y, 5, 1, -1), reason: 'Memorial Day' },
    { date: key(y, 7, 4), reason: 'Independence Day' },
    { date: nthWeekday(y, 9, 1, 1), reason: 'Labor Day' },
    { date: nthWeekday(y, 11, 4, 4), reason: 'Thanksgiving' },
    { date: key(y, 12, 25), reason: 'Christmas Day' },
  ]
}
