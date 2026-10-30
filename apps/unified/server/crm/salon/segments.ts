// The parts of an appointment that actually hold a stylist (salon gaps #4 and #5).
//
// A plain appointment holds its stylist from start to end. A colour with PROCESSING TIME frees the stylist while it develops:
// they are hands-on for `afterMin` minutes, free for `min` minutes, then hands-on again to the end — so another client can be
// booked into the gap. A MULTI-SERVICE visit holds each stylist only for the services they do. Both come down to the same
// thing: a list of time pieces per stylist, and a clash is any two pieces of the same stylist that overlap.
// Times are milliseconds; a piece is [start, end).

export interface Piece { start: number; end: number }
export interface Processing { afterMin: number | null | undefined; min: number | null | undefined }

/** The pieces that hold a stylist across [start, end), minus the processing gap. No (or unusable) gap: the whole span. */
export function piecesOf(start: number, end: number, p?: Processing | null): Piece[] {
  const after = Number(p?.afterMin), gap = Number(p?.min)
  if (!p || !Number.isFinite(after) || !Number.isFinite(gap) || after < 0 || gap <= 0) return [{ start, end }]
  const gapStart = start + after * 60_000
  const gapEnd = gapStart + gap * 60_000
  if (gapStart >= end) return [{ start, end }]
  const out: Piece[] = []
  if (gapStart > start) out.push({ start, end: gapStart })
  if (gapEnd < end) out.push({ start: gapEnd, end })
  return out
}

/** True when any piece of `a` overlaps any piece of `b`. */
export const touch = (a: Piece[], b: Piece[]) => a.some((x) => b.some((y) => x.start < y.end && x.end > y.start))

/** Why a processing gap cannot be used with this service length; null = fine. Both unset = none. */
export function processingProblem(afterMin: unknown, min: unknown, durationMin: number): string | null {
  const unset = (v: unknown) => v === null || v === undefined || v === ''
  if (unset(afterMin) && unset(min)) return null
  if (unset(min) || Number(min) <= 0) return 'Processing time must be at least 1 minute.'
  const a = unset(afterMin) ? 0 : Number(afterMin), m = Number(min)
  if (!Number.isInteger(a) || a < 0) return 'Minutes of hands-on work before processing must be a whole number, 0 or more.'
  if (!Number.isInteger(m)) return 'Processing time must be a whole number of minutes.'
  if (a + m > durationMin) return `Hands-on time plus processing (${a + m} minutes) cannot be longer than the service (${durationMin} minutes).`
  return null
}
