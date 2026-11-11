// Scores engine v2's faces against the Hover answer keys, and draws each house's faces to a picture so a person can
// look at what the engine found. Offline.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/scoreFaces.ts [px10|px25]
//
// A measured facet counts as FOUND when an engine face looks the same way (within 25°, or both nearly flat), has the
// same pitch (within 1.5/12), and the two areas are within a factor of two. Each engine face can answer one facet.
// Facets are compared by direction, pitch and size, not by position: Hover's model is not yet laid over the map, only
// turned to the compass (see below).
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { loadHoverTruth, truthDir, type RoofTruth } from './hoverTruth.ts'
import { measureRoofFaces, type RoofFaces } from '../src/v2/roofFaces.ts'

const tag = process.argv[2] || 'px10'
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)
const pct = (got: number, want: number) => `${got >= want ? '+' : ''}${(((got - want) / want) * 100).toFixed(0)}%`
const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

/** A measured facet's facing direction from its own outline (downhill), in Hover's frame taken as x = east, y = north. */
function facetAzimuth(o: Array<[number, number, number]>): number {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < o.length; i++) {
    const [x1, y1, z1] = o[i], [x2, y2, z2] = o[(i + 1) % o.length]
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2)
  }
  if (nz < 0) { nx = -nx; ny = -ny }
  return ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360
}

function matchFacets(t: RoofTruth, r: RoofFaces, turnDeg: number) {
  const used = new Set<number>()
  let foundArea = 0, found = 0
  const missed: string[] = []
  for (const f of [...t.facets].sort((a, b) => b.areaSqft - a.areaSqft)) {
    const az = (facetAzimuth(f.outline) + turnDeg) % 360
    let best = -1, bestScore = Infinity
    for (const e of r.faces) {
      if (used.has(e.id)) continue
      const flat = f.pitchOver12 < 1 && e.pitchOver12 < 1
      if (!flat && angDiff(az, e.azimuthDeg) > 25) continue
      if (Math.abs(f.pitchOver12 - e.pitchOver12) > 1.5) continue
      const ratio = e.slopeSqft / Math.max(1, f.areaSqft)
      if (ratio < 0.5 || ratio > 2) continue
      const score = Math.abs(Math.log(ratio))
      if (score < bestScore) { bestScore = score; best = e.id }
    }
    if (best >= 0) { used.add(best); found++; foundArea += f.areaSqft } else missed.push(`${Math.round(f.areaSqft)}sf ${f.pitchOver12.toFixed(0)}/12 @${Math.round(az)}°`)
  }
  const extra = r.faces.filter((e) => !used.has(e.id))
  return { found, foundArea, missed, extra }
}

const COLORS = [[230, 25, 75], [60, 180, 75], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255], [170, 110, 40], [128, 0, 0], [170, 255, 195], [128, 128, 0], [255, 215, 180], [0, 0, 128], [255, 225, 25]]

