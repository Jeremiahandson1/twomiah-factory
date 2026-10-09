// CI guard: the delete-audit floor is MOUNTED, in the right place, in every template that has it. (T59)
//
// The floor (packages/tenant-backend/src/audit/deleteFloor.ts) writes an audit row for a successful DELETE
// whose handler wrote none, naming the record. Its behaviour suites mount it themselves, so they cannot see
// whether a template's index.ts still does — unmounting it in one template passed every suite. This reads
// the wiring, with offsets, because a middleware's ORDER is what makes it work:
//
//   · requestScope.run must come first — audit.log marks the store, and the floor reads that mark;
//   · then app.use('*', deleteAudit) — exactly once;
//   · and both before the first app.route('/api/…') — a Hono middleware registered after a route never
//     runs for it.
//
// Plus the two halves it depends on: middleware/deleteAudit.ts wires the shared floor to this template's
// db, schema, audit.log and requestScope; services/audit.ts's log() sets `logged` on the scope.
//   bun scripts/check-delete-audit-floor.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
const TEMPLATES = ['crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-restaurant', 'crm-salon', 'crm-vet', 'crm-dispensary']
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const shared = read('packages/tenant-backend/src/audit/deleteFloor.ts')
if (!/export function createDeleteAuditFloor/.test(shared)) fail('the shared floor must export createDeleteAuditFloor')
if (!/deps\.scope\.getStore\(\)\?\.logged/.test(shared)) fail('the floor must skip a request whose handler already logged')
if (!/const before = await nameBefore\(path\)\s*\n\s*await next\(\)/.test(shared)) fail('the floor must read the name BEFORE the handler deletes the row')
if (!/export \{ createDeleteAuditFloor \} from '\.\/audit\/deleteFloor'/.test(read('packages/tenant-backend/src/index.ts'))) fail('packages/tenant-backend must export createDeleteAuditFloor')

for (const t of TEMPLATES) {
  const be = `templates/${t}/backend/src`
  const idx = read(`${be}/index.ts`)
  const scopeAt = idx.indexOf("app.use('*', (c, next) => requestScope.run({ c }, next))")
  const floorAts = [...idx.matchAll(/^app\.use\('\*', deleteAudit\)$/gm)].map((m) => m.index!)
  const firstRoute = idx.search(/^app\.route\('\/api\//m)
  if (scopeAt < 0) fail(`${t}: index.ts does not open requestScope`)
  if (floorAts.length !== 1) fail(`${t}: index.ts must mount deleteAudit exactly once (found ${floorAts.length})`)
  else {
    if (floorAts[0] < scopeAt) fail(`${t}: deleteAudit is mounted BEFORE requestScope opens — it could not see audit.log's mark`)
    if (firstRoute >= 0 && floorAts[0] > firstRoute) fail(`${t}: deleteAudit is mounted AFTER the first route — it would never run for it`)
  }
  if (!/import \{ deleteAudit \} from '\.\/middleware\/deleteAudit\.ts'/.test(idx)) fail(`${t}: index.ts must import deleteAudit`)
  if (!existsSync(ROOT + `${be}/middleware/deleteAudit.ts`)) fail(`${t}: middleware/deleteAudit.ts is missing`)
  else if (!/createDeleteAuditFloor\(\{ db, schema, log: audit\.log, scope: requestScope \}\)/.test(read(`${be}/middleware/deleteAudit.ts`))) fail(`${t}: deleteAudit.ts must wire db, schema, audit.log and requestScope`)
  const aud = read(`${be}/services/audit.ts`)
  if (!/export async function log\([^)]*\)[^{]*\{\s*\n(?:\s*\/\/.*\n)*\s*const scope: any = requestScope\.getStore\(\);?\s*\n\s*if \(scope\) scope\.logged = true/.test(aud)) fail(`${t}: services/audit.ts log() must mark the request scope as logged, first thing`)
}

if (failed) { console.error(`\ndelete audit floor: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`delete audit floor: mounted after requestScope and before the routes in ${TEMPLATES.length} templates; audit.log marks the scope`)
