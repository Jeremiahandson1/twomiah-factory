// A look at Google's data for every cached house, before any engine runs: is the pin on a roof, how big is the roof
// outline under (or nearest) the pin, and what does Google's own building summary say. Offline.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/dataCheck.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fromArrayBuffer } from 'geotiff'
import { loadHoverTruth, truthDir } from './hoverTruth.ts'
import { loadSquaresJobs } from './squaresTruth.ts'

const SQM_TO_SQFT = 10.7639
const planArea = (o: Array<[number, number, number]>) => {
  let a = 0
  for (let i = 0; i < o.length; i++) { const p = o[i], q = o[(i + 1) % o.length]; a += p[0] * q[1] - q[0] * p[1] }
  return Math.abs(a / 2)
}

interface Site { id: string; knownPlanSqft?: number; knownSlopeSqft?: number; note?: string }
const sites: Site[] = [
  ...loadHoverTruth().map((t) => ({ id: t.id, knownPlanSqft: t.facets.reduce((s, f) => s + planArea(f.outline), 0), knownSlopeSqft: t.areaSqft })),
  ...loadSquaresJobs().map((j) => ({ id: j.id, knownSlopeSqft: j.squares * 100, note: j.note })),
]

for (const s of sites) {
  const dir = join(truthDir(), 'google', s.id)
  if (!existsSync(join(dir, 'px25.json'))) { console.log(`${s.id}: not cached`); continue }
  const meta = JSON.parse(readFileSync(join(dir, 'px25.json'), 'utf8'))
  const buf = readFileSync(join(dir, 'px25-mask.tif'))
  const img = await (await fromArrayBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice().buffer)).getImage()
  const m = (await img.readRasters())[0] as any
  const w = img.getWidth(), h = img.getHeight()
  const px = (img.getBoundingBox()[2] - img.getBoundingBox()[0]) / w

  // Connected roof blobs in the mask.
  const lab = new Int32Array(w * h).fill(-1)
  const blobs: Array<{ n: number; sx: number; sy: number }> = []
  for (let start = 0; start < w * h; start++) {
    if (!m[start] || lab[start] >= 0) continue
    const id = blobs.length; const b = { n: 0, sx: 0, sy: 0 }; blobs.push(b)
    const stack = [start]; lab[start] = id
    while (stack.length) {
      const i = stack.pop()!; const x = i % w, y = (i / w) | 0
      b.n++; b.sx += x; b.sy += y
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (m[j] && lab[j] < 0) { lab[j] = id; stack.push(j) }
      }
    }
  }
  const cx = w / 2, cy = h / 2
  const sqft = (b: { n: number }) => Math.round(b.n * px * px * SQM_TO_SQFT)
  const under = lab[Math.floor(cy) * w + Math.floor(cx)]
  const near = blobs.filter((b) => b.n * px * px > 4)
    .map((b) => ({ sqft: sqft(b), m: Math.round(Math.hypot(b.sx / b.n - cx, b.sy / b.n - cy) * px) }))
    .sort((a, b) => a.m - b.m).slice(0, 4)

  const bi = JSON.parse(readFileSync(join(dir, 'buildingInsights.json'), 'utf8'))
  const segs = bi.solarPotential?.roofSegmentStats || []
  const segArea = segs.reduce((a: number, x: any) => a + x.stats.areaMeters2, 0)
  const meanPitch = segArea ? segs.reduce((a: number, x: any) => a + Math.tan((x.pitchDegrees * Math.PI) / 180) * 12 * x.stats.areaMeters2, 0) / segArea : 0

  const underSqft = under >= 0 ? sqft(blobs[under]) : null
  console.log(
    `${s.id.replace(/^\d+_/, '').padEnd(26)} ${`${meta.imageryQuality} ${meta.imageryDate?.year}-${String(meta.imageryDate?.month).padStart(2, '0')}`.padEnd(15)}`
    + ` pin on roof: ${underSqft != null ? `yes, outline ${underSqft} sqft flat` : 'NO'}`.padEnd(42)
    + (s.knownPlanSqft ? ` | measured flat ${Math.round(s.knownPlanSqft)}${underSqft ? ` (${(((underSqft - s.knownPlanSqft) / s.knownPlanSqft) * 100).toFixed(0)}%)` : ''}` : '')
    + (s.knownSlopeSqft && !s.knownPlanSqft ? ` | bid ${Math.round(s.knownSlopeSqft)} sqft on the slope` : '')
    + ` | Google avg pitch ${meanPitch.toFixed(1)}/12`
    + ` | roofs near pin (flat sqft @ m): ${near.map((n) => `${n.sqft}@${n.m}`).join('  ')}`,
  )
}
