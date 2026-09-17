// CI guard: RV sales leads have a real stage, company-owned references and no open duplicates. Create and edit run
// leadRefusal inside the transaction before any write: stage ∈ the pipeline stages; contact / unit / salesperson
// scoped to the company; a contact can't hold two open leads on the same unit (or with no unit), under a per-contact
// lock. (RV T19 M2: stage "banana" saved, duplicate leads; found with #177: another company's unit accepted)
//   bun scripts/check-rv-lead-rules.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const r = readFileSync(join(ROOT, 'templates/crm-rv/backend/src/routes/salesLeads.ts'), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

if (!/export const LEAD_STAGES = \['new', 'contacted', 'demo', 'desking', 'closed_won', 'closed_lost'\] as const/.test(r)) fail('LEAD_STAGES must list the pipeline stages')
const fn = r.slice(r.indexOf('async function leadRefusal('), r.indexOf("// POST /sales-leads\r\n") > 0 ? r.indexOf("// POST /sales-leads\r\n") : r.indexOf('// POST /sales-leads\n'))
if (!fn) fail('leadRefusal must exist')
if (!/if \(!\(LEAD_STAGES as readonly string\[\]\)\.includes\(next\.stage as string\)\) return \{ status: 400/.test(fn)) fail('an unknown stage must be refused (400)')
if (!/pg_advisory_xact_lock\(hashtext\(\$\{`lead:\$\{companyId\}:\$\{next\.contactId\}`\}\)\)/.test(fn)) fail('the checks must run under a per-contact lock')
for (const [what, re] of [['contact', /eq\(contact\.id, next\.contactId\), eq\(contact\.companyId, companyId\)/], ['unit', /eq\(unit\.id, next\.unitId\), eq\(unit\.companyId, companyId\)/], ['salesperson', /eq\(user\.id, String\(next\.assignedTo\)\), eq\(user\.companyId, companyId\)/]] as [string, RegExp][]) {
  if (!re.test(fn)) fail(`the lead's ${what} must belong to the company`)
}
if (!/if \(dupe\) return \{ status: 409/.test(fn) || !/next\.unitId \? eq\(salesLead\.unitId, next\.unitId\) : sql`\$\{salesLead\.unitId\} is null`/.test(fn)) fail('an open duplicate (same contact + same unit, or both no unit) must be refused (409)')

const post = r.slice(r.indexOf("app.post('/', requirePermission('contacts:create')"), r.indexOf("app.put('/:id', requirePermission('contacts:update')"))
if (!/const invalid = await leadRefusal\(tx, currentUser\.companyId, \{ contactId: body\.contactId, unitId, assignedTo: body\.assignedTo, stage \}, \{ refs: true, duplicate: true \}, null\)/.test(post)) fail('create must run leadRefusal with refs + duplicate checks')
if (post.indexOf('leadRefusal(') > post.indexOf('tx.insert(salesLead)')) fail('create must check before inserting')
const put = r.slice(r.indexOf("app.put('/:id', requirePermission('contacts:update')"), r.indexOf('// ---- Desked deal'))
if (!/const invalid = await leadRefusal\(tx, currentUser\.companyId, \{ contactId: nextContactId, unitId: nextUnitId, assignedTo: nextAssignedTo, stage: nextStage \}/.test(put)) fail('edit must run leadRefusal on the next values')
if (put.indexOf('leadRefusal(') > put.indexOf('tx.update(salesLead)')) fail('edit must check before updating')
if (!/if \('unitId' in body\) updates\.unitId = nextUnitId/.test(put)) fail('an empty unit value must clear the link rather than write ""')

if (failed) { console.error(`\nrv lead rules: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv lead rules: stages are real, references are company-owned, and open duplicates are refused under a contact lock')
