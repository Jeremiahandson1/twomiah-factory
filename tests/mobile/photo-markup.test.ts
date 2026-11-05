// Drawing on a job photo, on the phone (apps/mobile/src/photos/markup.ts and PhotoMarkup.tsx; docs/parity/roof-gbb-proposals.md #4,
// roof-inspection-report.md #13). Plain functions under bun, plus the wiring read from source:
//   · the phone draws every shape by the server's rules (the same lines and letters), and its limits are the server's;
//   · a drag becomes the shape its tool draws (a stray touch is nothing, a drag past the edge stops at the edge);
//   · the Views that draw a shape: a bar from point to point, a closed ring for a circle, an arrowhead turned to point along the arrow;
//   · the save goes through the offline queue (one key per photo, a body the server accepts), is worded in the waiting list,
//     and the drawing is offered only with the `photo_markup` feature and the right to add photos.
//
//   bun run tests/mobile/photo-markup.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'
import * as phone from '../../apps/mobile/src/photos/markup.ts'
import * as server from '../../apps/unified/server/crm/roof/photoMarkup/shapes.ts'
import { describeItem } from '../../apps/mobile/src/offline/describe.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const mobile = join(import.meta.dir, '../../apps/mobile')
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

const shapes: phone.MarkupShape[] = [
  { kind: 'circle', cx: 0.3, cy: 0.5, rx: 0.15, ry: 0.2, color: 'red' },
  { kind: 'arrow', x1: 0.9, y1: 0.1, x2: 0.55, y2: 0.45, color: 'blue' },
  { kind: 'text', x: 0.55, y: 0.75, text: 'Hail hits', color: 'yellow', size: 'large' },
  { kind: 'text', x: 0.1, y: 0.1, text: 'Soft spot', color: 'red', size: 'small' },
]

// ── the same rules as the server ─────────────────────────────────────────────
check('every shape is drawn exactly as the server draws it, at three sizes',
  [[400, 300], [1200, 900], [320, 568]].every(([w, h]) => shapes.every((s) => JSON.stringify(phone.primitive(s, w, h)) === JSON.stringify(server.primitive(s as any, w, h)))))
check('the colours, sizes and limits are the server’s', JSON.stringify(phone.MARKUP_COLORS) === JSON.stringify(server.MARKUP_COLORS) && JSON.stringify(phone.TEXT_SIZES) === JSON.stringify(server.TEXT_SIZES)
  && phone.MAX_SHAPES === server.MAX_SHAPES && phone.MAX_TEXT === server.MAX_TEXT && phone.MIN_SPAN === server.MIN_SPAN)
