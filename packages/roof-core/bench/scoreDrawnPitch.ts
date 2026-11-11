// Tests the whole draw-it-yourself path on real data: Hover's lines laid on the map as a rep would draw them, the pitch
// of each face READ FROM GOOGLE'S HEIGHT MAP (not taken from Hover), and the result compared with Hover.
//
// Hover's model is drawn square to the house, not to north, and has no map position of its own beyond one point; it is
// laid on the map by trying turns and shifts and keeping the one whose outline best covers Google's roof mask. That
// placement is the test's stand-in for the rep's eye — the product does not need it.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/scoreDrawnPitch.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadHoverTruth, truthDir, type RoofTruth } from './hoverTruth.ts'
import { measureDrawnRoof, toLocal, toLatLng, type DrawnLine, type Pt } from '../src/v2/drawnRoof.ts'
import { prepareDrawBackdrop } from '../src/v2/drawBackdrop.ts'
import { decodePitchGrid, pitchInside, toPicture } from '../src/v2/facePitch.ts'
import { readRaster, pickRoof } from '../src/v2/roofSurface.ts'

const FT = 0.3048
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)
const err = (got: number, want: number) => (want > 0.5 ? `${got >= want ? '+' : ''}${(((got - want) / want) * 100).toFixed(1)}%` : got > 0.5 ? `+${got.toFixed(0)}ft` : '0')

