// Scores engine v2's first layer (which building, area on the slope, pitch mix) against the answer keys. Offline.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/scoreSurface.ts [px10|px25]
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadHoverTruth, truthDir } from './hoverTruth.ts'
import { loadSquaresJobs } from './squaresTruth.ts'
import { pitchAgreement } from './score.ts'
import { measureRoofSurface } from '../src/v2/roofSurface.ts'

const tag = process.argv[2] || 'px10'
const pct = (got: number, want: number) => `${got >= want ? '+' : ''}${(((got - want) / want) * 100).toFixed(0)}%`
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)

console.log(`\nEngine v2 surface layer on ${tag} data\n`)
console.log(pad('house', 26) + pad('pin', 12) + pad('measured', 10) + pad('v2 slope', 10) + pad('error', 8) + pad('pitch ok', 10) + pad('sure', 6) + 'v2 pitch mix  |  measured pitch mix')
const errs: number[] = []
for (const t of loadHoverTruth()) {
  const dir = join(truthDir(), 'google', t.id)
  if (!existsSync(join(dir, `${tag}.json`))) continue
  const s = await measureRoofSurface(readFileSync(join(dir, `${tag}-dsm.tif`)), readFileSync(join(dir, `${tag}-mask.tif`)))
  if (!s) { console.log(pad(t.id, 26) + 'no roof found'); continue }
  if (s.pinOnRoof) errs.push(Math.abs((s.slopeSqft - t.areaSqft) / t.areaSqft) * 100)
  console.log(pad(t.id.replace(/^\d+_/, ''), 26) + pad(s.pinOnRoof ? 'on roof' : `off ${s.pinDistanceM}m`, 12) + pad(String(t.areaSqft), 10) + pad(String(s.slopeSqft), 10)
    + pad(pct(s.slopeSqft, t.areaSqft), 8) + pad(`${(pitchAgreement(s.pitches, t) * 100).toFixed(0)}%`, 10) + pad(`${(s.confidentShare * 100).toFixed(0)}%`, 6)
    + s.pitches.slice(0, 4).map((p) => `${p.pitchOver12}/12:${p.areaSqft}`).join(' ') + '  |  ' + t.pitches.slice(0, 4).map((p) => `${p.pitchOver12}/12:${p.areaSqft}`).join(' '))
}
errs.sort((a, b) => a - b)
console.log(`\nHover houses with the pin on the roof: median area error ${errs[Math.floor(errs.length / 2)]?.toFixed(1)}%, worst ${errs[errs.length - 1]?.toFixed(1)}%  (${errs.length} houses)`)

console.log(`\nBid-size jobs (the bid is in squares and normally carries 10% waste)\n`)
console.log(pad('job', 26) + pad('pin', 12) + pad('bid sqft', 10) + pad('v2 slope', 10) + pad('v2 +10%', 10) + pad('vs bid', 8) + 'v2 pitch mix')
for (const j of loadSquaresJobs()) {
  const dir = join(truthDir(), 'google', j.id)
  if (!existsSync(join(dir, `${tag}.json`))) continue
  const s = await measureRoofSurface(readFileSync(join(dir, `${tag}-dsm.tif`)), readFileSync(join(dir, `${tag}-mask.tif`)))
  if (!s) { console.log(pad(j.id, 26) + 'no roof found'); continue }
  const bid = j.squares * 100, withWaste = Math.round(s.slopeSqft * 1.1)
  console.log(pad(j.id, 26) + pad(s.pinOnRoof ? 'on roof' : `off ${s.pinDistanceM}m`, 12) + pad(String(Math.round(bid)), 10) + pad(String(s.slopeSqft), 10) + pad(String(withWaste), 10) + pad(pct(withWaste, bid), 8)
    + s.pitches.slice(0, 4).map((p) => `${p.pitchOver12}/12:${p.areaSqft}`).join(' ') + (j.note ? `   (${j.note})` : ''))
}