check('every colour has a name to show, not a code', Object.keys(phone.MARKUP_COLORS).every((c) => (phone.COLOR_LABELS as any)[c] && !/^#/.test((phone.COLOR_LABELS as any)[c])))

// ── a drag ───────────────────────────────────────────────────────────────────
check('a stray touch is no arrow and no circle', phone.shapeFromDrag('arrow', { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.505 }, 'red') === null && phone.shapeFromDrag('circle', { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 'red') === null)
const arrow = phone.shapeFromDrag('arrow', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.5 }, 'blue')
check('a drag is an arrow from where it began to where it ended', JSON.stringify(arrow) === JSON.stringify({ kind: 'arrow', x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.5, color: 'blue' }), arrow)
const ring = phone.shapeFromDrag('circle', { x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 }, 'red') as any
check('a circle fills the box dragged, whichever way it is dragged', Math.abs(ring.cx - 0.4) < 1e-9 && Math.abs(ring.cy - 0.5) < 1e-9 && Math.abs(ring.rx - 0.2) < 1e-9 && Math.abs(ring.ry - 0.2) < 1e-9, ring)
const past = phone.shapeFromDrag('arrow', { x: 0.5, y: 0.5 }, { x: 1.7, y: -0.4 }, 'red') as any
check('a drag past the edge stops at the edge', past.x2 === 1 && past.y2 === 0, past)
check('what a drag makes is a shape the server accepts', server.markupShape.safeParse(arrow).success && server.markupShape.safeParse(ring).success)

// ── the Views ────────────────────────────────────────────────────────────────
const b = phone.bar(10, 20, 110, 20, 4)
check('a bar along a level line is as long as the line, 4 thick, not turned', b.width === 100 && b.height === 4 && b.angle === 0 && b.left === 10 && b.top === 18, b)
const diag = phone.bar(0, 0, 30, 40, 2)
check('a bar on a slope is turned by the slope and centred on the line', Math.abs(diag.angle - Math.atan2(40, 30)) < 1e-9 && diag.width === 50 && diag.left + 25 === 15 && diag.top + 1 === 20, diag)
const circleParts = phone.parts(phone.primitive(shapes[0], 400, 300)).filter((p) => p.kind === 'bar') as Array<{ bar: phone.Bar }>
const centres = circleParts.map((p) => [p.bar.left + p.bar.width / 2, p.bar.top + p.bar.height / 2])
const around = circleParts.reduce((n, p) => n + p.bar.width, 0)
check('a circle is a ring of bars that goes round once and meets itself', circleParts.length >= 24 && Math.abs(around - 2 * Math.PI * 60) < 4, { count: circleParts.length, around })
check('the ring is round: its bars all sit on the circle', centres.every(([x, y]) => Math.abs(((x - 120) / 60) ** 2 + ((y - 150) / 60) ** 2 - 1) < 0.02))
const arrowParts = phone.parts(phone.primitive(shapes[1], 400, 300))
const head = arrowParts.find((p) => p.kind === 'triangle') as { triangle: phone.Triangle } | undefined
check('an arrow is a bar and a head', arrowParts.length === 2 && arrowParts[0].kind === 'bar' && !!head)
// A bordered triangle points UP; turned by `angle` it must point along the arrow (from tail to tip).
const turned = head ? [Math.sin(head.triangle.angle), -Math.cos(head.triangle.angle)] : [0, 0]
const along = [(0.55 - 0.9) * 400, (0.45 - 0.1) * 300].map((n, _, a) => n / Math.hypot(a[0], a[1]))
check('the head points the way the arrow goes', Math.abs(turned[0] - along[0]) < 1e-6 && Math.abs(turned[1] - along[1]) < 1e-6, { turned, along })
const word = phone.parts(phone.primitive(shapes[2], 400, 300))[0] as any
check('lettering is placed by its top left, and carries its edge colour', word.kind === 'text' && word.x === 220 && Math.abs(word.y - (0.75 * 300)) < 0.02 && word.halo === '#000000', word)

// ── the save ─────────────────────────────────────────────────────────────────
const save = phone.markupSave('photo1', shapes, 'J-12')
check('the save is one PUT to the markup door, keyed by the photo, worded for the waiting list',
  save.path === '/api/photo-markup/photo1' && save.opts.recordKey === 'photo-markup:photo1' && save.opts.label === 'J-12 · photo marked', save)
check('the body is one the server accepts', server.markupBody.safeParse(save.body).success)
check('taking every mark off is still a save, worded as such', phone.markupSave('photo1', []).opts.label === 'photo marks removed' && server.markupBody.safeParse(phone.markupSave('photo1', []).body).success)
const line = describeItem({ id: 'q1', method: 'PUT', path: save.path, body: save.body, recordKey: save.opts.recordKey, label: undefined, state: 'waiting', blocked: false, tries: 0 } as any)
check('with no label the waiting list still says what it is', line.title === 'Photo marks', line.title)

// ── the wiring ───────────────────────────────────────────────────────────────
const gallery = src('src/components/PhotoGallery.tsx'), screen = src('src/photos/PhotoMarkup.tsx')
check('drawing is offered only with the photo_markup feature, to a person who may add photos', /mayDraw\s*=\s*canAdd\s*&&\s*photosOnJob\(vertical\)\s*&&\s*hasFeature\('photo_markup'\)/.test(gallery) && /mayDraw && viewPhoto/.test(gallery))
check('the marks are saved through the offline queue, not sent around it', /useOfflineApi/.test(screen) && /put\(s\.path, s\.body, s\.opts\)/.test(screen) && !/\bfetch\(|upload\(/.test(screen))
check('a save kept on the phone is shown as waiting, not as done', /res\.queued/.test(screen) && /when there is signal/.test(screen))
check('a marked copy is labelled as one in the gallery', /Marked/.test(gallery) && /sourcePhotoId/.test(gallery))
check('the colours are named for a screen reader, not shown as codes', /accessibilityLabel=\{COLOR_LABELS\[c\]\}/.test(screen))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
