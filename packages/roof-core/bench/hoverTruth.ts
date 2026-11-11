// The answer key: a Hover roof model (the XML inside a Hover .esx export) read into plain numbers a roof engine can be
// scored against. Hover's model is in FEET, x/y on the ground and z up; every roof line is typed by Hover.
//
// The data itself (customer addresses, the models) is private and is NOT in the repo: it sits in the folder
// ROOF_TRUTH_DIR names (see bench/README.md).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type TruthLineType = 'ridge' | 'hip' | 'valley' | 'rake' | 'eave' | 'flash' | 'stepflash'

export interface TruthLine {
  type: TruthLineType
  lengthFt: number
  /** Ends in feet, model frame (x, y on the ground, z up). */
  a: [number, number, number]
  b: [number, number, number]
}

export interface TruthFacet {
  id: string
  /** Compass direction the face looks toward, as Hover states it. */
  orientationDeg: number
  /** Rise over a 12 run, from the face's own plane. */
  pitchOver12: number
  areaSqft: number
  /** The face's outline in feet, model frame. */
  outline: Array<[number, number, number]>
}

export interface RoofTruth {
  id: string
  source: 'hover'
  lat: number
  lon: number
  areaSqft: number
  facetCount: number
  facets: TruthFacet[]
  lines: TruthLine[]
  /** Summed line lengths by type, feet. */
  lengths: Record<TruthLineType, number>
  /** Roof area by pitch (rounded to the whole rise), largest first. */
  pitches: Array<{ pitchOver12: number; areaSqft: number }>
  /** Hover's own summary of the same roof, where the export carried one — a check on this reader. */
  hoverSummary: { areaSqft: number; facetCount: number; ridgeHipFt: number; valleyFt: number; rakeFt: number; eaveFt: number } | null
}

const TYPE_MAP: Record<string, TruthLineType> = {
  RIDGE: 'ridge', HIP: 'hip', VALLEY: 'valley', RAKE: 'rake', EAVE: 'eave', FLASH: 'flash', STEPFLASH: 'stepflash',
}

type P3 = [number, number, number]

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? m[1] : null
}

/** Area and unit normal of a 3D polygon (Newell's method). */
function areaAndNormal(pts: P3[]): { area: number; normal: P3 } {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i]
    const [x2, y2, z2] = pts[(i + 1) % pts.length]
    nx += (y1 - y2) * (z1 + z2)
    ny += (z1 - z2) * (x1 + x2)
    nz += (x1 - x2) * (y1 + y2)
  }
  const len = Math.hypot(nx, ny, nz)
  return { area: len / 2, normal: len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1] }
}

/** Order a face's lines (each a pair of point ids) into one closed ring of point ids. */
function ringFromLines(pairs: Array<[string, string]>): string[] {
  if (pairs.length === 0) return []
  const left = pairs.map((p) => [...p] as [string, string])
  const first = left.shift()!
  const ring = [first[0], first[1]]
  while (left.length) {
    const tail = ring[ring.length - 1]
    const i = left.findIndex((p) => p[0] === tail || p[1] === tail)
    if (i < 0) break
    const [a, b] = left.splice(i, 1)[0]
    ring.push(a === tail ? b : a)
  }
  if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop()
  return ring
}

