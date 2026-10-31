// When a person can work, as arithmetic (restaurant-bar-depth #10; 7shifts' employee availability). A person with no
// windows can work any time. With windows, a shift must sit inside them: a shift that runs past midnight needs a window
// for the evening on its own day and one for the small hours on the next.
import { TIME, dayOfWeek } from './barSchedulePlan.ts'
import { addDays } from './barHours.ts'

export interface Window { dow: number; start: string; end: string }
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** The first problem with a set of windows, as a sentence; null when fine. */
export function windowsRefusal(w: unknown): string | null {
  if (!Array.isArray(w)) return 'Send a list of windows.'
  if (w.length > 28) return 'That is a lot of windows. Up to 28.'
  for (const x of w) {
    if (!Number.isInteger(x?.dow) || x.dow < 0 || x.dow > 6) return 'Each window is for a day from Sunday to Saturday.'
    if (!TIME.test(String(x.start)) || !TIME.test(String(x.end))) return 'Times look like 16:00.'
    if (mins(String(x.end)) <= mins(String(x.start))) return `${DAY_NAMES[x.dow]}: a window ends after it starts. For late nights, say until 23:59 and add the small hours the next day.`
  }
  const sorted = [...(w as Window[])].sort((a, b) => a.dow - b.dow || mins(a.start) - mins(b.start))
  for (let i = 1; i < sorted.length; i++) if (sorted[i].dow === sorted[i - 1].dow && mins(sorted[i].start) < mins(sorted[i - 1].end)) return `${DAY_NAMES[sorted[i].dow]} has two windows that overlap.`
  return null
}

export function cleanWindows(w: unknown): Window[] {
  return (Array.isArray(w) ? w : []).map((x: any) => ({ dow: Number(x?.dow), start: String(x?.start ?? '').padStart(5, '0'), end: String(x?.end ?? '').padStart(5, '0') }))
}

const covers = (ws: Window[], dow: number, from: number, to: number) => ws.some((x) => x.dow === dow && mins(x.start) <= from && mins(x.end) >= to - (to === 1440 ? 1 : 0))

/**
 * One calendar day on its own (restaurant-bar parity #10; 7shifts' one-time availability). For that date it REPLACES the weekly
 * pattern: off = cannot work, free = any time, between = only start to end.
 */
export interface DatedWindow { day: string; mode: 'off' | 'free' | 'between'; start?: string | null; end?: string | null }

/** The first problem with a one-day entry, as a sentence; null when fine. `today` is the company's calendar day. */
export function datedRefusal(x: { day?: unknown; mode?: unknown; start?: unknown; end?: unknown }, today: string): string | null {
  const day = String(x?.day ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T12:00:00Z'))) return 'Which day?'
  if (day < today) return "That day's already gone."
  if (x.mode !== 'off' && x.mode !== 'free' && x.mode !== 'between') return 'Say whether you can work that day, cannot, or only between two times.'
  if (x.mode === 'between') {
    if (!TIME.test(String(x.start)) || !TIME.test(String(x.end))) return 'Times look like 16:00.'
    if (mins(String(x.end)) <= mins(String(x.start))) return 'The window ends after it starts. For a late night, say until 23:59 and add the small hours on the next day.'
  }
  return null
}

/** Can this day's answer cover from..to (minutes of that day)? A one-day entry wins over the weekly windows; no weekly windows = free. */
function coversDay(ws: Window[], dated: Map<string, DatedWindow>, date: string, from: number, to: number): boolean {
  const d = dated.get(date)
  if (d) {
    if (d.mode === 'off') return false
    if (d.mode === 'free') return true
    return mins(String(d.start)) <= from && mins(String(d.end)) >= to - (to === 1440 ? 1 : 0)
  }
  if (!ws.length) return true
  return covers(ws, dayOfWeek(date), from, to)
}

/** May this person work this shift, by their weekly windows and their one-day entries? Nothing set = free to work. */
export function worksWithinOn(ws: Window[], dated: DatedWindow[], day: string, start: string, end: string): boolean {
  const map = new Map(dated.map((d) => [d.day, d]))
  const a = mins(start), b = mins(end)
  if (b > a) return coversDay(ws, map, day, a, b)
  // Past midnight: the evening on its own day, the small hours on the next.
  return coversDay(ws, map, day, a, 1440) && (b === 0 || coversDay(ws, map, addDays(day, 1), 0, b))
}

/** May this person work this shift, by their weekly windows? No windows = free to work. */
export function worksWithin(ws: Window[], day: string, start: string, end: string): boolean {
  return worksWithinOn(ws, [], day, start, end)
}
