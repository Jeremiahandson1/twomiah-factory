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

/**
 * The opening hours on a company's settings blob (company.settings), or null when none are set or they aren't a usable
 * week. The blob may be stored as JSON text (a moved agency: enabledFeature.ts readSettingsBlob), so it is read either way.
 */
export function businessHoursOf(settings: unknown): BusinessHours | null {
  let blob: any = settings
  if (typeof blob === 'string') { try { blob = JSON.parse(blob) } catch { blob = null } }
  const v = blob && typeof blob === 'object' ? blob.businessHours : null
  return v && !checkBusinessHours(v) ? (v as BusinessHours) : null
}

/**
 * The hours as weekly windows on the business's clock (dayOfWeek 0 = Sunday … 6 = Saturday, minutes from midnight):
 * what online booking offers until the owner sets booking hours of their own (apps/unified booking/engine.ts weekOf;
 * salon live test, 2026-10-25). A closed day and a day not said both have no window. Null when no day is said at all.
 */
export function businessHoursWindows(v: unknown): Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> | null {
  if (!v || checkBusinessHours(v)) return null
  const hours = v as BusinessHours
  if (!WEEK_DAYS.some((d) => hours[d])) return null
  const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  return WEEK_DAYS.flatMap((d, i) => {
    const h = hours[d]
    if (!h || h.closed) return []
    return [{ dayOfWeek: (i + 1) % 7, startMinute: minutes(h.open!), endMinute: minutes(h.close!) }]
  })
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
