// The scoreboard: runs a roof engine over every cached answer-key house and prints how far each number is from the
// professionally measured one. Offline — it reads only the private cache fetchGoogle.ts filled.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/score.ts [runs=3]
//
// Today it scores the engine as shipped (processDsm + generateRoofReportFromDSM, on the 0.25 m data it asks for).
// The engine picks random samples, so each house is run several times: the spread between runs is itself a result.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadHoverTruth, truthDir, type RoofTruth } from './hoverTruth.ts'
import { processDsm } from '../src/dsmProcessor.ts'
import { generateRoofReportFromDSM, generateRoofReport } from '../src/roofReport.ts'

export interface EngineNumbers {
  areaSqft: number
  facets: number
  ridgeFt: number
  hipFt: number
  valleyFt: number
  rakeFt: number
  eaveFt: number
  /** Area-weighted share of the roof whose pitch is within 1/12 of the truth's pitch mix (0–1). */
  pitches: Array<{ pitchOver12: number; areaSqft: number }>
  /** Which path produced the numbers: the height map, or the fallback the service drops to when that throws. */
  path?: 'dsm' | 'fallback'
}

const SQM_TO_SQFT = 10.7639
const pct = (got: number, want: number) => (want > 0 ? ((got - want) / want) * 100 : got > 0 ? Infinity : 0)
const fmtPct = (p: number) => (Number.isFinite(p) ? `${p >= 0 ? '+' : ''}${p.toFixed(0)}%` : 'n/a')
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1)

/** How much of the roof's area the engine put at the right pitch (within 1/12), against the truth's pitch mix. */
export function pitchAgreement(got: EngineNumbers['pitches'], truth: RoofTruth): number {
  const want = new Map(truth.pitches.map((p) => [p.pitchOver12, p.areaSqft]))
  const total = truth.pitches.reduce((s, p) => s + p.areaSqft, 0)
  if (!total) return 0
  let matched = 0
  const left = new Map(want)
  for (const g of [...got].sort((a, b) => b.areaSqft - a.areaSqft)) {
    let remaining = g.areaSqft
    for (const d of [0, -1, 1]) {
      const k = g.pitchOver12 + d
      const avail = left.get(k) || 0
      const take = Math.min(avail, remaining)
      if (take > 0) { left.set(k, avail - take); matched += take; remaining -= take }
    }
  }
  return matched / total
}

async function runShippedEngine(t: RoofTruth, dir: string): Promise<EngineNumbers> {
  const dsm = readFileSync(join(dir, 'px25-dsm.tif'))
  const mask = readFileSync(join(dir, 'px25-mask.tif'))
  const log = console.log
  console.log = () => {}
  try {
    // As roofReportService does: the height map first, and the buildingInsights-only geometry when that throws.
    let r: ReturnType<typeof generateRoofReportFromDSM>
    let path: 'dsm' | 'fallback' = 'dsm'
    try {
      const d = await processDsm(dsm, mask, t.lat, t.lon)
      r = generateRoofReportFromDSM(d, t.lat, t.lon, 12)
    } catch {
      path = 'fallback'
      r = generateRoofReport(JSON.parse(readFileSync(join(dir, 'buildingInsights.json'), 'utf8')), 12)
    }
    const byPitch = new Map<number, number>()
    for (const s of r.segments) {
      const p = Math.round(Math.tan((s.pitchDegrees * Math.PI) / 180) * 12)
      byPitch.set(p, (byPitch.get(p) || 0) + s.area)
    }
    return {
      areaSqft: r.totalAreaSqft, facets: r.segments.filter((s) => s.area > 0).length,
      ridgeFt: r.measurements.totalRidgeLF, hipFt: r.measurements.totalHipLF, valleyFt: r.measurements.totalValleyLF,
      rakeFt: r.measurements.totalRakeLF, eaveFt: r.measurements.totalEaveLF,
      pitches: [...byPitch.entries()].map(([pitchOver12, areaSqft]) => ({ pitchOver12, areaSqft })),
      path,
    }
  } finally { console.log = log }
}

