// Scores engine v2's lines (ridge, hip, valley, eave, rake) against the Hover answer keys by total length per type, and
// draws each house's lines to a picture. Offline.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/scoreLines.ts [px25|px10]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { loadHoverTruth, truthDir } from './hoverTruth.ts'
import { measureRoofFaces, type RoofFaces } from '../src/v2/roofFaces.ts'
import { measureRoofLines, type RoofLines } from '../src/v2/roofLines.ts'

const tag = process.argv[2] || 'px25'
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)
const cell = (got: number, want: number) => {
  const g = Math.round(got), t = Math.round(want)
  if (t === 0) return `${g}/0`
  return `${g}/${t} ${g >= t ? '+' : ''}${(((got - want) / want) * 100).toFixed(0)}%`
}

const LINE_COLORS: Record<string, [number, number, number]> = {
  ridge: [220, 30, 30], hip: [240, 140, 20], valley: [30, 90, 230], eave: [20, 160, 60], rake: [150, 40, 190], unknown: [120, 120, 120],
}

async function draw(r: RoofFaces, lines: RoofLines, to: string) {
  const s = 8 // screen pixels per raster pixel
  let x0 = r.width, y0 = r.height, x1 = 0, y1 = 0
  for (let i = 0; i < r.labels.length; i++) {
    if (r.labels[i] === -1) continue
    const x = i % r.width, y = (i / r.width) | 0
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  x0 = Math.max(0, x0 - 3); y0 = Math.max(0, y0 - 3); x1 = Math.min(r.width - 1, x1 + 3); y1 = Math.min(r.height - 1, y1 + 3)
  const cw = (x1 - x0 + 1) * s, ch = (y1 - y0 + 1) * s
  const rgb = Buffer.alloc(cw * ch * 3, 250)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const l = r.labels[(y0 + ((y / s) | 0)) * r.width + x0 + ((x / s) | 0)]
    if (l === -1) continue
    const v = l === -2 ? 150 : 215 + (l % 3) * 12
    const k = (y * cw + x) * 3
    rgb[k] = v; rgb[k + 1] = v; rgb[k + 2] = l === -2 ? 150 : v
  }
  for (const c of lines.cracks) {
    const col = LINE_COLORS[c.type] || LINE_COLORS.unknown
    const cx = Math.round((c.east / r.px - x0 + 0.5) * s), cy = Math.round((-c.north / r.px - y0 + 0.5) * s)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= cw || y >= ch) continue
      const k = (y * cw + x) * 3
      rgb[k] = col[0]; rgb[k + 1] = col[1]; rgb[k + 2] = col[2]
    }
  }
  await sharp(rgb, { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(to)
}

const outDir = join(truthDir(), 'results', `lines-${tag}`)
mkdirSync(outDir, { recursive: true })
console.log(`\nEngine v2 lines on ${tag} data — each cell is engine/measured feet and the error  (pictures: ${outDir})`)
console.log(`picture colours: ridge red, hip orange, valley blue, eave green, rake purple, unknown grey\n`)
console.log(pad('house', 24) + pad('ridge', 15) + pad('hip', 13) + pad('ridge+hip', 15) + pad('valley', 14) + pad('eave', 15) + pad('rake', 15) + pad('eave+rake', 15) + pad('unknown edge', 13))
const rows: any[] = []
for (const t of loadHoverTruth()) {
  const dir = join(truthDir(), 'google', t.id)
  if (!existsSync(join(dir, `${tag}.json`))) continue
  const faces = await measureRoofFaces(readFileSync(join(dir, `${tag}-dsm.tif`)), readFileSync(join(dir, `${tag}-mask.tif`)))
  if (!faces) continue
  const lines = measureRoofLines(faces)
  await draw(faces, lines, join(outDir, `${t.id}.png`))
  const L = lines.lengths, T = t.lengths
  rows.push({ id: t.id, pinOnRoof: faces.pinOnRoof, unexplainedShare: faces.unexplainedShare, engine: L, truth: T, unknownEdgeFt: lines.unknownEdgeFt })
  console.log(pad(t.id.replace(/^\d+_/, '') + (faces.pinOnRoof ? '' : ' (pin off)'), 24) + pad(cell(L.ridge, T.ridge), 15) + pad(cell(L.hip, T.hip), 13) + pad(cell(L.ridge + L.hip, T.ridge + T.hip), 15)
    + pad(cell(L.valley, T.valley), 14) + pad(cell(L.eave, T.eave), 15) + pad(cell(L.rake, T.rake), 15) + pad(cell(L.eave + L.rake, T.eave + T.rake), 15) + pad(`${Math.round(lines.unknownEdgeFt)} ft`, 13))
}
const ok = rows.filter((r) => r.pinOnRoof)
const med = (f: (r: any) => [number, number]) => {
  const v = ok.map(f).filter(([, t]) => t > 0).map(([g, t]) => Math.abs((g - t) / t) * 100).sort((a, b) => a - b)
  return v.length ? `${v[Math.floor(v.length / 2)].toFixed(0)}% (worst ${v[v.length - 1].toFixed(0)}%, ${v.length} houses)` : 'n/a'
}
console.log(`\nmedian error, pin-on-roof houses:`)
console.log(`  ridge+hip  ${med((r) => [r.engine.ridge + r.engine.hip, r.truth.ridge + r.truth.hip])}`)
console.log(`  valley     ${med((r) => [r.engine.valley, r.truth.valley])}`)
console.log(`  eave       ${med((r) => [r.engine.eave, r.truth.eave])}`)
console.log(`  rake       ${med((r) => [r.engine.rake, r.truth.rake])}`)
console.log(`  eave+rake  ${med((r) => [r.engine.eave + r.engine.rake, r.truth.eave + r.truth.rake])}`)
writeFileSync(join(truthDir(), 'results', `lines-${tag}.json`), JSON.stringify(rows, null, 1))
