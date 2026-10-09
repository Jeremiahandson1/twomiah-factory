// CI guard: the write-audit floor is MOUNTED, in the right place, in every template that has it. (T59)
//
// The floor (packages/tenant-backend/src/audit/writeFloor.ts) writes an audit row for a successful DELETE
// whose handler wrote none, naming the record. Its behaviour suites mount it themselves, so they cannot see
// whether a template's index.ts still does — unmounting it in one template passed every suite. This reads
// the wiring, with offsets, because a middleware's ORDER is what makes it work:
//
//   · requestScope.run must come first — audit.log marks the store, and the floor reads that mark;
//   · then app.use('*', writeAudit) — exactly once;
//   · and both before the first app.route('/api/…') — a Hono middleware registered after a route never
//     runs for it.
//
// Plus the two halves it depends on: middleware/writeAudit.ts wires the shared floor to this template's
// db, schema, audit.log and requestScope; services/audit.ts's log() sets `logged` on the scope.
//   bun scripts/check-write-audit-floor.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
const TEMPLATES = ['crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-restaurant', 'crm-salon', 'crm-vet', 'crm-dispensary', 'crm-roof']
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const shared = read('packages/tenant-backend/src/audit/writeFloor.ts')
if (!/export function createWriteAuditFloor/.test(shared)) fail('the shared floor must export createWriteAuditFloor')
if (!/deps\.scope\.getStore\(\)\?\.logged/.test(shared)) fail('the floor must skip a request whose handler already logged')
if (!/const before = method === 'DELETE' \? await nameBefore\(path\) : undefined\s*\n\s*await next\(\)/.test(shared)) fail('the floor must read a DELETE\'s name BEFORE the handler deletes the row')
if (!/for \(const k of NAME_COLUMNS\)/.test(shared) || !/const col = NAME_COLUMNS\.find/.test(shared)) fail('a create or edit is named from the record sent back, and a delete from its row — both by the same NAME_COLUMNS')
if (!/const SKIP = \[[\s\S]*?\\\/location\$[\s\S]*?\]/.test(shared)) fail('location pings must stay out of the log — a row a minute per phone buries every real change')
if (!/export \{ createWriteAuditFloor \} from '\.\/audit\/writeFloor'/.test(read('packages/tenant-backend/src/index.ts'))) fail('packages/tenant-backend must export createWriteAuditFloor')

for (const t of TEMPLATES) {
  const be = `templates/${t}/backend/src`
  const idx = read(`${be}/index.ts`)
  const scopeAt = idx.indexOf("app.use('*', (c, next) => requestScope.run({ c }, next))")
  const floorAts = [...idx.matchAll(/^app\.use\('\*', writeAudit\)$/gm)].map((m) => m.index!)
  const firstRoute = idx.search(/^app\.route\('\/api\//m)
  if (scopeAt < 0) fail(`${t}: index.ts does not open requestScope`)
  if (floorAts.length !== 1) fail(`${t}: index.ts must mount writeAudit exactly once (found ${floorAts.length})`)
  else {
    if (floorAts[0] < scopeAt) fail(`${t}: writeAudit is mounted BEFORE requestScope opens — it could not see audit.log's mark`)
    if (firstRoute >= 0 && floorAts[0] > firstRoute) fail(`${t}: writeAudit is mounted AFTER the first route — it would never run for it`)
  }
  if (!/import \{ writeAudit \} from '\.\/middleware\/writeAudit\.ts'/.test(idx)) fail(`${t}: index.ts must import writeAudit`)
  if (!existsSync(ROOT + `${be}/middleware/writeAudit.ts`)) fail(`${t}: middleware/writeAudit.ts is missing`)
  else if (!/createWriteAuditFloor\(\{ db, schema, log: audit\.log, scope: requestScope \}\)/.test(read(`${be}/middleware/writeAudit.ts`))) fail(`${t}: writeAudit.ts must wire db, schema, audit.log and requestScope`)
  const aud = read(`${be}/services/audit.ts`)
  if (!/export async function log\([^)]*\)[^{]*\{\s*\n(?:\s*\/\/.*\n)*\s*const scope: any = requestScope\.getStore\(\);?\s*\n\s*if \(scope\) scope\.logged = true/.test(aud)) fail(`${t}: services/audit.ts log() must mark the request scope as logged, first thing`)
}

if (failed) { console.error(`\nwrite audit floor: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`write audit floor: mounted after requestScope and before the routes in ${TEMPLATES.length} templates; audit.log marks the scope`)
