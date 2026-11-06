// Print the measurements (Yardbook "print measurements"): a PDF of the property's drawn shapes over its satellite picture, each
// shape numbered and labelled with what it measures and its area, then a table of every shape and the totals by type — the
// totals with overlaps counted once and cut-outs taken away (data/siteShapes.ts typeTotals), the same figures Area Pricing
// prices. Feature `measure_print` (hidden, not ready).
//
// The satellite picture comes from Google's Static Maps API with the server's key (GOOGLE_MAPS_API_KEY — the owner's step is
// to turn on "Maps Static API" for that key in Google Cloud). Without a key, or when Google does not answer, the shapes are
// still drawn to scale on a plain background and the page says the picture could not be had. The shapes are drawn by us, not by
// Google, so their labels can say what each one is.
import { Hono } from 'hono'
import PDFDocument from 'pdfkit'
import { and, eq } from 'drizzle-orm'
import { company, site } from '../../db/schema/index.ts'
import { companyTimeZone } from '@twomiah/tenant-backend'
import { shapesOf, typeTotals } from '../../data/siteShapes.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail } from '../../http/reply.ts'

export const MEASURE_PRINT_FEATURE = 'measure_print'

export const TYPE_NAMES: Record<string, string> = { lawnSqft: 'Lawn', bedSqft: 'Beds', hardscapeSqft: 'Hardscape', drivewaySqft: 'Driveway', lotSqft: 'Whole lot' }
const TYPE_COLORS: Record<string, string> = { lawnSqft: '#16a34a', bedSqft: '#b45309', hardscapeSqft: '#6b7280', drivewaySqft: '#2563eb', lotSqft: '#9333ea' }
const CUT_COLOR = '#dc2626'

/** Static Maps' largest free picture (640 × 640, doubled for print with scale=2). */
const IMG_W = 640
const IMG_H = 420
const TILE = 256

/** A corner on Web Mercator's world map at zoom 0, in pixels (the projection Google's pictures use). */
function world([lat, lng]: [number, number]): [number, number] {
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return [TILE * (0.5 + lng / 360), TILE * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))]
}

/**
 * The picture that holds every corner: its centre, and the zoom at which the shapes fill it with a margin. Returns the
 * function that places a corner on the picture, in the picture's pixels.
 */
export function framing(paths: Array<Array<[number, number]>>) {
  const pts = paths.flat().map(world)
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  // The largest whole zoom (Static Maps takes whole zooms) at which the shapes fit inside 85% of the picture.
  let zoom = 21
  while (zoom > 1 && ((maxX - minX) * 2 ** zoom > IMG_W * 0.85 || (maxY - minY) * 2 ** zoom > IMG_H * 0.85)) zoom--
  const k = 2 ** zoom
  // Back from world pixels to latitude/longitude for the picture's centre.
  const lng = (cx / TILE - 0.5) * 360
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / TILE))) * 180) / Math.PI
  const place = (p: [number, number]): [number, number] => { const [x, y] = world(p); return [(x - cx) * k + IMG_W / 2, (y - cy) * k + IMG_H / 2] }
  return { center: [lat, lng] as [number, number], zoom, place }
}

/** The satellite picture from Google, or null with the reason (no key, or Google refused). */
async function satellite(center: [number, number], zoom: number): Promise<{ png: Buffer } | { reason: string }> {
  const key = process.env.GOOGLE_MAPS_API_KEY || ''
  if (!key) return { reason: 'No satellite picture: the map key is not set up for printing.' }
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${center[0].toFixed(7)},${center[1].toFixed(7)}&zoom=${zoom}&size=${IMG_W}x${IMG_H}&scale=2&maptype=satellite&key=${encodeURIComponent(key)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const type = res.headers.get('content-type') || ''
    if (!res.ok || !type.startsWith('image/')) return { reason: 'No satellite picture: Google did not send one (is the Maps Static API turned on for the key?).' }
    return { png: Buffer.from(await res.arrayBuffer()) }
  } catch {
    return { reason: 'No satellite picture: Google could not be reached.' }
  }
}

const sqft = (n: number) => `${Math.round(n).toLocaleString('en-US')} sq ft`

export interface PrintShape { areaType: string; mode: string; label: string | null; path: Array<[number, number]>; areaSqft: number }

