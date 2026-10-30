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

/** May this person work this shift, by their windows? No windows = free to work. */
export function worksWithin(ws: Window[], day: string, start: string, end: string): boolean {
  if (!ws.length) return true
  const dow = dayOfWeek(day)
  const a = mins(start), b = mins(end)
  if (b > a) return covers(ws, dow, a, b)
  // Past midnight: the evening on its own day, the small hours on the next.
  return covers(ws, dow, a, 1440) && (b === 0 || covers(ws, dayOfWeek(addDays(day, 1)), 0, b))
}
