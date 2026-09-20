// CI guard: a write endpoint the product depends on must be reachable FROM the product.
//
// Roof B1 was not a broken endpoint. POST /api/insurance/claims returned 201 for four builds, and the
// page behind it was a complete workspace — status rail, adjuster panel, supplements, Xactimate export
// — that an insurance job could never reach, because the empty state was one sentence with no
// controls. A tester asked three times. Nothing was broken; nothing was connected.
//
// That is a shape a normal test suite does not catch: the API tests pass, the page renders, and the
// feature is unreachable. So this checks the join — every write route in the roof insurance module
// must have a caller in the roof frontend, and the ones that deliberately have none are named here
// with the reason, so a NEW orphan fails instead of joining a silent pile.
//   bun scripts/check-insurance-reachable.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const ROUTES = 'templates/crm-roof/backend/src/routes/insurance.ts'
const FE = 'templates/crm-roof/frontend/src'

/**
 * Endpoints with no UI caller, each with a reason. This is NOT an "approved" list — it is the set of
 * known orphans, recorded so that a NEW one fails the build instead of quietly joining them. "No
 * caller" is otherwise indistinguishable from B1, which is how B1 survived four deploys.
 *
 * Two of these were found by this guard rather than by a tester, which is the point of writing it.
 */
const NO_UI_YET: Record<string, string> = {
  'post /supplements/:id/approve':
    'DECISION PENDING (roof T17 H1): approving double-counts the most recent approval, and the API is the only way to reach that code. The tester asked whether the endpoint should exist at all — the user\'s call, so it is not wired up on a guess.',
  'post /supplements/:id/deny':
    'DECISION PENDING: the other half of the approve pair; same question.',
  'put /supplements/:id':
    'FOUND BY THIS GUARD, not yet decided: a supplement can be created and submitted but never edited before submission. No tester has reported it.',
  'put /adjusters/:id':
    'FOUND BY THIS GUARD, not yet decided: the adjuster directory can create but not edit; the page has no Edit control at all.',
}

const routes = readFileSync(ROOT + ROUTES, 'utf8')
if (!routes) fail(`${ROUTES} is missing`)

// every write route the module exposes
const endpoints: Array<{ method: string; path: string }> = []
for (const m of routes.matchAll(/app\.(post|put|patch|delete)\('([^']+)'/g)) endpoints.push({ method: m[1], path: m[2] })
if (endpoints.length < 8) fail(`only ${endpoints.length} write endpoints found — this guard is not reading the routes it thinks it is`)

// the whole roof frontend, as one haystack
const files: string[] = []
const walk = (d: string) => {
  let entries: string[]
  try { entries = readdirSync(d) } catch { return }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist') continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if ((p.endsWith('.tsx') || p.endsWith('.ts')) && !e.startsWith('__head_')) files.push(p)
  }
}
walk(ROOT + FE)
if (!files.length) fail(`${FE} yielded no files`)
const frontend = files.map((f) => readFileSync(f, 'utf8')).join('\n')

/**
 * `/claims/:claimId/activity` must match `/api/insurance/claims/${claim.id}/activity` in a template.
 *
 * The trailing boundary is load-bearing: without it `/supplements/:id` matches the prefix of
 * `/supplements/${supId}/submit` and reports an endpoint as reachable when nothing calls it — the
 * exact failure this guard exists to catch, committed by the guard itself.
 */
const callerFor = (path: string) => {
  const pattern = path
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? '\\$\\{[^}]*\\}' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`/api/insurance/${pattern}(?![\\w/-])`)
}

const orphans: string[] = []
for (const { method, path } of endpoints) {
  const key = `${method} ${path}`
  if (key in NO_UI_YET) continue
  if (!callerFor(path).test(frontend)) orphans.push(key)
}
if (orphans.length)
  fail(`${orphans.length} insurance endpoint(s) have no caller in the roof frontend — the API works and the feature is unreachable, which is what B1 was:\n    ${orphans.join('\n    ')}`)

// B1 itself, pinned: the create path, and a control a person can actually see
{
  const page = readFileSync(ROOT + FE + '/pages/roofing/InsuranceClaimPage.tsx', 'utf8')
  if (!/fetch\('\/api\/insurance\/claims',\s*\{[\s\S]{0,120}method: 'POST'/.test(page))
    fail('the claim page must be able to START a claim, not only read one (B1)')
  if (!/Start insurance claim/.test(page))
    fail('…from a control a person can see, on the empty state')
  if (/No insurance claim found for this job\.\s*<\/div>/.test(page))
    fail('…and the empty state must not dead-end on a bare sentence again')
  if (!/jobType !== 'insurance'/.test(page))
    fail('…while a non-insurance job explains itself, because the server refuses it with a 400')
}

// the allowlist must not rot into a dumping ground
for (const key of Object.keys(NO_UI_YET)) {
  if (!endpoints.some((e) => `${e.method} ${e.path}` === key))
    fail(`${key} is listed as a known orphan but no longer exists — drop it from the list`)
}

if (failed) { console.error(`\ninsurance reachable: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`insurance reachable: ${endpoints.length} write endpoints, ${endpoints.length - Object.keys(NO_UI_YET).length} reachable from the product, ${Object.keys(NO_UI_YET).length} known orphans, each with a recorded reason`)
