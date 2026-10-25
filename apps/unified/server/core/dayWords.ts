// A calendar day in words — "Friday, November 20, 2026" — for any sentence a person reads. A calendar day is the day it
// names (an event, an appointment's day), not a moment, so it is read at noon UTC and never slides a day. Printed raw it
// read "held on 2026-11-20" (restaurant) and "That appointment is on 2026-10-26" (salon), live tests 2026-10-25.
export const calendarDayWords = (day: unknown): string => {
  const s = String(day ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(day ?? '')
  return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
