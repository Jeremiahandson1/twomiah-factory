// The menu by time of day and "86 until we open" (restaurant-bar-depth #11; Toast menu availability by daypart, Square's
// item availability). Behind the 'menu_dayparts' feature (not ready): off, every section shows all day and an 86 stays
// until someone puts it back, exactly as before.
//
//   · A SECTION can be served only in its windows — lunch 11:00 to 15:00 Monday to Friday, brunch on weekends, happy hour
//     16:00 to 18:00, late night 22:00 to 02:00 (parity row 12: any number of windows, each with its own days; the first
//     is kept in available_from / available_to / available_days as it always was, the rest in available_windows). Outside
//     every window the section leaves the website, the kiosk and online ordering and the register's picker, and the
//     register refuses a line from it (a manager can always change the windows).
//   · An ITEM put out "until we open" comes back by itself the next time the business opens: its kitchen hours, else its
//     bar hours, else 5 AM, on the business's own clock. Put back by hand sooner, it simply is.
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { barMenuItem, company } from '../../db/schema/index.ts'
import { addDays, localDateString, localParts, localToUtc, rangesFor, type HoursConfig } from './barHours.ts'
import { createBarLive } from './barLive.ts'

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/
export const MAX_WINDOWS = 8

export async function menuDaypartsOn(db: any, companyId: string): Promise<boolean> {
  const [co] = await db.select({ f: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  return Array.isArray(co?.f) && co.f.includes('menu_dayparts')
}

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

export interface Window { availableFrom: string | null; availableTo: string | null; availableDays: unknown; availableWindows?: unknown }
export interface OneWindow { from: string; to: string; days: number[] }

/** Every window a section has: the first (the old three columns) and the rest. None = served all day, every day. */
export function allWindows(w: Window): OneWindow[] {
  const out: OneWindow[] = []
  if (w.availableFrom && w.availableTo) out.push({ from: w.availableFrom, to: w.availableTo, days: Array.isArray(w.availableDays) ? (w.availableDays as number[]) : [] })
  if (Array.isArray(w.availableWindows)) for (const x of w.availableWindows as any[]) if (x && x.from && x.to) out.push({ from: String(x.from), to: String(x.to), days: Array.isArray(x.days) ? x.days : [] })
  return out
}

const oneRefusal = (from: unknown, to: unknown, days: unknown): string | null => {
  if (!!from !== !!to) return 'A time window needs both a first and a last time.'
  if ((from && !TIME.test(String(from))) || (to && !TIME.test(String(to)))) return 'Times look like 11:00.'
  if (from && from === to) return 'The window has to be longer than that.'
  if (days !== undefined && !(Array.isArray(days) && days.every((n) => Number.isInteger(n) && n >= 0 && n <= 6))) return 'Days are numbers from 0 (Sunday) to 6 (Saturday).'
  return null
}

/** The refusal for the windows typed in; null when fine (each: both times or neither, the end after the start or wrapping midnight, days 0 to 6; up to MAX_WINDOWS). */
export function windowRefusal(b: Record<string, unknown>): string | null {
  const first = oneRefusal(b.availableFrom || null, b.availableTo || null, b.availableDays)
  if (first) return first
  if (b.availableWindows === undefined) return null
  if (!Array.isArray(b.availableWindows)) return 'Send the windows as a list.'
  if (b.availableWindows.length > MAX_WINDOWS - 1) return `Up to ${MAX_WINDOWS} windows for one section.`
  for (const x of b.availableWindows as any[]) {
    if (!x || !x.from || !x.to) return 'Each window needs a first and a last time.'
    const r = oneRefusal(x.from, x.to, x.days); if (r) return r
  }
  return null
}

/** The extra windows, cleaned for keeping. */
export function cleanWindows(raw: unknown): OneWindow[] {
  return (Array.isArray(raw) ? raw : []).filter((x: any) => x && x.from && x.to).map((x: any) => ({ from: String(x.from), to: String(x.to), days: Array.isArray(x.days) ? [...new Set((x.days as number[]).map(Number))].sort() : [] }))
}

const inWindow = (w: OneWindow, p: { dow: number; h: number; mi: number }): boolean => {
  const t = p.h * 60 + p.mi, from = minutes(w.from), to = minutes(w.to)
  const dayOk = (dow: number) => !w.days.length || w.days.includes(dow)
  if (from < to) return dayOk(p.dow) && t >= from && t < to
  // Across midnight: the evening part belongs to today, the small hours to yesterday.
  return (dayOk(p.dow) && t >= from) || (dayOk((p.dow + 6) % 7) && t < to)
}

/** Is a section served at this moment on the business's clock? Any of its windows will do; none means always. */
export function servedAt(w: Window, now: Date, tz: string): boolean {
  const windows = allWindows(w)
  if (!windows.length) return true
  const p = localParts(now, tz)
  return windows.some((x) => inWindow(x, p))
}

/** "Served 11:00 to 15:00 Mon, Tue; 22:00 to 02:00 Fri" in words, for the screen that says why a section is not showing. */
export function windowWords(w: Window): string | null {
  const windows = allWindows(w)
  if (!windows.length) return null
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return 'Served ' + windows.map((x) => `${x.from} to ${x.to}${x.days.length && x.days.length < 7 ? ' ' + x.days.map((d) => names[d]).join(', ') : ''}`).join('; ')
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
