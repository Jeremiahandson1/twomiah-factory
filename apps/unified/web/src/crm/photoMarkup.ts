// Drawing on a job photo, the web's side (server/crm/roof/photoMarkup/shapes.ts is the master; the phone's is
// apps/mobile/src/photos/markup.ts). A drawing is shapes in fractions of the picture; `primitive` turns one into the lines and
// letters to show at a given size, by the same rules as the server's marked copy (tests/roof-photo-markup.test.ts holds the three equal).
export type MarkupColor = 'red' | 'yellow' | 'white' | 'black' | 'blue'
export type TextSize = 'small' | 'medium' | 'large'
export type MarkupShape =
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: MarkupColor }
  | { kind: 'circle'; cx: number; cy: number; rx: number; ry: number; color: MarkupColor }
  | { kind: 'text'; x: number; y: number; text: string; color: MarkupColor; size: TextSize }

export const MAX_SHAPES = 40
export const MAX_TEXT = 60
export const MIN_SPAN = 0.01
export const MARKUP_COLORS: Record<MarkupColor, string> = { red: '#dc2626', yellow: '#facc15', white: '#ffffff', black: '#111827', blue: '#2563eb' }
export const COLOR_LABELS: Record<MarkupColor, string> = { red: 'Red', yellow: 'Yellow', white: 'White', black: 'Black', blue: 'Blue' }
export const TEXT_SIZES: Record<TextSize, number> = { small: 0.022, medium: 0.035, large: 0.055 }
export const SIZE_LABELS: Record<TextSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

export type Primitive =
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; head: Array<[number, number]>; width: number; color: string }
  | { kind: 'circle'; cx: number; cy: number; rx: number; ry: number; width: number; color: string }
  | { kind: 'text'; x: number; y: number; size: number; text: string; color: string; halo: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const haloFor = (c: MarkupColor) => (c === 'white' || c === 'yellow' ? '#000000' : '#ffffff')
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function primitive(s: MarkupShape, w: number, h: number): Primitive {
  const width = r2(Math.max(2, w * 0.006))
  if (s.kind === 'circle') return { kind: 'circle', cx: r2(s.cx * w), cy: r2(s.cy * h), rx: r2(s.rx * w), ry: r2(s.ry * h), width, color: MARKUP_COLORS[s.color] }
  if (s.kind === 'text') {
    const size = r2(TEXT_SIZES[s.size ?? 'medium'] * w)
    return { kind: 'text', x: r2(s.x * w), y: r2(s.y * h + size * 0.85), size, text: s.text, color: MARKUP_COLORS[s.color], halo: haloFor(s.color) }
  }
  const [x1, y1, x2, y2] = [s.x1 * w, s.y1 * h, s.x2 * w, s.y2 * h]
  const len = Math.hypot(x2 - x1, y2 - y1)
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len]
  const headLen = Math.min(width * 5, len * 0.6)
  const [bx, by] = [x2 - ux * headLen, y2 - uy * headLen]
  const [px, py] = [-uy * headLen * 0.5, ux * headLen * 0.5]
  return {
    kind: 'arrow', x1: r2(x1), y1: r2(y1), x2: r2(bx + ux * headLen * 0.2), y2: r2(by + uy * headLen * 0.2),
    head: [[r2(x2), r2(y2)], [r2(bx + px), r2(by + py)], [r2(bx - px), r2(by - py)]], width, color: MARKUP_COLORS[s.color],
  }
}

/** A finger or pointer drag from one point to another (fractions of the picture) as the shape that tool draws; null for a stray touch. */
export function shapeFromDrag(tool: 'arrow' | 'circle', a: { x: number; y: number }, b: { x: number; y: number }, color: MarkupColor): MarkupShape | null {
  const [x1, y1, x2, y2] = [clamp01(a.x), clamp01(a.y), clamp01(b.x), clamp01(b.y)]
  if (tool === 'arrow') return Math.hypot(x2 - x1, y2 - y1) >= MIN_SPAN ? { kind: 'arrow', x1, y1, x2, y2, color } : null
  const [rx, ry] = [Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2]
  if (rx < MIN_SPAN / 2 && ry < MIN_SPAN / 2) return null
  return { kind: 'circle', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.max(rx, MIN_SPAN / 2), ry: Math.max(ry, MIN_SPAN / 2), color }
}
