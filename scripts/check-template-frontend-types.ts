// CI guard: a template's frontend must not reference a name that does not exist.
//
// WHY THIS EXISTS. T33, a blocker on a live tenant: opening any takeoff sheet blanked the whole page
// with `ReferenceError: selectedSheet is not defined`. I had put the Export to PO button and its
// modal inside `TotalsFooter` while the nine values they read are state on `TakeoffsPage`. The
// footer renders as soon as a sheet with items is opened, so the normal path took the screen down.
//
// Nothing in the existing net could see it, because it is valid JavaScript:
//   · `bun build` parses it fine — an undeclared identifier is a RUNTIME error
//   · the 188 guards resolve no identifiers
//   · all 20 crm suites pass — they exercise the API, and nothing renders the page
//
// `tsc --noEmit` finds it in under a minute and names the line:
//   TakeoffsPage.tsx(585,26): error TS2304: Cannot find name 'setExportOpen'.
//
// TypeScript and a tsconfig were already in the template. The check had simply never been run.
//
//   bun scripts/check-template-frontend-types.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/**
 * Templates that typecheck CLEAN today, verified one at a time. Any error at all fails the guard —
 * a clean tree is only worth having if it cannot rot.
 */
const CLEAN = ['crm', 'crm-restaurant', 'crm-rv', 'crm-salon']

/**
 * Templates with KNOWN pre-existing errors, counted so new ones cannot hide among them.
 *
 * crm-vet carries 4, all in PatientDetailPage.tsx: one `string | undefined` passed where a string
 * is wanted (TS2345) and three cast complaints (TS2352). They are type-strictness, not the
 * crash class — none of them is a name that does not exist — so they are recorded rather than
 * fixed here, which would be unrelated work in an unrelated vertical.
 */
const RATCHET: Record<string, number> = { 'crm-vet': 4 }

/**
 * THE RULE THAT HAS NO EXCEPTIONS, wherever this guard can look.
 *
 * TS2304 is "Cannot find name" — an identifier that does not exist. That is not a matter of taste
 * or strictness: it is a ReferenceError waiting for the render that reaches it. Zero, everywhere,
 * including the templates that are otherwise allowed their ratchet.
 */
const NEVER = /error TS2304:/

const templates = [...CLEAN, ...Object.keys(RATCHET)]
const skipped: string[] = []
let checked = 0

for (const t of templates) {
  const dir = join(ROOT, 'templates', t, 'frontend')
  const tsc = join(dir, 'node_modules', 'typescript', 'lib', 'tsc.js')
  if (!existsSync(join(dir, 'tsconfig.json'))) { fail(`${t}: frontend has no tsconfig.json`); continue }
  if (!existsSync(tsc)) {
    // Not a pass. The dependencies are not installed here, so this template was NOT checked, and
    // saying so is the difference between a gap and a silent one.
    skipped.push(t)
    continue
  }
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const errors = out.split('\n').filter((l) => / error TS\d+:/.test(l))
  checked++

  const missingNames = errors.filter((l) => NEVER.test(l))
  for (const l of missingNames) fail(`${t}: a name that does not exist — this is a blank screen, not a type nit\n        ${l.trim()}`)

  const allowed = RATCHET[t] ?? 0
  if (errors.length > allowed) {
    if (!missingNames.length) {
      fail(`${t}: ${errors.length} type error(s), ${allowed} allowed`)
      for (const l of errors.slice(0, 6)) console.error(`        ${l.trim()}`)
    }
  } else if (errors.length < allowed) {
    console.log(`note: ${t} is down to ${errors.length} error(s) from ${allowed} — lower the ratchet in this guard`)
  }
}

if (skipped.length) {
  console.log(`note: NOT CHECKED (dependencies not installed in this checkout): ${skipped.join(', ')}`)
  console.log('      `bun install` in templates/<t>/frontend brings them into scope.')
}

/**
 * What this guard still CANNOT see, named rather than left implied.
 *
 * Two different gaps, which it is worth not conflating:
 *
 *  1. SIX template frontends do not list `typescript` as a dependency at all, so there is nothing to
 *     run — `bun install` succeeds and leaves no compiler. Adding one is a small change; their first
 *     typecheck is not, which is why this guard does not pretend to cover them today.
 *
 *  2. packages/tenant-ui AND packages/tenant-backend have NO tsconfig and no compiler, and they are
 *     vendored into EVERY vertical at generation. That is the larger exposure by far: the blocker
 *     this guard exists for happened in template-local code, but the same mistake in tenant-ui would
 *     reach all thirteen at once. A template's typecheck does not cover it either — `src/shared` is
 *     created at generation time and does not exist in the repo.
 */
const NO_COMPILER = ['crm-automotive', 'crm-basic', 'crm-dispensary', 'crm-fieldservice', 'crm-landscaping', 'crm-roof']
  .filter((t) => existsSync(join(ROOT, 'templates', t, 'frontend')))
  .filter((t) => !/"typescript"/.test(readFileSync(join(ROOT, 'templates', t, 'frontend', 'package.json'), 'utf8')))
if (NO_COMPILER.length) console.log(`note: ${NO_COMPILER.length} template frontend(s) list no typescript dependency, so they cannot be checked: ${NO_COMPILER.join(', ')}`)
for (const p of ['tenant-ui', 'tenant-backend']) {
  if (!existsSync(join(ROOT, 'packages', p, 'tsconfig.json'))) {
    console.log(`note: packages/${p} has no tsconfig and is NEVER typechecked — it is vendored into every vertical`)
  }
}

if (failed) { console.error(`\ntemplate frontend types: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`template frontend types: ${checked} template(s) typechecked, 0 undeclared names${skipped.length ? `, ${skipped.length} skipped` : ''}`)
