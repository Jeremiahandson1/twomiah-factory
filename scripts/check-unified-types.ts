/**
 * Type-checks the unified app. Its own files must have no type errors. The shared packages it builds on were never
 * type-checked (the CRM templates vendor them as source); their count is held at the baseline below and may only go
 * down. The fence (RULEBOOK §10) keeps their source read-only until cutover, when they are fixed as they move in
 * (docs/CUTOVER_LEDGER.md).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Shared-package type errors when the unified app first type-checked them (2026-10-18). Lower it as they are fixed. */
export const PACKAGES_BASELINE = 205

const app = path.resolve(import.meta.dir, '..', 'apps', 'unified')
// `bun x tsc` from the app's folder runs the app's own TypeScript; no shell, so a path with spaces stays one path.
const run = spawnSync(process.execPath, ['x', 'tsc', '-p', 'tsconfig.json', '--noEmit'], { cwd: app, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const lines = (run.stdout + run.stderr).split('\n').filter((l) => /error TS\d+/.test(l))
// A run that printed nothing and failed is not "no errors" (the bunx tsc false negative).
if (run.status !== 0 && lines.length === 0) {
  console.log((run.stdout + run.stderr).trim() || `tsc exited ${run.status} with no output`)
  process.exit(1)
}
const own = lines.filter((l) => !l.replace(/\\/g, '/').startsWith('../../packages/'))
const shared = lines.length - own.length
for (const l of own) console.log(l)
console.log(`unified app: ${own.length} type error(s); shared packages: ${shared} (baseline ${PACKAGES_BASELINE})`)
if (own.length) process.exit(1)
if (shared > PACKAGES_BASELINE) { console.log('The shared packages gained type errors.'); process.exit(1) }
if (shared < PACKAGES_BASELINE) console.log(`Shared packages improved: lower PACKAGES_BASELINE to ${shared}.`)
process.exit(0)
