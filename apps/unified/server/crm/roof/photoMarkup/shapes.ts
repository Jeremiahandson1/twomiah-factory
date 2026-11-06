// Drawing on a job photo (docs/parity/roof-gbb-proposals.md #4, roof-inspection-report.md #13): arrows, circles and text.
//
// A drawing is a list of SHAPES in fractions of the picture (0 to 1 across, 0 to 1 down), so the same drawing lands in the
// same place on the web, on the phone and in the marked copy the server draws, whatever size each shows the photo at. Every
// size (line width, arrowhead, lettering) follows the picture's width. `primitives` is the one set of rules for turning a shape
// into lines and letters at a given size; the web editor (web/src/crm/photoMarkup.ts) and the phone (apps/mobile/src/photos/
// markup.ts) carry the same rules, and tests/roof-photo-markup.test.ts holds the three to the same answers.
import { z } from 'zod'
import { stripHtml } from '../../../core/sanitize.ts'

export const MAX_SHAPES = 40
export const MAX_TEXT = 60
/** The colours a person can draw in (name -> what is drawn). Names, not codes, are what the screens show. */
export const MARKUP_COLORS = { red: '#dc2626', yellow: '#facc15', white: '#ffffff', black: '#111827', blue: '#2563eb' } as const
export type MarkupColor = keyof typeof MARKUP_COLORS
export const MARKUP_COLOR_NAMES = Object.keys(MARKUP_COLORS) as MarkupColor[]
export const TEXT_SIZES = { small: 0.022, medium: 0.035, large: 0.055 } as const
export type TextSize = keyof typeof TEXT_SIZES
/** A mark shorter than this (a fraction of the picture) is a stray touch, not an arrow or a circle. */
export const MIN_SPAN = 0.01

const unit = z.number().min(0).max(1)
const color = z.enum(MARKUP_COLOR_NAMES as [MarkupColor, ...MarkupColor[]])
const arrow = z.object({ kind: z.literal('arrow'), x1: unit, y1: unit, x2: unit, y2: unit, color })
  .refine((a) => Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= MIN_SPAN, { message: 'An arrow needs a length', path: ['x2'] })
const circle = z.object({ kind: z.literal('circle'), cx: unit, cy: unit, rx: z.number().min(MIN_SPAN / 2).max(0.5), ry: z.number().min(MIN_SPAN / 2).max(0.5), color })
const text = z.object({
  kind: z.literal('text'), x: unit, y: unit, color,
  text: z.string().transform(stripHtml).pipe(z.string().min(1, 'Say what the text should read').max(MAX_TEXT, `Text is ${MAX_TEXT} characters at most`)),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
})
export const markupShape = z.discriminatedUnion('kind', [arrow, circle, text])
export const markupBody = z.object({ shapes: z.array(markupShape).max(MAX_SHAPES, `A photo holds ${MAX_SHAPES} marks at most`) })
export type MarkupShape = z.infer<typeof markupShape>

export type Primitive =
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; head: Array<[number, number]>; width: number; color: string }
  | { kind: 'circle'; cx: number; cy: number; rx: number; ry: number; width: number; color: string }
  | { kind: 'text'; x: number; y: number; size: number; text: string; color: string; halo: string }

const r2 = (n: number) => Math.round(n * 100) / 100
/** Light lettering gets a dark edge and dark lettering a light one, so it reads on any roof. */
const haloFor = (c: MarkupColor) => (c === 'white' || c === 'yellow' ? '#000000' : '#ffffff')

/** One shape as lines and letters on a picture `w` by `h` wide (pixels, points - the unit is the caller's). */
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

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The drawing as an SVG layer exactly `w` by `h`, to lay over the photo. */
export function markupSvg(shapes: MarkupShape[], w: number, h: number): string {
  const body = shapes.map((s) => {
    const p = primitive(s, w, h)
    if (p.kind === 'circle') return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="none" stroke="${p.color}" stroke-width="${p.width}"/>`
    if (p.kind === 'text') return `<text x="${p.x}" y="${p.y}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="bold" font-size="${p.size}" fill="${p.color}" stroke="${p.halo}" stroke-width="${r2(p.size * 0.12)}" stroke-linejoin="round" paint-order="stroke">${esc(p.text)}</text>`
    return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round"/>`
      + `<polygon points="${p.head.map((q) => q.join(',')).join(' ')}" fill="${p.color}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}
