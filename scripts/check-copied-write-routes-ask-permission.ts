// CI guard: the write routes every CRM carries as a COPY ask a permission in every copy.
//
// T68: the lender application (wisetack POST /applications, financing POST /apply) and the weather fill-in on a
// daily log (weather POST /daily-log/:dailyLogId/populate) asked nothing but a login, in all eight CRMs that copy
// those files. tests/crm/t68-open-writes.test.ts proves the rule on the contractor's copy; this holds the other seven
// to it, because a copy is exactly where a fix lands once and is missed everywhere else.
//
// It reads the ROUTE CALL itself — the path and the guard handed to it — not a keyword anywhere in the file, so a
// comment naming the permission cannot satisfy it and a second, ungated registration of the same path fails it.
//
//   bun scripts/check-copied-write-routes-ask-permission.ts
import { readdirSync, existsSync, readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const RULES: { file: string; method: string; path: string; permission: string; notACopyIn?: Record<string, string> }[] = [
  { file: 'wisetack.ts', method: 'post', path: '/applications', permission: 'invoices:create' },
  { file: 'financing.ts', method: 'post', path: '/apply', permission: 'invoices:create',
    // a different module under the same file name: roofing's own application tracker, every write gated on
    // financing:* since 09/27 (route-auth pass) — not the copied multi-provider router this rule is about
    notACopyIn: { 'crm-roof': "roofing's own financing module (financing:create/update/approve/delete), not the copied router" } },
  { file: 'weather.ts', method: 'post', path: '/daily-log/:dailyLogId/populate', permission: 'daily-logs:update' },
]
// Parked templates are not shipped; homecare and automotive keep their own forks of these modules.
const SKIP = new Set(['crm-automotive', 'crm-homecare'])

let failed = 0, checked = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const t of readdirSync(`${ROOT}templates`).filter((d) => d.startsWith('crm') && !SKIP.has(d)).sort()) {
  for (const r of RULES) {
    const f = `${ROOT}templates/${t}/backend/src/routes/${r.file}`
    if (!existsSync(f) || r.notACopyIn?.[t]) continue
    const src = strip(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
    const calls = [...src.matchAll(new RegExp(`app\\.${r.method}\\(\\s*['"]${esc(r.path)}['"]\\s*,([^\\n]*)`, 'g'))]
    if (calls.length === 0) { fail(`${t}/${r.file}: no ${r.method.toUpperCase()} ${r.path} route found — the guard's anchor is stale, not the code fixed`); continue }
    for (const m of calls) {
      checked++
      if (!new RegExp(`^\\s*requirePermission\\(\\s*['"]${esc(r.permission)}['"]\\s*\\)`).test(m[1]))
        fail(`${t}/${r.file}: ${r.method.toUpperCase()} ${r.path} must be registered with requirePermission('${r.permission}') first — found: ${m[1].trim().slice(0, 80)}`)
    }
    if (!/import \{[^}]*\brequirePermission\b[^}]*\} from '\.\.\/middleware\/permissions\.ts'/.test(src))
      fail(`${t}/${r.file}: uses requirePermission without importing it — esbuild parses that and the route 500s`)
  }
}
if (checked < 15) fail(`only ${checked} route registrations checked — expected the eight CRMs' copies; the walk is broken`)
if (failed) { console.error(`\ncopied write routes: ${failed} problem(s)`); process.exit(1) }
console.log(`copied write routes: ${checked} registrations across the CRMs ask their permission`)