export function parseHoverModel(id: string, xml: string, summaryJson?: string | null): RoofTruth {
  const points = new Map<string, P3>()
  for (const m of xml.matchAll(/<POINT\s[^>]*>/g)) {
    const pid = attr(m[0], 'id'); const data = attr(m[0], 'data')
    if (!pid || !data) continue
    const [x, y, z] = data.split(',').map(Number)
    points.set(pid, [x, y, z])
  }
  const lines = new Map<string, { path: [string, string]; length: number; type: string | null }>()
  for (const m of xml.matchAll(/<LINE\s[^>]*>/g)) {
    const lid = attr(m[0], 'id'); const path = attr(m[0], 'path')
    if (!lid || !path) continue
    const [a, b] = path.split(',')
    lines.set(lid, { path: [a, b], length: Number(attr(m[0], 'length') || 0), type: attr(m[0], 'type') })
  }

  const roofBlock = /<ROOF[\s>][\s\S]*?<\/ROOF>/.exec(xml)?.[0] || ''
  const facets: TruthFacet[] = []
  const roofLineIds = new Set<string>()
  for (const f of roofBlock.matchAll(/<FACE\s[^>]*>([\s\S]*?)<\/FACE>/g)) {
    const poly = /<POLYGON\s[^>]*>/.exec(f[1])?.[0]
    if (!poly) continue
    const ids = (attr(poly, 'path') || '').split(',').filter(Boolean)
    ids.forEach((l) => roofLineIds.add(l))
    const ring = ringFromLines(ids.map((l) => lines.get(l)?.path).filter(Boolean) as Array<[string, string]>)
    const outline = ring.map((p) => points.get(p)).filter(Boolean) as P3[]
    const { area, normal } = areaAndNormal(outline)
    const nz = Math.abs(normal[2])
    const slope = nz > 1e-6 ? Math.hypot(normal[0], normal[1]) / nz : Infinity
    facets.push({
      id: attr(f[0], 'id') || `F${facets.length + 1}`,
      orientationDeg: Number(attr(poly, 'orientation') || 0),
      pitchOver12: Math.round(slope * 12 * 10) / 10,
      areaSqft: Math.round(area * 10) / 10,
      outline,
    })
  }

  const outLines: TruthLine[] = []
  const lengths: Record<TruthLineType, number> = { ridge: 0, hip: 0, valley: 0, rake: 0, eave: 0, flash: 0, stepflash: 0 }
  for (const lid of roofLineIds) {
    const l = lines.get(lid)
    const type = l?.type ? TYPE_MAP[l.type] : undefined
    if (!l || !type) continue
    const a = points.get(l.path[0]); const b = points.get(l.path[1])
    if (!a || !b) continue
    outLines.push({ type, lengthFt: l.length, a, b })
    lengths[type] += l.length
  }
  for (const k of Object.keys(lengths) as TruthLineType[]) lengths[k] = Math.round(lengths[k] * 100) / 100

  const byPitch = new Map<number, number>()
  for (const f of facets) {
    const p = Math.round(f.pitchOver12)
    byPitch.set(p, (byPitch.get(p) || 0) + f.areaSqft)
  }
  const pitches = [...byPitch.entries()].map(([pitchOver12, areaSqft]) => ({ pitchOver12, areaSqft: Math.round(areaSqft) }))
    .sort((a, b) => b.areaSqft - a.areaSqft)

  const loc = /<LOCATION\s[^>]*>/.exec(xml)?.[0] || ''
  let hoverSummary: RoofTruth['hoverSummary'] = null
  if (summaryJson) {
    try {
      const r = JSON.parse(summaryJson).roof
      hoverSummary = {
        areaSqft: r.roof_facets.area, facetCount: r.roof_facets.total,
        ridgeHipFt: r.ridges_hips.length || 0, valleyFt: r.valleys.length || 0,
        rakeFt: r.rakes.length || 0, eaveFt: r.gutters_eaves.length || 0,
      }
    } catch { /* a model without a readable summary is still an answer key */ }
  }

  return {
    id, source: 'hover',
    lat: Number(attr(loc, 'lat')), lon: Number(attr(loc, 'lon')),
    areaSqft: Math.round(facets.reduce((s, f) => s + f.areaSqft, 0)),
    facetCount: facets.length, facets, lines: outLines, lengths, pitches, hoverSummary,
  }
}

/** Where the private test data lives. */
export function truthDir(): string {
  const dir = process.env.ROOF_TRUTH_DIR
  if (!dir) throw new Error('Set ROOF_TRUTH_DIR to the private roof test-data folder (see packages/roof-core/bench/README.md)')
  return dir
}

/** Every Hover answer key in the test-data folder. */
export function loadHoverTruth(): RoofTruth[] {
  const root = join(truthDir(), 'hover')
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const xml = readFileSync(join(root, d.name, 'model.xml'), 'utf8')
    const s = join(root, d.name, 'summary.json')
    return parseHoverModel(d.name, xml, existsSync(s) ? readFileSync(s, 'utf8') : null)
  })
}

// Run directly: print each answer key beside Hover's own summary, so a reading error shows.
if (import.meta.main) {
  const pct = (a: number, b: number) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : 'n/a')
  for (const t of loadHoverTruth()) {
    const h = t.hoverSummary
    console.log(`\n${t.id}  facets ${t.facetCount}${h ? ` (Hover ${h.facetCount})` : ''}  hasLocation=${Number.isFinite(t.lat) && Number.isFinite(t.lon)}`)
    console.log(`  area ${t.areaSqft} sqft${h ? `  vs Hover ${h.areaSqft} (${pct(t.areaSqft, h.areaSqft)})` : ''}`)
    console.log(`  ridge ${t.lengths.ridge}  hip ${t.lengths.hip}${h ? `  [ridge+hip ${(t.lengths.ridge + t.lengths.hip).toFixed(2)} vs Hover ${h.ridgeHipFt}]` : ''}`)
    console.log(`  valley ${t.lengths.valley}${h ? ` vs ${h.valleyFt}` : ''}   rake ${t.lengths.rake}${h ? ` vs ${h.rakeFt}` : ''}   eave ${t.lengths.eave}${h ? ` vs ${h.eaveFt}` : ''}`)
    console.log(`  flash ${t.lengths.flash}  stepflash ${t.lengths.stepflash}   pitches ${t.pitches.map((p) => `${p.pitchOver12}/12:${p.areaSqft}`).join(' ')}`)
  }
}
