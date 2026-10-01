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

// ── the same fault, in the OTHER twelve templates ────────────────────────────────────────────────
//
// The block above was written when only the dispensary had been fixed, and it only ever looked at
// the dispensary. Eight templates share a byte-identical audit.ts that still read `req.user.*`, and
// every shared module handed it `c.req` — so contact creates, updates, deletes and conversions,
// Stripe refunds, QuickBooks syncs and review sends recorded NOTHING on any of them. A guard that
// covers one template is a guard that watches one door of thirteen. (T32)
const SHARED_AUDIT = [
  'templates/crm/backend/src/services/audit.ts',
  'templates/crm-basic/backend/src/services/audit.ts',
  'templates/crm-fieldservice/backend/src/services/audit.ts',
  'templates/crm-landscaping/backend/src/services/audit.ts',
  'templates/crm-restaurant/backend/src/services/audit.ts',
  'templates/crm-rv/backend/src/services/audit.ts',
  'templates/crm-salon/backend/src/services/audit.ts',
  'templates/crm-vet/backend/src/services/audit.ts',
]
for (const p of SHARED_AUDIT) {
  const a = read(p)
  if (!a) { fail(`${p} is missing`); continue }
  const name = p.split('/')[1]
  if (!/function resolveActor\(req: any\)/.test(a)) fail(`${name}: audit.ts must work the actor out from whatever it is handed`)
  if (!/typeof req\?\.get === 'function' \? req\.get\('user'\) : req\?\.user/.test(a)) fail(`${name}: …reading the user from the Hono CONTEXT, and still accepting a plain { user }`)
  if (/req\?\.user\?\.companyId/.test(a)) fail(`${name}: audit.ts still reads req.user.companyId — neither a Hono request nor a Hono context has one`)
  // The dispensary's version dropped the explicit userId/companyId arguments. Copying that here
  // would have silently broken the fifteen call sites (bulk, export, import, migration) that look
  // their own user up and pass the ids directly, which DO work today.
  if (!/actor\.companyId \|\| companyId/.test(a)) fail(`${name}: an explicit companyId must still be honoured, or bulk/export/import/migration stop recording`)
  if (!/Audit log skipped/.test(a)) fail(`${name}: …and a row it knows cannot be inserted must say so, not vanish into a catch`)
}

// No caller anywhere may hand audit.log a request. One pattern, every template and every shared
// module — the shared ones are the ones that matter, because a single line there is wrong in eight
// verticals at once. crm-automotive is parked and deliberately not in scope.
const CALLERS = [
  'packages/tenant-backend/src/contacts/contacts.ts',
  'packages/tenant-backend/src/integrations/quickbooks.ts',
  'packages/tenant-backend/src/integrations/reviews.ts',
  'packages/tenant-backend/src/payments/stripe.ts',
  ...['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
    .map((t) => `templates/${t}/backend/src/routes/wisetack.ts`),
]
for (const p of CALLERS) {
  const src = read(p)
  if (!src) { fail(`${p} is missing`); continue }
  if (/req: c\.req\b/.test(src)) fail(`${p} hands audit.log the REQUEST — pass the context \`c\`, which is where the user is`)
}

// ── a merge must move references it reads from the database, not from a list in the file ─────────
//
// 33 columns reference contact.id in the base schema alone, under four different names, and each
// vertical has a different set. A hand-written list returns 200 while ON DELETE SET NULL blanks the
// vendor on a bill. (T32 M11)
const merge = read('packages/tenant-backend/src/contacts/mergeContacts.ts')
if (!merge) fail('the contact merge module is missing')
else {
  if (!/FROM pg_constraint c/.test(merge)) fail('the merge must read its reference list from pg_constraint, not a literal')
  if (!/c\.contype = 'f'/.test(merge)) fail('…every foreign key, specifically')
  if (/\['contact_id'|"contact_id"\]/.test(merge)) fail('the merge must not hard-code column names — vendor_id and subcontractor_id also point at contact')
  if (!/i\.indisunique/.test(merge)) fail('…and must handle unique-index collisions (document_share is unique on document_id + contact_id)')
  // Checked on the branch that DOES it, not on the constant's name: a check for `REFUSAL_NAME`
  // passes on a file where the rule has been deleted and only a mention of it survives.
  if (!/if \(isRefusalFlag\(key, keeper\[key\], loser\[key\]\)\)/.test(merge)) fail('an opt-out on either record must survive the merge, or a merge re-subscribes somebody who unsubscribed')
  if (!/if \(loser\[key\] === true && keeper\[key\] !== true\) patch\[key\] = true/.test(merge)) fail("…by carrying the duplicate's refusal onto the survivor")
  // A plain substring, not a regex: the thing being looked for IS a regex literal, and writing it
  // as a pattern means escaping every `?` and `|` in it — which is how the first attempt at this
  // check failed on correct code.
  if (!merge.includes('unsub') || !merge.includes('suppress')) fail('…recognised by name shape, so a vertical adding a new opt-out column is covered the day it is added')
}
const contactsSrc = read('packages/tenant-backend/src/contacts/contacts.ts')
if (contactsSrc) {
  if (!/app\.post\('\/:id\/merge', requirePermission\('contacts:delete'\)/.test(contactsSrc)) fail('the merge route must be gated on contacts:delete — it deletes a contact')
  if (!/db\.transaction/.test(contactsSrc)) fail('…and must run in one transaction, or a half-merge deletes a contact whose records did not move')
}

if (failed) { console.error(`\naudit log readable: ${failed} check(s) FAILED`); process.exit(1) }
console.log('audit log readable: rows are presented in the shape the page reads, with a description composed from what happened')
