// The weaker answer key: jobs where only the address and the roofer's bid size in squares are known (no line lengths).
// They check total area, and show how Google's data looks on more houses. Private, in ROOF_TRUTH_DIR/squares/jobs.json:
//   [{ id, address, squares, note, lat?, lon? }]   — lat/lon are filled in by fetchGoogle.ts the first time.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { truthDir } from './hoverTruth.ts'

export interface SquaresJob { id: string; address: string; squares: number; note?: string; lat?: number; lon?: number }

const file = () => join(truthDir(), 'squares', 'jobs.json')

export function loadSquaresJobs(): SquaresJob[] {
  return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : []
}

export function saveSquaresJobs(jobs: SquaresJob[]) {
  writeFileSync(file(), JSON.stringify(jobs, null, 1))
}
