// The parts of an appointment that actually hold a stylist (salon gaps #4 and #5).
//
// A plain appointment holds its stylist from start to end. A colour with PROCESSING TIME frees the stylist while it develops:
// they are hands-on for `afterMin` minutes, free for `min` minutes, then hands-on again to the end — so another client can be
// booked into the gap. A MULTI-SERVICE visit holds each stylist only for the services they do. Both come down to the same
// thing: a list of time pieces per stylist, and a clash is any two pieces of the same stylist that overlap.
// Times are milliseconds; a piece is [start, end).

export interface Piece { start: number; end: number }
/**
 * A service as a SEQUENCE (salon parity row 7; Fresha's processing, blocked and extra time): any number of segments in order, each a
 * kind and its minutes. 'service' is hands-on; 'processing' frees the stylist (the client stays — colour develops); 'blocked' holds
 * the stylist and the chair (nothing may be booked into it); 'extra' is extra servicing time after or between (the stylist is busy).
 * Only processing frees the stylist, so a clash, an online time and the Book's hatching all follow the sequence.
 */
export type SegmentKind = 'service' | 'processing' | 'blocked' | 'extra'
export interface Segment { kind: SegmentKind; minutes: number }
export const SEGMENT_KINDS: SegmentKind[] = ['service', 'processing', 'blocked', 'extra']
export interface Processing { afterMin: number | null | undefined; min: number | null | undefined; /** Row 7: the whole sequence, when the service has one; it wins over afterMin / min. */ segments?: Segment[] | null }

/** The stretches of a sequence that hold the stylist, as minutes from the start ([from, to)); touching ones joined. */
export function heldMinutes(segments: Segment[]): Array<{ fromMin: number; toMin: number }> {
  const out: Array<{ fromMin: number; toMin: number }> = []
  let at = 0
  for (const sg of segments) {
    const m = Math.max(0, Math.round(Number(sg.minutes) || 0))
    if (sg.kind !== 'processing' && m > 0) {
      const last = out[out.length - 1]
      if (last && last.toMin === at) last.toMin = at + m
      else out.push({ fromMin: at, toMin: at + m })
    }
    at += m
  }
  return out
}

/** A sequence that is usable: an array of known kinds with whole minutes; anything else is none (the old single gap is read instead). */
export const asSegments = (v: unknown): Segment[] | null => {
  if (!Array.isArray(v) || !v.length) return null
  const out = v.map((x: any) => ({ kind: x?.kind, minutes: Number(x?.minutes) }))
  return out.every((x) => SEGMENT_KINDS.includes(x.kind) && Number.isInteger(x.minutes) && x.minutes > 0) ? out as Segment[] : null
}

/** Why a sequence cannot be used for a service of `durationMin`; null = fine (or no sequence). */
export function segmentsProblem(v: unknown, durationMin: number): string | null {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return null
  if (!Array.isArray(v)) return 'The steps must be a list.'
  if (v.length > 12) return 'A service has 12 steps or fewer.'
  for (const [i, x] of (v as any[]).entries()) {
    if (!SEGMENT_KINDS.includes(x?.kind)) return `Step ${i + 1} must be hands-on, processing, blocked or extra time.`
    if (!Number.isInteger(Number(x?.minutes)) || Number(x?.minutes) <= 0) return `Step ${i + 1} needs a whole number of minutes, 1 or more.`
  }
  const total = (v as any[]).reduce((s, x) => s + Number(x.minutes), 0)
  if (total !== durationMin) return `The steps come to ${total} minutes; the service is ${durationMin}. They must add up to it.`
  if (!(v as any[]).some((x) => x.kind !== 'processing')) return 'A service needs at least one step that is not processing.'
  return null
}

/** The sequence a row stands for: its own, else the old single gap turned into one (hands-on, processing, hands-on). */
export function segmentsOf(row: { segments?: unknown; processingAfterMin?: number | null; processingMin?: number | null }, durationMin: number): Segment[] {
  const own = asSegments(row.segments)
  if (own) return own
  const after = Number(row.processingAfterMin), gap = Number(row.processingMin)
  if (!Number.isFinite(gap) || gap <= 0 || !Number.isFinite(after) || after < 0 || after + gap > durationMin) return [{ kind: 'service', minutes: durationMin }]
  return [
    ...(after > 0 ? [{ kind: 'service' as const, minutes: after }] : []),
    { kind: 'processing' as const, minutes: gap },
    ...(durationMin - after - gap > 0 ? [{ kind: 'service' as const, minutes: durationMin - after - gap }] : []),
  ]
}

/** The pieces that hold a stylist across [start, end), minus the processing gap. No (or unusable) gap: the whole span. */
export function piecesOf(start: number, end: number, p?: Processing | null): Piece[] {
  // Row 7: a sequence holds the stylist for every step but processing (cut at the appointment's own end, if it was shortened).
  const seq = asSegments(p?.segments)
  if (seq) {
    const out = heldMinutes(seq).map((h) => ({ start: start + h.fromMin * 60_000, end: Math.min(end, start + h.toMin * 60_000) })).filter((x) => x.end > x.start)
    return out.length ? out : [{ start, end }]
  }
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
