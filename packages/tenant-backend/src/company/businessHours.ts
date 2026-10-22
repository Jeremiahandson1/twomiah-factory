// The business's opening hours: one record on the company (company.settings.businessHours), set in Settings › Company
// and read by the website (its contact section and the vet's urgent-care bar read `settings.businessHours`).
//
// The shape is the one the website's urgent bar already read (apps/unified/site/views/sections/urgent/bar.ejs):
//   { monday: { open: '09:00', close: '17:00', closed: false }, …, sunday: { closed: true } }
// Times are 24-hour HH:MM on the business's own clock. A day left out is "not said", not "closed".
// Pure: no imports, so the screens' copy of the day list and the server agree by test, not by hope.

export const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type WeekDay = typeof WEEK_DAYS[number]
export interface DayHours { open?: string; close?: string; closed?: boolean }
export type BusinessHours = Partial<Record<WeekDay, DayHours>>

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const label = (d: string) => d[0].toUpperCase() + d.slice(1)

/** Null when the value is a usable week of hours (or null, which clears them); otherwise the sentence to show. */
export function checkBusinessHours(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object' || Array.isArray(v)) return 'Business hours must list each day\'s opening and closing times.'
  for (const [day, h] of Object.entries(v as Record<string, unknown>)) {
    if (!(WEEK_DAYS as readonly string[]).includes(day)) return `"${day}" is not a day of the week.`
    if (!h || typeof h !== 'object') return `${label(day)}: give an opening and a closing time, or mark it closed.`
    const { open, close, closed } = h as DayHours
    if (closed === true) continue
    if (typeof open !== 'string' || !HHMM.test(open) || typeof close !== 'string' || !HHMM.test(close)) return `${label(day)}: enter an opening and a closing time, or mark it closed.`
    if (close <= open) return `${label(day)}: closing time must be after opening time.`
  }
  return null
}

const twelveHour = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`
}

/** The hours as lines for a page ("Monday: 9am – 5pm", "Sunday: Closed"), in week order; days not said are left out. */
export function businessHoursLines(v: unknown): string[] {
  if (checkBusinessHours(v) || !v) return []
  const hours = v as BusinessHours
  return WEEK_DAYS.flatMap((d) => {
    const h = hours[d]
    if (!h) return []
    return [`${label(d)}: ${h.closed ? 'Closed' : `${twelveHour(h.open!)} – ${twelveHour(h.close!)}`}`]
  })
}