/** The PDF itself. `picture` is the satellite picture or the reason there is none. */
export function measurementPdf(o: {
  companyName: string; property: { name: string; address: string }; printedOn: string
  shapes: PrintShape[]; totals: Map<string, number>; picture: { png: Buffer } | { reason: string }; place: (p: [number, number]) => [number, number]
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Measurements — ${o.property.name}` } })
    const chunks: Buffer[] = []
    doc.on('data', (b: Buffer) => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.font('Helvetica-Bold').fontSize(16).text(o.companyName)
    doc.font('Helvetica').fontSize(12).text(`Measurements — ${o.property.name}`)
    doc.fontSize(9).fillColor('#555')
    if (o.property.address) doc.text(o.property.address)
    doc.text(`Printed ${o.printedOn}`).fillColor('black')

    // The picture, 512 points wide, with the shapes drawn on it.
    const boxX = 50, boxY = doc.y + 10, boxW = 512, scale = boxW / IMG_W, boxH = IMG_H * scale
    if ('png' in o.picture) {
      try { doc.image(o.picture.png, boxX, boxY, { width: boxW, height: boxH }) } catch { doc.rect(boxX, boxY, boxW, boxH).fill('#eef2ee') }
    } else {
      doc.rect(boxX, boxY, boxW, boxH).fill('#eef2ee')
    }
    doc.save().rect(boxX, boxY, boxW, boxH).clip()
    const placed: Array<{ x: number; y: number; w: number }> = []
    const drawn = o.shapes.map((s, i) => {
      const pts = s.path.map((p) => { const [x, y] = o.place(p); return [boxX + x * scale, boxY + y * scale] as [number, number] })
      const color = s.mode === 'cut' ? CUT_COLOR : TYPE_COLORS[s.areaType] || '#16a34a'
      doc.polygon(...pts)
      if (s.mode === 'cut') doc.dash(4, { space: 3 })
      doc.lineWidth(1.5).fillOpacity(s.mode === 'cut' ? 0.15 : 0.3).fillAndStroke(color, color).undash().fillOpacity(1)
      return { pts, color, tag: `${i + 1}  ${s.mode === 'cut' ? 'Cut-out' : TYPE_NAMES[s.areaType] || s.areaType}  ${sqft(s.areaSqft)}` }
    })
    // The tags after every shape, so no shape's fill covers another's tag: the number, what it is and its area at the shape's
    // middle, on a white tag so it reads over grass and roofs alike.
    doc.font('Helvetica-Bold').fontSize(7)
    for (const { pts, color, tag } of drawn) {
      const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length
      const w = doc.widthOfString(tag) + 6
      // Overlapping shapes have their middles close together: move a tag down (then up) until it touches no other tag.
      const tx = mx - w / 2
      let ty = my - 5
      const hits = (y: number) => placed.some((r) => tx < r.x + r.w && tx + w > r.x && y < r.y + 10 && y + 10 > r.y)
      for (let step = 1; hits(ty) && step < 40; step++) ty = my - 5 + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 11
      placed.push({ x: tx, y: ty, w })
      doc.rect(tx, ty, w, 10).fillOpacity(0.9).fill('white').fillOpacity(1)
      doc.fillColor(color).text(tag, tx + 3, ty + 1.5, { lineBreak: false }).fillColor('black')
    }
    doc.restore()
    doc.rect(boxX, boxY, boxW, boxH).lineWidth(0.5).stroke('#999')
    doc.x = 50
    doc.y = boxY + boxH + 6
    if ('reason' in o.picture) doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555').text(`${o.picture.reason} The shapes are drawn to scale.`, 50, doc.y, { width: 512 }).fillColor('black')
    else doc.font('Helvetica').fontSize(7).fillColor('#777').text('Imagery © Google', 50, doc.y, { width: 512, align: 'right' }).fillColor('black')

    // Every shape.
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text('Shapes', 50, doc.y)
    const cols = [50, 80, 190, 260, 470]
    const row = (cells: string[], bold = false) => {
      if (doc.y > 720) doc.addPage()
      const y = doc.y + 2
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      cells.forEach((t, i) => doc.text(t, cols[i], y, { width: i === 4 ? 92 : cols[i + 1] - cols[i] - 6, align: i === 4 ? 'right' : 'left', lineBreak: false }))
      doc.y = y + 13
    }
    row(['#', 'Measures', 'Adds or cuts', 'Name', 'Area'], true)
    o.shapes.forEach((s, i) => row([String(i + 1), TYPE_NAMES[s.areaType] || s.areaType, s.mode === 'cut' ? 'Cut-out' : 'Adds', s.label || '', sqft(s.areaSqft)]))

    // The totals by type — what the rate card prices.
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text('Totals', 50, doc.y)
    for (const [type, total] of o.totals) row(['', TYPE_NAMES[type] || type, '', '', sqft(total)], true)
    doc.moveDown(0.4).font('Helvetica').fontSize(8).fillColor('#555')
      .text('Where shapes of one kind overlap, the shared part is counted once; cut-outs are taken away. Areas are measured from the corners on the map.', 50, doc.y, { width: 512 })
    doc.end()
  })
}

export function createMeasurePrintRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /api/measure-print/sites/:siteId/pdf — the measurements as a PDF (?download=1 to save it rather than open it).
  app.get('/sites/:siteId/pdf', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const [s] = await db.select().from(site).where(and(eq(site.id, c.req.param('siteId')), eq(site.companyId, u.companyId))).limit(1)
    if (!s) return fail(c, 404, 'Site not found')
    const rows: any[] = await shapesOf(db, u.companyId, s.id)
    if (!rows.length) return fail(c, 409, 'Nothing is drawn on this property yet. Measure it on the map, save, then print.', 'NOTHING_MEASURED')
    const shapes: PrintShape[] = rows.map((r) => ({ areaType: r.areaType, mode: r.mode, label: r.label, path: r.path as Array<[number, number]>, areaSqft: Number(r.areaSqft) }))
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const tz = await companyTimeZone(db, u.companyId)
    const printedOn = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
    const frame = framing(shapes.map((x) => x.path))
    const picture = await satellite(frame.center, frame.zoom)
    const pdf = await measurementPdf({
      companyName: co?.name || 'Company', property: { name: s.name, address: [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ') },
      printedOn, shapes, totals: typeTotals(shapes as any), picture, place: frame.place,
    })
    const file = `measurements-${String(s.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'property'}.pdf`
    return c.body(new Uint8Array(pdf), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${file}"` })
  })

  return app
}
