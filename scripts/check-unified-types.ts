/**
 * Type-checks the unified app: the server (tsconfig.json) and the admin screens (web/tsconfig.json). Its own files must
 * have no type errors. The shared packages it builds on were never type-checked (the CRM templates vendor them as
 * source); their count per project is held at the baseline below and may only go down. The fence (RULEBOOK §10) keeps
 * their source read-only until cutover, when they are fixed as they move in (docs/CUTOVER_LEDGER.md).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * Shared-package type errors per project when it first type-checked them. Lower one as they are fixed.
 *   server: 2026-10-18, 205 (packages/tenant-backend and what it reaches); 203 on 2026-10-22 (jobs.ts PUT typed).
 *   web:    2026-10-18, 0 (the tenant-ui screens the admin imports through web/src/shared.ts).
 */
export const PACKAGES_BASELINE: Record<string, number> = { 'tsconfig.json': 203, 'web/tsconfig.json': 0 }

const app = path.resolve(import.meta.dir, '..', 'apps', 'unified')
let failed = false
for (const [project, baseline] of Object.entries(PACKAGES_BASELINE)) {
  // `bun x tsc` from the app's folder runs the app's own TypeScript; no shell, so a path with spaces stays one path.
  const run = spawnSync(process.execPath, ['x', 'tsc', '-p', project, '--noEmit'], { cwd: app, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const lines = (run.stdout + run.stderr).split('\n').filter((l) => /error TS\d+/.test(l))
  // A run that printed nothing and failed is not "no errors" (the bunx tsc false negative).
  if (run.status !== 0 && lines.length === 0) {
    console.log(`${project}: ` + ((run.stdout + run.stderr).trim() || `tsc exited ${run.status} with no output`))
    failed = true
    continue
  }
  const own = lines.filter((l) => !l.replace(/\\/g, '/').startsWith('../../packages/'))
  const shared = lines.length - own.length
  for (const l of own) console.log(l)
  console.log(`${project}: ${own.length} type error(s) in the app; shared packages: ${shared} (baseline ${baseline})`)
  if (own.length) failed = true
  if (shared > baseline) { console.log(`${project}: the shared packages gained type errors.`); failed = true }
  if (shared < baseline) console.log(`${project}: shared packages improved: lower its PACKAGES_BASELINE to ${shared}.`)
}
// The Factory's side of the unified app (apps/api/src/unified, RULEBOOK §10): none in its own files. The rest of the
// Factory is live code the fence keeps read-only; its own errors are not this check's.
{
  const api = path.resolve(import.meta.dir, '..', 'apps', 'api')
  // The repo's own TypeScript (the unified app's devDependency), not `bun x tsc`: apps/api has none, so bun x fetched
  // typescript@latest into a temp folder each run — an unpinned compiler, and on this machine a half-written download
  // ("lib.d.ts does not exist") three times in one day. (2026-10-19)
  const tsc = path.resolve(import.meta.dir, '..', 'apps', 'unified', 'node_modules', 'typescript', 'bin', 'tsc')
  const run = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit'], { cwd: api, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const lines = (run.stdout + run.stderr).split('\n').filter((l) => /error TS\d+/.test(l))
  if (run.status !== 0 && lines.length === 0) {
    console.log('apps/api: ' + ((run.stdout + run.stderr).trim() || `tsc exited ${run.status} with no output`))
    failed = true
  } else {
    const own = lines.filter((l) => l.replace(/\\/g, '/').startsWith('src/unified/'))
    for (const l of own) console.log('apps/api/' + l)
    console.log(`apps/api/src/unified: ${own.length} type error(s)`)
    if (own.length) failed = true
  }
}
process.exit(failed ? 1 : 0)