const inside = (p: Pt, poly: Pt[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

console.log(`\nDrawn report with pitch read from Google's height map — Hover's lines laid on the map, error against Hover\n`)
console.log(pad('house', 24) + pad('fit', 7) + pad('area', 9) + pad('hip', 8) + pad('valley', 8) + pad('rake', 8) + pad('faces w/ pitch', 16) + 'pitch read vs Hover, by face area (largest first)')
const areaErrs: number[] = []
for (const t of loadHoverTruth()) {
  const dir = join(truthDir(), 'google', t.id)
  if (!existsSync(join(dir, 'px10.json'))) continue
  const dsm = readFileSync(join(dir, 'px10-dsm.tif')), maskBuf = readFileSync(join(dir, 'px10-mask.tif'))
  const backdrop = await prepareDrawBackdrop(dsm, maskBuf)
  const grid = decodePitchGrid(backdrop.pitchGrid)
  const mask = await readRaster(maskBuf)
  const picked = pickRoof(mask)
  if (!picked || !picked.pinOnRoof) { console.log(pad(t.id.replace(/^\d+_/, ''), 24) + 'pin not on the roof — cannot place the model'); continue }

  // Place the model: turn θ and shift so the model's facets cover the chosen roof's mask best.
  const origin = { lat: backdrop.center.lat, lng: backdrop.center.lng }
  const facetsLocal = t.facets.map((f) => f.outline.map(([x, y]) => ({ x: x * FT, y: y * FT })))
  const all = facetsLocal.flat()
  const mc = { x: all.reduce((s, p) => s + p.x, 0) / all.length, y: all.reduce((s, p) => s + p.y, 0) / all.length }
  // Roof pixels in local metres about the picture's centre (sub-sampled).
  const roofPts: Pt[] = []
  let rc = { x: 0, y: 0 }
  for (let y = 0; y < mask.height; y += 4) for (let x = 0; x < mask.width; x += 4) {
    if (!picked.roof[y * mask.width + x]) continue
    const p = { x: (x - mask.width / 2) * mask.px, y: -(y - mask.height / 2) * mask.px }
    roofPts.push(p); rc.x += p.x; rc.y += p.y
  }
  rc = { x: rc.x / roofPts.length, y: rc.y / roofPts.length }
  const place = (deg: number, dx: number, dy: number) => (p: Pt): Pt => {
    const a = (deg * Math.PI) / 180, x = p.x - mc.x, y = p.y - mc.y
    return { x: x * Math.cos(a) - y * Math.sin(a) + rc.x + dx, y: x * Math.sin(a) + y * Math.cos(a) + rc.y + dy }
  }
  const score = (f: (p: Pt) => Pt) => {
    const polys = facetsLocal.map((poly) => poly.map(f))
    let hit = 0
    for (const p of roofPts) if (polys.some((poly) => inside(p, poly))) hit++
    const modelArea = polys.reduce((s, poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const q = poly[i], r = poly[(i + 1) % poly.length]; a += q.x * r.y - r.x * q.y } return s + Math.abs(a / 2) }, 0)
    const roofArea = roofPts.length * (mask.px * 4) ** 2
    return hit * (mask.px * 4) ** 2 / Math.max(modelArea, roofArea) // overlap over the larger: 1 = same shape, same place
  }
  let best = { deg: 0, dx: 0, dy: 0, s: -1 }
  for (let deg = 0; deg < 360; deg += 3) { const s = score(place(deg, 0, 0)); if (s > best.s) best = { deg, dx: 0, dy: 0, s } }
  for (const stepDeg of [1, 0.25]) for (const stepM of [1, 0.25]) {
    for (let improved = true; improved;) {
      improved = false
      for (const [dd, ddx, ddy] of [[stepDeg, 0, 0], [-stepDeg, 0, 0], [0, stepM, 0], [0, -stepM, 0], [0, 0, stepM], [0, 0, -stepM]]) {
        const c = { deg: best.deg + dd, dx: best.dx + ddx, dy: best.dy + ddy }
        const s = score(place(c.deg, c.dx, c.dy))
        if (s > best.s + 1e-6) { best = { ...c, s }; improved = true }
      }
    }
  }
  const put = place(best.deg, best.dx, best.dy)

  // The lines as a rep would have them: positions on the map.
  const drawn: DrawnLine[] = t.lines.map((l) => ({ type: l.type, a: put({ x: l.a[0] * FT, y: l.a[1] * FT }), b: put({ x: l.b[0] * FT, y: l.b[1] * FT }) }))
  const main = t.pitches[0]?.pitchOver12 ?? 6
  let read = 0
  const compare: string[] = []
  const r = measureDrawnRoof(drawn, {
    defaultPitchOver12: main, snapM: 0.08,
    pitchOfFace: (outline) => {
      const got = pitchInside(outline.map((p) => toLatLng(p, origin)), grid, backdrop.corners)
      if (got != null) read++
      return got
    },
  })
  // Hover's pitch for each drawn face, for the side-by-side.
  const truthPitch = (outline: Pt[]) => {
    const c = { x: outline.reduce((s, p) => s + p.x, 0) / outline.length, y: outline.reduce((s, p) => s + p.y, 0) / outline.length }
    let bestP: number | null = null, bestZ = -Infinity
    t.facets.forEach((f, i) => {
      if (!inside(c, facetsLocal[i].map(put))) return
      const z = f.outline.reduce((s, p) => s + p[2], 0) / f.outline.length
      if (z > bestZ) { bestZ = z; bestP = f.pitchOver12 }
    })
    return bestP
  }
  for (const f of [...r.faces].sort((a, b) => b.areaSqft - a.areaSqft).slice(0, 7)) {
    const tp = truthPitch(f.outline)
    compare.push(`${f.pitchFrom === 'face' ? f.pitchOver12.toFixed(1) : '—'}/${tp != null ? tp.toFixed(1) : '?'}`)
  }
  areaErrs.push(Math.abs((r.areaSqft - t.areaSqft) / t.areaSqft) * 100)
  const L = r.lengths, T = t.lengths
  console.log(pad(t.id.replace(/^\d+_/, ''), 24) + pad(`${(best.s * 100).toFixed(0)}%`, 7) + pad(err(r.areaSqft, t.areaSqft), 9) + pad(err(L.hip, T.hip), 8) + pad(err(L.valley, T.valley), 8) + pad(err(L.rake, T.rake), 8)
    + pad(`${read}/${r.faces.length}`, 16) + compare.join('  '))
  void toLocal; void toPicture
}
areaErrs.sort((a, b) => a - b)
console.log(`\narea error with pitch read from the height map: median ${areaErrs[areaErrs.length >> 1].toFixed(1)}%, worst ${areaErrs[areaErrs.length - 1].toFixed(1)}% (${areaErrs.length} houses)`)
