// The menu by time of day and "86 until we open" (restaurant-bar-depth #11; Toast menu availability by daypart, Square's
// item availability). Behind the 'menu_dayparts' feature (not ready): off, every section shows all day and an 86 stays
// until someone puts it back, exactly as before.
//
//   · A SECTION can be served only in a window — lunch 11:00 to 15:00 Monday to Friday, brunch on weekends. Outside it
//     the section leaves the website, the kiosk and online ordering and the register's picker, and the register refuses
//     a line from it (a manager can always change the window).
//   · An ITEM put out "until we open" comes back by itself the next time the business opens: its kitchen hours, else its
//     bar hours, else 5 AM, on the business's own clock. Put back by hand sooner, it simply is.
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { barMenuItem, company } from '../../db/schema/index.ts'
import { addDays, localDateString, localParts, localToUtc, rangesFor, type HoursConfig } from './barHours.ts'
import { createBarLive } from './barLive.ts'

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/

export async function menuDaypartsOn(db: any, companyId: string): Promise<boolean> {
  const [co] = await db.select({ f: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  return Array.isArray(co?.f) && co.f.includes('menu_dayparts')
}

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

export interface Window { availableFrom: string | null; availableTo: string | null; availableDays: unknown }

/** The refusal for a window typed in; null when it is fine (both times or neither, the end after the start or wrapping midnight, days 0 to 6). */
export function windowRefusal(b: Record<string, unknown>): string | null {
  const from = b.availableFrom || null, to = b.availableTo || null
  if (!!from !== !!to) return 'A time window needs both a first and a last time.'
  if ((from && !TIME.test(String(from))) || (to && !TIME.test(String(to)))) return 'Times look like 11:00.'
  if (from && from === to) return 'The window has to be longer than that.'
  if (b.availableDays !== undefined && !(Array.isArray(b.availableDays) && b.availableDays.every((n) => Number.isInteger(n) && n >= 0 && n <= 6))) return 'Days are numbers from 0 (Sunday) to 6 (Saturday).'
  return null
}

/** Is a section served at this moment on the business's clock? Windows that cross midnight belong to the day they started. */
export function servedAt(w: Window, now: Date, tz: string): boolean {
  if (!w.availableFrom || !w.availableTo) return true
  const days = Array.isArray(w.availableDays) ? (w.availableDays as number[]) : []
  const p = localParts(now, tz)
  const t = p.h * 60 + p.mi, from = minutes(w.availableFrom), to = minutes(w.availableTo)
  const dayOk = (dow: number) => !days.length || days.includes(dow)
  if (from < to) return dayOk(p.dow) && t >= from && t < to
  // Across midnight: the evening part belongs to today, the small hours to yesterday.
  return (dayOk(p.dow) && t >= from) || (dayOk((p.dow + 6) % 7) && t < to)
}

/** "Served 11:00 to 15:00" in words, for the screen that says why a section is not showing. */
export function windowWords(w: Window): string | null {
  if (!w.availableFrom || !w.availableTo) return null
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = Array.isArray(w.availableDays) ? (w.availableDays as number[]) : []
  return `Served ${w.availableFrom} to ${w.availableTo}${days.length && days.length < 7 ? ' ' + days.map((d) => names[d]).join(', ') : ''}`
}

/** The first moment the business opens after `after`: kitchen hours, else bar hours, else 5 AM, looking up to a week ahead. */
export function nextOpening(config: HoursConfig, tz: string, after: Date): Date {
  const day0 = localDateString(after, tz)
  for (let i = 0; i < 8; i++) {
    const day = addDays(day0, i)
    for (const dept of ['kitchen', 'bar'] as const) {
      const opens = rangesFor(config, dept, day).ranges.map((r) => localToUtc(day, r.open, tz)).filter((d) => d.getTime() > after.getTime()).sort((a, b) => a.getTime() - b.getTime())
      if (opens.length) return opens[0]
    }
  }
  return localToUtc(addDays(day0, 1), '05:00', tz)
}

/**
 * Put back every item that was put out "until we open" and has been through an opening since. Called on every read of
 * the menu (cheap: one update that touches nothing most of the time). Returns how many came back.
 */
export async function resetBackAtOpen(db: any, companyId: string, hours: HoursConfig, now = new Date()): Promise<number> {
  if (!(await menuDaypartsOn(db, companyId))) return 0
  const out = await db.select({ id: barMenuItem.id, at: barMenuItem.eightySixedAt }).from(barMenuItem)
    .where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.is86ed, true), eq(barMenuItem.eightySixUntilOpen, true), isNotNull(barMenuItem.eightySixedAt), lte(barMenuItem.eightySixedAt, now)))
  let back = 0
  for (const it of out) {
    if (nextOpening(hours, hours.timezone || 'America/Chicago', new Date(it.at)).getTime() > now.getTime()) continue
    const done = await db.update(barMenuItem).set({ is86ed: false, eightySixUntilOpen: false, eightySixedAt: null, updatedAt: now })
      .where(and(eq(barMenuItem.id, it.id), eq(barMenuItem.is86ed, true))).returning({ id: barMenuItem.id })
    back += done.length
  }
  return back
}

/** The menu is about to be read: bring back what was out until opening (menu_dayparts on), without hours or a feature, nothing happens. */
export async function refreshMenu(db: any, companyId: string, now = new Date()): Promise<number> {
  if (!(await menuDaypartsOn(db, companyId))) return 0
  return resetBackAtOpen(db, companyId, await createBarLive(db).hoursFor(companyId), now)
}

/** Whether a section is served right now: always true while menu_dayparts is off. */
export async function servingNow(db: any, companyId: string, now = new Date()): Promise<(w: Window) => boolean> {
  if (!(await menuDaypartsOn(db, companyId))) return () => true
  const tz = (await createBarLive(db).hoursFor(companyId)).timezone || 'America/Chicago'
  return (w) => servedAt(w, now, tz)
}