let warned = false
async function draw(r: RoofFaces, to: string, aerialTif?: string) {
  // Crop to the roof with a margin, then scale up so small faces are visible.
  let x0 = r.width, y0 = r.height, x1 = 0, y1 = 0
  for (let i = 0; i < r.labels.length; i++) {
    if (r.labels[i] === -1) continue
    const x = i % r.width, y = (i / r.width) | 0
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  const m = 8
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(r.width - 1, x1 + m); y1 = Math.min(r.height - 1, y1 + m)
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  const rgb = Buffer.alloc(cw * ch * 3, 245)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const l = r.labels[(y + y0) * r.width + x + x0]
    if (l === -1) continue
    const c = l === -2 ? [60, 60, 60] : COLORS[l % COLORS.length]
    // Darken a face's border pixels so neighbouring faces of similar colour still read apart.
    const i = (y + y0) * r.width + x + x0
    const edge = l >= 0 && (r.labels[i + 1] !== l || r.labels[i - 1] !== l || r.labels[i + r.width] !== l || r.labels[i - r.width] !== l)
    const k = (y * cw + x) * 3
    rgb[k] = edge ? c[0] * 0.45 : c[0]; rgb[k + 1] = edge ? c[1] * 0.45 : c[1]; rgb[k + 2] = edge ? c[2] * 0.45 : c[2]
  }
  const scale = Math.max(1, Math.floor(700 / Math.max(cw, ch)))
  const facesPng = await sharp(rgb, { raw: { width: cw, height: ch, channels: 3 } }).resize(cw * scale, ch * scale, { kernel: 'nearest' }).png().toBuffer()
  // Beside it, the same patch of Google's aerial photo, so a person can see what the roof really looks like.
  let aerial: Buffer | null = null
  if (aerialTif && existsSync(aerialTif)) {
    try { aerial = await sharp(aerialTif).extract({ left: x0, top: y0, width: cw, height: ch }).resize(cw * scale, ch * scale).removeAlpha().png().toBuffer() } catch (err: any) { aerial = null; if (!warned) { warned = true; console.log('aerial picture skipped:', err?.message) } }
  }
  if (!aerial) { await sharp(facesPng).toFile(to); return }
  await sharp({ create: { width: cw * scale * 2 + 10, height: ch * scale, channels: 3, background: '#ffffff' } })
    .composite([{ input: facesPng, left: 0, top: 0 }, { input: aerial, left: cw * scale + 10, top: 0 }]).png().toFile(to)
}

const outDir = join(truthDir(), 'results', `faces-${tag}`)
mkdirSync(outDir, { recursive: true })
console.log(`\nEngine v2 faces on ${tag} data  (pictures: ${outDir})\n`)
console.log(pad('house', 26) + pad('area', 7) + pad('faces', 9) + pad('found', 8) + pad('found area', 12) + pad('unexpl.', 9) + pad('model', 10) + 'missed facets  ||  extra engine faces')
const foundShares: number[] = []
for (const t of loadHoverTruth()) {
  const dir = join(truthDir(), 'google', t.id)
  if (!existsSync(join(dir, `${tag}.json`))) continue
  const r = await measureRoofFaces(readFileSync(join(dir, `${tag}-dsm.tif`)), readFileSync(join(dir, `${tag}-mask.tif`)))
  if (!r) { console.log(pad(t.id, 26) + 'no roof found'); continue }
  await draw(r, join(outDir, `${t.id}.png`))
  // Hover draws each house square to its own walls, not to north: try every turn of its model and keep the one under
  // which the most roof area finds its facet. (Laying the model over the map properly comes with the lines layer.)
  let m = matchFacets(t, r, 0), turn = 0
  for (let d = 1; d < 360; d++) { const c = matchFacets(t, r, d); if (c.foundArea > m.foundArea + 1e-6) { m = c; turn = d } }
  const share = m.foundArea / t.facets.reduce((s, f) => s + f.areaSqft, 0)
  if (r.pinOnRoof) foundShares.push(share)
  console.log(pad(t.id.replace(/^\d+_/, ''), 26) + pad(r.pinOnRoof ? pct(r.slopeSqft, t.areaSqft) : 'pin off', 7) + pad(`${r.faces.length}/${t.facetCount}`, 9) + pad(`${m.found}/${t.facetCount}`, 8)
    + pad(`${(share * 100).toFixed(0)}%`, 12) + pad(`${(r.unexplainedShare * 100).toFixed(0)}%`, 9)
    + (m.missed.join(', ') || '—') + '  ||  ' + (m.extra.map((e) => `${e.slopeSqft}sf ${e.pitchOver12.toFixed(0)}/12 @${e.azimuthDeg}°`).join(', ') || '—'))
}
foundShares.sort((a, b) => a - b)
console.log(`\nShare of measured roof area whose facet the engine found — median ${(foundShares[Math.floor(foundShares.length / 2)] * 100).toFixed(0)}%, worst ${(foundShares[0] * 100).toFixed(0)}% (${foundShares.length} houses, pin on roof)`)
