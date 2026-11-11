// Tests the draw-it-yourself measuring against Hover: Hover's own roof lines are handed in flattened, exactly as a
// person tracing the roof from above would draw them, and the result is compared with what Hover measured in 3D.
// The question: if the rep draws the right lines, does the report come out right?
//
// Run twice per house: once with each section's true pitch (as the height map or a pitch gauge would give), once with a
// single pitch for the whole roof (the roof's main pitch), to show what the simpler entry costs.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/scoreDrawn.ts
import { loadHoverTruth, type RoofTruth } from './hoverTruth.ts'
import { measureDrawnRoof, type DrawnLine, type Pt } from '../src/v2/drawnRoof.ts'

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

/** The pitch of the Hover facet a drawn section sits in; where roofs overlap, the upper one (it is what is seen from above). */
function truePitch(t: RoofTruth, outline: Pt[]): number | null {
  const c = { x: outline.reduce((s, p) => s + p.x, 0) / outline.length, y: outline.reduce((s, p) => s + p.y, 0) / outline.length }
  let best: number | null = null, bestZ = -Infinity
  for (const f of t.facets) {
    const poly = f.outline.map(([x, y]) => ({ x: x * FT, y: y * FT }))
    if (!inside(c, poly)) continue
    const z = f.outline.reduce((s, p) => s + p[2], 0) / f.outline.length
    if (z > bestZ) { bestZ = z; best = f.pitchOver12 }
  }
  return best
}

console.log(`\nDraw-it-yourself measuring, fed Hover's own lines — error against Hover's 3D measurement\n`)
console.log(pad('house', 24) + pad('pitch entry', 16) + pad('area', 9) + pad('ridge', 8) + pad('hip', 8) + pad('valley', 8) + pad('eave', 8) + pad('rake', 8) + pad('faces', 8) + 'notes')
const areaErr: Record<string, number[]> = { each: [], one: [] }
for (const t of loadHoverTruth()) {
  const drawn: DrawnLine[] = t.lines.map((l) => ({ type: l.type, a: { x: l.a[0] * FT, y: l.a[1] * FT }, b: { x: l.b[0] * FT, y: l.b[1] * FT } }))
  const main = t.pitches[0]?.pitchOver12 ?? 6
  for (const mode of ['each', 'one'] as const) {
    const r = measureDrawnRoof(drawn, { defaultPitchOver12: main, pitchOfFace: mode === 'each' ? (o) => truePitch(t, o) : undefined, snapM: 0.08 })
    areaErr[mode].push(Math.abs((r.areaSqft - t.areaSqft) / t.areaSqft) * 100)
    const L = r.lengths, T = t.lengths
    console.log(pad(mode === 'each' ? t.id.replace(/^\d+_/, '') : '', 24) + pad(mode === 'each' ? 'per section' : `one pitch ${main}/12`, 16) + pad(err(r.areaSqft, t.areaSqft), 9)
      + pad(err(L.ridge, T.ridge), 8) + pad(err(L.hip, T.hip), 8) + pad(err(L.valley, T.valley), 8) + pad(err(L.eave, T.eave), 8) + pad(err(L.rake, T.rake), 8)
      + pad(`${r.faces.length}/${t.facetCount}`, 8) + (r.warnings[0] || ''))
  }
}
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(1)
const worst = (v: number[]) => Math.max(...v).toFixed(1)
console.log(`\narea error — pitch per section: median ${med(areaErr.each)}%, worst ${worst(areaErr.each)}%   |   one pitch for the roof: median ${med(areaErr.one)}%, worst ${worst(areaErr.one)}%`)
