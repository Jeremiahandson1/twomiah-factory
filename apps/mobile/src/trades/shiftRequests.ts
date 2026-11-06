/**
 * The pure rules behind the phone's availability, swap and pick-up screens (restaurant-bar parity #11). The screens are data in bar.ts;
 * what they SEND and SAY is worked out here so tests/mobile/bar-shift-requests.test.ts can hold it without a device.
 * Every call goes to the route the desktop's Schedule page uses (apps/unified server/crm/bar/barScheduleRoutes.ts).
 */
import { calDay, hhmm } from './kit'

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export interface Win { dow: number; start: string; end: string }

/** '5pm', '5:30 PM', '17:00', '9' → '17:00' style (zero-padded 24-hour). Anything else comes back as typed, so the server's own "Times look like 16:00" answers. */
export function clock24(text: unknown): string {
  const raw = String(text ?? '').trim()
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i.exec(raw)
  if (!m) return raw
  let h = +m[1]; const min = m[2] ?? '00'; const ap = (m[3] || '').toLowerCase()
  if (+min > 59) return raw
  if (ap) { if (h < 1 || h > 12) return raw; h = (h % 12) + (ap.startsWith('p') ? 12 : 0) } else if (h > 23) return raw
  return `${String(h).padStart(2, '0')}:${min}`
}

const FREE: Omit<Win, 'dow'> = { start: '00:00', end: '23:59' }
export const WEEK_CHOICES = { free: 'Free any time', between: 'Only between two times', off: 'Cannot work' } as const

/**
 * My usual week after changing one day. The server reads an EMPTY week as "free any time", so changing one day of an empty week first
 * writes the other six as free; "cannot work" is simply no window that day.
 */
export function weekAfter(current: Win[], dow: number, what: string, start?: string, end?: string): Win[] {
  const base: Win[] = current.length ? current : DAY_NAMES.map((_, i) => ({ dow: i, ...FREE }))
  const others = base.filter((w) => w.dow !== dow)
  if (what === WEEK_CHOICES.off) return others.sort((a, b) => a.dow - b.dow)
  const mine: Win = what === WEEK_CHOICES.between ? { dow, start: clock24(start), end: clock24(end) } : { dow, ...FREE }
  return [...others, mine].sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start))
}

/** A day's windows in words ('4:00 PM–11:00 PM'); undefined when there are none. */
export const windowWords = (ws: Win[], dow: number): string | undefined => {
  const mine = ws.filter((w) => w.dow === dow).sort((a, b) => a.start.localeCompare(b.start))
  return mine.length ? mine.map((w) => (w.start === '00:00' && w.end === '23:59' ? 'Any time' : `${hhmm(w.start)}–${hhmm(w.end)}`)).join(', ') : undefined
}

export const DATE_CHOICES = { free: 'I can work any time', between: 'Only between two times', off: 'I cannot work' } as const
const DATE_MODE: Record<string, string> = { [DATE_CHOICES.free]: 'free', [DATE_CHOICES.between]: 'between', [DATE_CHOICES.off]: 'off' }
/** The body for one day's availability (POST /api/schedule/availability/dates/mine). */
export function dateBody(v: Record<string, string>) {
  const mode = DATE_MODE[v.mode] ?? v.mode
  return { day: String(v.day ?? '').trim(), mode, ...(mode === 'between' ? { start: clock24(v.start), end: clock24(v.end) } : {}), note: v.note || undefined }
}
export const dateWords = (e: { mode?: string; start?: string | null; end?: string | null }) =>
  e.mode === 'off' ? 'Cannot work' : e.mode === 'between' ? `${hhmm(e.start) || e.start}–${hhmm(e.end) || e.end}` : 'Free any time'

export const STATUS: Record<string, string> = {
  open: 'Waiting for someone to take it', offered: 'Waiting for their answer', pending: 'Waiting for a manager', approved: 'Approved', denied: 'Denied',
  declined: 'Declined', cancelled: 'Taken back', expired: 'Ran out of time before the shift', schedule_changed: 'Cancelled: the schedule changed',
}
export const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { open: 'info', offered: 'info', pending: 'warning', approved: 'success', denied: 'danger', declined: 'danger', cancelled: 'neutral', expired: 'neutral', schedule_changed: 'neutral' }

/** 'Fri, Nov 20, 5:00 PM–11:00 PM · Bar'. */
export const shiftWords = (s: { day?: string; start?: string; end?: string; position?: string | null } | null | undefined) =>
  s ? [`${calDay(s.day) ?? s.day}, ${hhmm(s.start) || s.start}–${hhmm(s.end) || s.end}`, s.position].filter(Boolean).join(' · ') : ''

export type Group = 'for-me' | 'on-offer' | 'mine'
/** The three lists of GET /api/schedule/swaps/mine as one list, each row marked with where it came from and what picking a shift up will mean here. */
export function swapRows(b: any): any[] {
  const pickupsNeedManager = b?.settings?.approvePickups !== false
  const swapsNeedManager = b?.settings?.approveSwaps !== false
  const mark = (rows: any[] | undefined, group: Group) => (rows || []).map((r) => ({ ...r, _group: group, _pickupsNeedManager: pickupsNeedManager, _swapsNeedManager: swapsNeedManager }))
  return [...mark(b?.forMe, 'for-me'), ...mark(b?.onOffer, 'on-offer'), ...mark(b?.mine, 'mine')]
}
export const mayTakeBack = (r: { _group?: string; status?: string }) => r._group === 'mine' && ['open', 'offered', 'pending'].includes(String(r.status))

/** My coming shifts that someone else could take instead, for the swap picker: other people's published shifts from today on, this phone's calendar day. */
export function swapChoices(body: any, row: any, today: string): any[] {
  return (body?.weeks || []).flatMap((w: any) => (w.published ? w.shifts : [])).filter((s: any) => s.id && s.userId !== row?._me && s.userId !== row?.userId && String(s.day) >= today)
}
export const choiceLabel = (s: any) => `${s.name || 'Someone'}: ${shiftWords(s)}`
/** The phone's calendar day as YYYY-MM-DD (never through UTC). */
export const localDay = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/** A person's declared cash tips: '12.50', '$12', '12' → whole cents; null when empty; NaN when it is not an amount. */
export function cashCents(text: unknown): number | null {
  const t = String(text ?? '').replace(/[$,\s]/g, '')
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN
  return Math.round(Number(t) * 100)
}
/** The save that goes right after a clock-out when cash tips were typed: the moment of the tap, from the phone, added to the night's total. */
export const declaredBody = (cents: number, tapped: Date) => ({ amountCents: cents, at: tapped.toISOString(), via: 'phone', mode: 'add' })
