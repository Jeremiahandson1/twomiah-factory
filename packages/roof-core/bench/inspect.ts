// One house in detail: the engine's faces and where each foot of line came from, beside Hover's own facets and lines.
// For finding out WHY a number is off before changing the engine. Offline.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/inspect.ts <house id or part of it>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadHoverTruth, truthDir } from './hoverTruth.ts'
import { measureRoofFaces } from '../src/v2/roofFaces.ts'
import { measureRoofLines } from '../src/v2/roofLines.ts'

const want = process.argv[2] || ''
const t = loadHoverTruth().find((x) => x.id.includes(want))
if (!t) throw new Error(`no answer-key house matches "${want}"`)
const dir = join(truthDir(), 'google', t.id)
const r = (await measureRoofFaces(readFileSync(join(dir, 'px25-dsm.tif')), readFileSync(join(dir, 'px25-mask.tif'))))!
const lines = measureRoofLines(r)

console.log(`${t.id}  — engine faces (unexplained ${(r.unexplainedShare * 100).toFixed(0)}%):`)
for (const f of r.faces) console.log(`  #${f.id}  ${String(f.slopeSqft).padStart(5)} sf  ${f.pitchOver12}/12  faces ${f.azimuthDeg}°  misfit ${f.misfitM} m`)
console.log(`Hover facets: ${t.facets.map((f) => `${Math.round(f.areaSqft)}sf ${f.pitchOver12}/12`).join(', ')}`)

const by = new Map<string, number>()
for (const c of lines.cracks) {
  const k = `${c.faceB < 0 ? 'outline' : 'between'} ${Math.min(c.faceA, c.faceB) < 0 ? '' : `#${Math.min(c.faceA, c.faceB)} `}#${Math.max(c.faceA, c.faceB)}  ${c.type}`
  by.set(k, (by.get(k) || 0) + c.ft)
}
console.log(`\nengine lines, feet on the slope, by where they came from:`)
for (const [k, v] of [...by.entries()].sort()) if (v >= 0.5) console.log(`  ${k.padEnd(34)} ${v.toFixed(1)}`)
console.log(`  totals: ${Object.entries(lines.lengths).map(([k, v]) => `${k} ${v}`).join('  ')}   (squared corners ${lines.squaredEdgeFt} ft flat, unknown edge ${lines.unknownEdgeFt})`)

console.log(`\nHover lines:`)
const hv = new Map<string, number[]>()
for (const l of t.lines) { const a = hv.get(l.type) || []; a.push(l.lengthFt); hv.set(l.type, a) }
for (const [k, v] of hv) console.log(`  ${k.padEnd(10)} ${v.reduce((s, x) => s + x, 0).toFixed(1).padStart(6)}  = ${v.sort((a, b) => b - a).map((x) => x.toFixed(1)).join(' + ')}`)
