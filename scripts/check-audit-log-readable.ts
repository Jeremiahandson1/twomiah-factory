// CI guard: the audit log is readable by the page that shows it.
//
// The rows come out of raw SQL in snake_case. They were returned exactly as they came, while AuditLogPage
// reads log.createdAt, log.userName / log.userEmail and log.description — so all 262 events rendered with an
// em-dash for the time, "System" for the person and an em-dash for what happened, with every value sitting
// right there in the row. An audit trail nobody can read is not an audit trail. (Dispensary T20)
//
// Same class as the camel() note in kiosk.ts and cash.ts: "raw-SQL rows come back snake_case, but the UI
// reads camelCase". The fix belongs where the rows are read, once, not in the page.
//   bun scripts/check-audit-log-readable.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const svc = read('templates/crm-dispensary/backend/src/services/audit.ts')
if (!svc) fail('the dispensary audit service is missing')
if (!/export function presentLog\(row: any\): any/.test(svc)) fail('audit rows must be presented in the shape the page reads, in one place')
if (!/out\[k\.replace\(\/_\(\[a-z\]\)\/g, \(_m, ch\) => ch\.toUpperCase\(\)\)\] = row\[k\]/.test(svc)) fail('…converting snake_case keys to camelCase (createdAt, userName, userEmail)')
if (!/Object\.assign\(out, row\)/.test(svc)) fail('…while KEEPING the original keys, so anything already reading snake_case still works')
if (!/out\.description = describeLog\(row\)/.test(svc)) fail('…and composing a description, which no column holds')
if (!/export function describeLog\(row: any\): string/.test(svc)) fail('there must be one description composer')
if (!/if \(row\?\.details\) return String\(row\.details\)/.test(svc)) fail('…preferring a description the caller actually wrote')
if (!/\.map\(presentLog\)/.test(svc)) fail('the audit list must present its rows')
if ((svc.match(/\.map\(presentLog\)/g) || []).length < 2) fail("…and so must an entity's history, or the same page reads two shapes")

// the page is the contract: if it starts reading a different field, this guard should be updated with it
const page = read('templates/crm-dispensary/frontend/src/pages/AuditLogPage.tsx')
if (page) {
  if (!/log\.createdAt/.test(page)) fail('AuditLogPage no longer reads createdAt — update this guard and the presenter together')
  if (!/log\.userName \|\| log\.userEmail/.test(page)) fail('AuditLogPage no longer reads userName/userEmail — update this guard and the presenter together')
  if (!/log\.description/.test(page)) fail('AuditLogPage no longer reads description — update this guard and the presenter together')
}

// …and it has to be WRITTEN in the first place. Nearly every route passed `req: c.req` while this service read
// req.user.* — Hono keeps the signed-in user on the CONTEXT, not the request — so company_id came out null,
// the insert failed its NOT NULL, and the catch swallowed it. Creating an order recorded nothing at all.
if (!/function resolveActor\(req: any\)/.test(svc)) fail('the service must work out the actor from whatever it is handed')
if (!/const user = typeof req\?\.get === 'function' \? req\.get\('user'\) : req\?\.user/.test(svc)) fail('…reading the user from the Hono CONTEXT, and still accepting a plain { user }')
if (!/if \(!actor\.companyId\)/.test(svc)) fail('…and refusing to attempt a row it knows cannot be inserted')
if (!/console\.error\(`Audit log skipped/.test(svc)) fail('…saying so, rather than losing the event in a swallowed catch')
if (/userId: req\?\.user\?\.userId/.test(svc)) fail('the insert must use the resolved actor, not req.user, which a Hono request never has')
const ROUTES = 'templates/crm-dispensary/backend/src/routes/'
for (const f of ['orders.ts', 'contacts.ts', 'compliance.ts', 'cash.ts', 'inventory.ts']) {
  const r = read(ROUTES + f)
  if (r && /req: c\.req\b/.test(r)) fail(`${f} still hands audit.log the REQUEST — the user is on the context, so nothing is recorded`)
}

if (failed) { console.error(`\naudit log readable: ${failed} check(s) FAILED`); process.exit(1) }
console.log('audit log readable: rows are presented in the shape the page reads, with a description composed from what happened')
