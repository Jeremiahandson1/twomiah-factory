// The schedule engine's time rules. Moved from templates/crm-homecare/backend/src/services/scheduleOccurrences.ts.
// The engine itself (occurrencesCte, schedTime, wallClock) is SQL and lives in server/data/homecareCore.ts; what is
// here is pure: reading and writing a shift's wall-clock times, and THE rule for a shift's start and end.

/** 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS', or null when it is not a time. */
export function hms(t: unknown): string | null {
  if (t === null || t === undefined || t === '') return null
  const m = String(t).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3] || 0)
  if (h > 23 || mi > 59 || s > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}:${String(s).padStart(2, '0')}`
}

/**
 * The value written to a schedules.start_time / end_time TIMESTAMP column for a wall-clock time: 'YYYY-MM-DD HH:MM:SS'
 * on the row's own date (one-time) or its effective date (recurring). Cast with ::timestamp in SQL.
 */
export function schedTs(time: unknown, baseDate: string): string | null {
  const t = hms(time)
  if (!t) return null
  return `${String(baseDate).slice(0, 10)} ${t}`
}

/**
 * Hours between two HH:MM(:SS) times, wrapping past midnight (13:00 → 12:00 is 23, not -1; equal times are a 24-hour
 * shift). 0 when either is missing or not a time.
 */
export function shiftHours(start: unknown, end: unknown): number {
  const a = hms(start), b = hms(end)
  if (!a || !b) return 0
  const toMin = (x: string) => { const [h, m, s] = x.split(':').map(Number); return h * 60 + m + s / 60 }
  const h = (toMin(b) - toMin(a)) / 60
  return h <= 0 ? h + 24 : h
}

/**
 * THE rule for a shift's start and end, shared by every schedule writer (POST /schedules, POST /schedules-enhanced,
 * PUT /schedules-all/:id, POST /open-shifts) and mirrored by the forms. The engine supports a shift that runs past
 * midnight, but an end typed before the start is far more often a slip ("9:00am – 8:00am", Run 3) than a 23-hour
 * shift. So an end before the start is refused unless the writer says the shift is OVERNIGHT, and equal times are
 * refused always. Returns the message to show, or null when fine.
 */
export function shiftTimesError(start: unknown, end: unknown, overnight?: unknown): string | null {
  const a = hms(start), b = hms(end)
  if (!a || !b) return 'A valid start and end time are required.'
  if (a === b) return 'Start and end time cannot be the same'
  if (b < a && overnight !== true) {
    return 'The end time is before the start time. If the shift runs past midnight, mark it as overnight.'
  }
  return null
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
