// Retention over several return windows (salon parity row 14; Boulevard "Client retention" and "Staff client retention", Timely's retention report).
//
// Of the clients who had a visit in the period, how many were back within N days — for several N at once (30 / 60 / 90 / 120 by default, the
// owner picks up to six, 7 to 365 days). Pure arithmetic here; the visits come from data/salon.ts visitsWithNext.
//
// The anchor is a client's FIRST visit in the period (with the service asked for, when the report is sliced by service); "back" is any later
// visit of that client, of any service, within N days of the anchor. A client whose anchor is less than N days old has not had N days to come
// back, so they are left out of that window's count (and the report says how many were counted), never counted as lost.

export const DEFAULT_WINDOWS = [30, 60, 90, 120]
export const WINDOWS_KEY = 'retentionWindows'
export const MAX_WINDOWS = 6
export const MIN_WINDOW_DAYS = 7
export const MAX_WINDOW_DAYS = 365
const DAY = 86400_000

/** A list a person typed or sent ("30, 60 ,90" or [30,60,90]) as sorted, distinct windows; or the sentence saying what is wrong. */
export function parseWindows(raw: unknown): { windows: number[] } | { problem: string } {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/).filter(Boolean) : null
  if (!parts || !parts.length) return { problem: `Choose at least one window, from ${MIN_WINDOW_DAYS} to ${MAX_WINDOW_DAYS} days.` }
  const out = new Set<number>()
  for (const p of parts) {
    const n = typeof p === 'string' && p.trim() !== '' ? Number(p) : p
    if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_WINDOW_DAYS || n > MAX_WINDOW_DAYS) return { problem: `Each window is a whole number of days from ${MIN_WINDOW_DAYS} to ${MAX_WINDOW_DAYS}.` }
    out.add(n)
  }
  if (out.size > MAX_WINDOWS) return { problem: `Choose at most ${MAX_WINDOWS} windows.` }
  return { windows: [...out].sort((a, b) => a - b) }
}

/** The salon's saved windows (company settings), the defaults when none were saved. */
export function readWindows(settings: unknown): number[] {
  const saved = (settings as any)?.[WINDOWS_KEY]
  const parsed = saved === undefined ? null : parseWindows(saved)
  return parsed && 'windows' in parsed ? parsed.windows : DEFAULT_WINDOWS
}

export interface ReturnVisit { contactId: string; performedAt: Date; nextAt: Date | null }
export interface WindowRate { days: number; /** Clients who had had this long to come back. */ counted: number; returned: number; ratePercent: number | null }

const pct = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 1000) / 10 : null)

/** Each client's anchor visit: their first one in the list (the list is in time order). */
export function anchors<T extends ReturnVisit>(visits: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const v of visits) { if (seen.has(v.contactId)) continue; seen.add(v.contactId); out.push(v) }
  return out
}

/** The rate for each window over these anchor visits, as of `now`. */
export function ratesFor(anchorVisits: ReturnVisit[], windows: number[], now: Date): WindowRate[] {
  return windows.map((days) => {
    let counted = 0, returned = 0
    for (const v of anchorVisits) {
      const closes = v.performedAt.getTime() + days * DAY
      if (closes > now.getTime()) continue          // not yet had the whole window: counting only those who already came back would flatter it
      counted++
      if (v.nextAt && v.nextAt.getTime() <= closes) returned++
    }
    return { days, counted, returned, ratePercent: pct(returned, counted) }
  })
}
