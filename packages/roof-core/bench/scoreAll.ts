// The whole of engine v2 on every cached house: its grade and reasons, and — where a Hover answer key exists — how far
// each number is from the measured one. The question it answers: does the grade tell the good measurements from the bad?
// Offline.
//
//   ROOF_TRUTH_DIR=<private folder> bun packages/roof-core/bench/scoreAll.ts
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadHoverTruth, truthDir } from './hoverTruth.ts'
import { loadSquaresJobs } from './squaresTruth.ts'
import { measureRoof } from '../src/v2/index.ts'

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n)
const err = (got: number, want: number) => (want > 0 ? `${got >= want ? '+' : ''}${(((got - want) / want) * 100).toFixed(0)}%` : got > 1 ? `+${Math.round(got)}ft` : '0')
const today = { year: 2026, month: 11 }

async function run(id: string) {
  const dir = join(truthDir(), 'google', id)
  if (!existsSync(join(dir, 'px25.json'))) return null
  const meta = JSON.parse(readFileSync(join(dir, 'px25.json'), 'utf8'))
  const m = await measureRoof(readFileSync(join(dir, 'px25-dsm.tif')), readFileSync(join(dir, 'px25-mask.tif')), { quality: meta.imageryQuality, date: meta.imageryDate, today })
  return m
}

const out: any[] = []
console.log(`\nEngine v2 against Hover — error in each number, and the grade the engine gave itself\n`)
console.log(pad('house', 24) + pad('grade', 8) + pad('area', 7) + pad('ridge+hip', 11) + pad('valley', 9) + pad('eave', 7) + pad('rake', 7) + 'reasons')
for (const t of loadHoverTruth()) {
  const m = await run(t.id)
  if (!m) continue
  const L = m.lines, T = t.lengths
  out.push({ id: t.id, grade: m.grade, reasons: m.reasons, engine: { areaSqft: m.areaSqft, ...L }, truth: { areaSqft: t.areaSqft, ...T } })
  console.log(pad(t.id.replace(/^\d+_/, ''), 24) + pad(m.grade.toUpperCase(), 8) + pad(err(m.areaSqft, t.areaSqft), 7) + pad(err(L.ridge + L.hip, T.ridge + T.hip), 11)
    + pad(err(L.valley, T.valley), 9) + pad(err(L.eave, T.eave), 7) + pad(err(L.rake, T.rake), 7) + (m.reasons.join('; ') || '—'))
}
console.log(`\nBid-size jobs (bid squares carry 10% waste)\n`)
console.log(pad('job', 24) + pad('grade', 8) + pad('v2 +10%', 9) + pad('bid', 8) + pad('vs bid', 8) + 'reasons')
for (const j of loadSquaresJobs()) {
  const m = await run(j.id)
  if (!m) continue
  const withWaste = (m.areaSqft * 1.1) / 100
  out.push({ id: j.id, grade: m.grade, reasons: m.reasons, engine: { areaSqft: m.areaSqft, ...m.lines }, bidSquares: j.squares })
  console.log(pad(j.id, 24) + pad(m.grade.toUpperCase(), 8) + pad(withWaste.toFixed(1), 9) + pad(String(j.squares), 8) + pad(err(withWaste, j.squares), 8) + (m.reasons.join('; ') || '—'))
}
writeFileSync(join(truthDir(), 'results', 'v2-all.json'), JSON.stringify(out, null, 1))
