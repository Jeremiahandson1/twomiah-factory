// The ONE definition of "which fortnight is this bi-weekly shift on". Ported from the CVHC home
// care CRM (helpers/biweekly.js).
//
// A bi-weekly row is `frequency='biweekly'` + `anchor_date`. The engine (scheduleOccurrences.ts)
// and every JS expander only reliably agree on parity when anchor_date falls on the row's own
// day_of_week — then every on-date is an exact multiple of 7 days from the anchor and no rounding
// rule can disagree. A frontend copy of isBiweeklyOn lives in frontend/src/utils/biweekly.ts.

const MS_DAY = 86400000

/** Any date-ish value → 'YYYY-MM-DD'. */
export function toYMD(v: unknown): string | null {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return [y, m - 1, d]
}

/** Whole calendar days from a to b, in UTC so DST never yields 6.96 days. */
export function dayDiff(aYMD: string, bYMD: string): number {
  return Math.round((Date.UTC(...ymdParts(bYMD)) - Date.UTC(...ymdParts(aYMD))) / MS_DAY)
}

export function dowOf(ymd: string): number {
  return new Date(Date.UTC(...ymdParts(ymd))).getUTCDay()
}

export function addDays(ymd: string, n: number): string {
  return new Date(Date.UTC(...ymdParts(ymd)) + n * MS_DAY).toISOString().slice(0, 10)
}

/** floor((date - anchor) / 7) is even → on week. No anchor → treat as weekly. */
export function isBiweeklyOn(dateYMD: string, anchor: unknown): boolean {
  const a = toYMD(anchor)
  if (!a) return true
  const weeks = Math.floor(dayDiff(a, toYMD(dateYMD)!) / 7)
  return ((weeks % 2) + 2) % 2 === 0
}

/**
 * The anchor a bi-weekly row should store: the first date on/after max(anchorDate, effectiveDate)
 * that falls on dayOfWeek. Editing an existing bi-weekly row WITHOUT moving its weekday or changing
 * its anchor keeps the old row's fortnight parity.
 */
export function alignBiweeklyAnchor({ anchorDate, effectiveDate, dayOfWeek, previous }: {
  anchorDate?: unknown; effectiveDate?: unknown; dayOfWeek?: unknown;
  previous?: { anchor_date?: unknown; day_of_week?: unknown } | null
} = {}): string | null {
  if (dayOfWeek === null || dayOfWeek === undefined) return toYMD(anchorDate)
  const dow = Number(dayOfWeek)
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return toYMD(anchorDate)
  const a = toYMD(anchorDate)
  const e = toYMD(effectiveDate)
  const base = [a, e].filter(Boolean).sort().pop() as string | undefined
  if (!base) return null
  let candidate = addDays(base, (dow - dowOf(base) + 7) % 7)
  const prevAnchor = previous ? toYMD(previous.anchor_date) : null
  const sameDay = !!previous && Number(previous.day_of_week) === dow
  const anchorUntouched = !a || a === prevAnchor
  if (prevAnchor && sameDay && anchorUntouched && !isBiweeklyOn(candidate, prevAnchor)) {
    candidate = addDays(candidate, 7)
  }
  return candidate
}
