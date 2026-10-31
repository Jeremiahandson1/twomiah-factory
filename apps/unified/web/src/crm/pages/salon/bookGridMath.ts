// The Book's time grid: the arithmetic, apart from the screen (BookGrid.tsx) so it is tested without a browser
// (tests/salon-book-grid.test.ts). Minutes are minutes since midnight on the company's clock; a piece is one stretch of a column.

export const SNAP_MIN = 15
export const PX_PER_MIN = 1.1
export const MIN_CARD_MIN = 15

export interface Gap { afterMin?: number | null; min?: number | null }
/** One stretch of a card: hands-on work, or processing (the stylist is free, the client sits). */
export interface Piece { start: number; end: number; kind: 'work' | 'processing' }

/** A card's stretches: work, then the processing gap (when it has a usable one), then work again. No gap: one piece of work. */
export function piecesFor(start: number, end: number, gap?: Gap | null): Piece[] {
  const after = Number(gap?.afterMin ?? 0), min = Number(gap?.min)
  if (!gap || !Number.isFinite(min) || min <= 0 || !Number.isFinite(after) || after < 0) return [{ start, end, kind: 'work' }]
  const gs = start + after, ge = Math.min(end, gs + min)
  if (gs >= end) return [{ start, end, kind: 'work' }]
  const out: Piece[] = []
  if (gs > start) out.push({ start, end: gs, kind: 'work' })
  out.push({ start: gs, end: ge, kind: 'processing' })
  if (ge < end) out.push({ start: ge, end, kind: 'work' })
  return out
}

/** The nearest step. */
export const snap = (min: number, step = SNAP_MIN) => Math.round(min / step) * step

/** The hours the grid shows: `open`..`close` (default 8:00–19:00), stretched to whole hours to hold everything on it. */
export function gridRange(spans: Array<{ start: number; end: number }>, open = 8 * 60, close = 19 * 60): { from: number; to: number } {
  let from = open, to = close
  for (const s of spans) { from = Math.min(from, s.start); to = Math.max(to, s.end) }
  from = Math.max(0, Math.floor(from / 60) * 60)
  to = Math.min(24 * 60, Math.ceil(to / 60) * 60)
  return { from, to }
}

/** Cards that overlap in a column sit side by side: each gets a lane and the number of lanes in its cluster. */
export function lanes<T extends { start: number; end: number }>(items: T[]): Array<T & { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Array<T & { lane: number; lanes: number }> = []
  let cluster: Array<T & { lane: number; lanes: number }> = []
  let clusterEnd = -Infinity
  const close = () => { const n = Math.max(1, ...cluster.map((c) => c.lane + 1)); for (const c of cluster) c.lanes = n; out.push(...cluster); cluster = [] }
  const laneEnds: number[] = []
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) { close(); laneEnds.length = 0 }
    let lane = laneEnds.findIndex((e) => e <= it.start)
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.end) } else laneEnds[lane] = it.end
    cluster.push({ ...it, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  if (cluster.length) close()
  return out
}

/** The least a card can be when dragged short: a slot, up to the usual 15 minutes. */
export const minCardFor = (step: number) => Math.min(MIN_CARD_MIN, step)

/** Dragging a card `dy` pixels: its new start, snapped to the slot (`step`, default 15), kept inside the day. */
export function movedStart(startMin: number, lengthMin: number, dy: number, pxPerMin = PX_PER_MIN, step = SNAP_MIN): number {
  const next = snap(startMin + dy / pxPerMin, step)
  return Math.min(Math.max(0, next), 24 * 60 - Math.max(lengthMin, minCardFor(step)))
}

/** Dragging a card's bottom edge `dy` pixels: its new end, snapped to the slot, never shorter than the least a card can be. */
export function resizedEnd(startMin: number, endMin: number, dy: number, pxPerMin = PX_PER_MIN, step = SNAP_MIN): number {
  return Math.min(24 * 60, Math.max(startMin + minCardFor(step), snap(endMin + dy / pxPerMin, step)))
}

/** The column under a pointer: the one whose horizontal span holds `x`, else the nearest end. */
export function columnAt(x: number, spans: Array<{ left: number; right: number }>): number {
  if (!spans.length) return -1
  const i = spans.findIndex((s) => x >= s.left && x < s.right)
  if (i >= 0) return i
  return x < spans[0].left ? 0 : spans.length - 1
}

/** "HH:MM" for a minute of the day. */
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** A steady colour for a service name: the same service is the same hue everywhere on the grid. */
export function serviceHue(name: string | null | undefined): number {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