if (import.meta.main) {
  const runs = Number(process.argv[2] || 3)
  const rows: any[] = []
  for (const t of loadHoverTruth()) {
    const dir = join(truthDir(), 'google', t.id)
    if (!existsSync(join(dir, 'px25.json'))) { console.log(`${t.id}: not cached, skipped`); continue }
    const meta = JSON.parse(readFileSync(join(dir, 'px25.json'), 'utf8'))
    const bi = JSON.parse(readFileSync(join(dir, 'buildingInsights.json'), 'utf8'))
    const googleArea = (bi.solarPotential?.wholeRoofStats?.areaMeters2 || 0) * SQM_TO_SQFT
    const googleSegs = bi.solarPotential?.roofSegmentStats?.length || 0

    const out: EngineNumbers[] = []
    let failure: string | null = null
    for (let i = 0; i < runs; i++) {
      try { out.push(await runShippedEngine(t, dir)) } catch (e: any) { failure = e?.message || String(e) }
    }
    const truth = {
      area: t.areaSqft, facets: t.facetCount, ridgeHip: t.lengths.ridge + t.lengths.hip, ridge: t.lengths.ridge, hip: t.lengths.hip,
      valley: t.lengths.valley, rake: t.lengths.rake, eave: t.lengths.eave,
    }
    const avg = (f: (e: EngineNumbers) => number) => mean(out.map(f))
    const spread = (f: (e: EngineNumbers) => number) => (out.length ? Math.max(...out.map(f)) - Math.min(...out.map(f)) : 0)
    rows.push({
      id: t.id, imagery: `${meta.imageryQuality} ${meta.imageryDate?.year}-${String(meta.imageryDate?.month).padStart(2, '0')}`,
      runsOk: out.length, failure, truth, path: out[0]?.path || null,
      google: { areaSqft: Math.round(googleArea), areaErrPct: pct(googleArea, truth.area), segments: googleSegs },
      engine: out.length ? {
        areaSqft: Math.round(avg((e) => e.areaSqft)), areaErrPct: pct(avg((e) => e.areaSqft), truth.area), areaSpreadSqft: Math.round(spread((e) => e.areaSqft)),
        facets: avg((e) => e.facets),
        ridgeHipFt: avg((e) => e.ridgeFt + e.hipFt), ridgeHipErrPct: pct(avg((e) => e.ridgeFt + e.hipFt), truth.ridgeHip),
        valleyFt: avg((e) => e.valleyFt), valleyErrPct: pct(avg((e) => e.valleyFt), truth.valley),
        rakeFt: avg((e) => e.rakeFt), rakeErrPct: pct(avg((e) => e.rakeFt), truth.rake),
        eaveFt: avg((e) => e.eaveFt), eaveErrPct: pct(avg((e) => e.eaveFt), truth.eave),
        perimeterErrPct: pct(avg((e) => e.rakeFt + e.eaveFt), truth.rake + truth.eave),
        pitchAgreement: mean(out.map((e) => pitchAgreement(e.pitches, t))),
      } : null,
    })
  }

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)
  const num = (s: string, n: number) => s.padStart(n)
  console.log(`\nShipped engine vs Hover — ${runs} runs per house (averaged). Error = engine vs measured.\n`)
  console.log(pad('house', 22) + pad('imagery', 14) + pad('path', 9) + num('truth sqft', 11) + num('Google', 8) + num('engine', 8) + num('±runs', 7) + num('facets', 9) + num('ridge+hip', 10) + num('valley', 8) + num('rake', 7) + num('eave', 7) + num('perim', 7) + num('pitch ok', 9))
  for (const r of rows) {
    const e = r.engine
    console.log(pad(r.id.replace(/^\d+_/, ''), 22) + pad(r.imagery, 14) + pad(r.path || '-', 9) + num(String(r.truth.area), 11) + num(fmtPct(r.google.areaErrPct), 8)
      + (e ? num(fmtPct(e.areaErrPct), 8) + num(String(e.areaSpreadSqft), 7) + num(`${e.facets.toFixed(0)}/${r.truth.facets}`, 9) + num(fmtPct(e.ridgeHipErrPct), 10)
        + num(fmtPct(e.valleyErrPct), 8) + num(fmtPct(e.rakeErrPct), 7) + num(fmtPct(e.eaveErrPct), 7) + num(fmtPct(e.perimeterErrPct), 7) + num(`${(e.pitchAgreement * 100).toFixed(0)}%`, 9)
        : `   FAILED: ${r.failure}`))
  }
  const ok = rows.filter((r) => r.engine)
  const medAbs = (f: (r: any) => number) => {
    const v = ok.map((r) => Math.abs(f(r))).filter(Number.isFinite).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : NaN
  }
  console.log(`\nmedian absolute error over ${ok.length} houses:  Google area ${medAbs((r) => r.google.areaErrPct).toFixed(0)}%   engine area ${medAbs((r) => r.engine.areaErrPct).toFixed(0)}%   ridge+hip ${medAbs((r) => r.engine.ridgeHipErrPct).toFixed(0)}%   valley ${medAbs((r) => r.engine.valleyErrPct).toFixed(0)}%   perimeter ${medAbs((r) => r.engine.perimeterErrPct).toFixed(0)}%`)

  const outDir = join(truthDir(), 'results')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'baseline-shipped-engine.json'), JSON.stringify(rows, null, 1))
}
