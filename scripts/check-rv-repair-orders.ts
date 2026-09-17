// CI guard: RV repair orders take a real status and non-negative amounts, reference only the company's own customer,
// unit and technician, and closing one never sends a $0 invoice. (RV T19 M3: a -$50 estimate and status "banana"
// were saved; closing the -$50 RO created a $0.00 invoice marked Sent)
//   bun scripts/check-rv-repair-orders.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const r = read('templates/crm-rv/backend/src/routes/repairOrders.ts')
if (!/export const RO_STATUSES = \['open', 'in_progress', 'waiting_parts', 'ready', 'closed'\] as const/.test(r)) fail('RO_STATUSES must list the shop statuses')
const input = r.slice(r.indexOf('function roInputError('), r.indexOf('async function roRefError('))
if (!/if \(!\(RO_STATUSES as readonly string\[\]\)\.includes\(status\)\) return `Status must be one of/.test(input)) fail('an unknown status must be refused')
if (!/if \(!Number\.isFinite\(n\) \|\| n < 0 \|\| n > MAX_AMOUNT\) return `\$\{label\} must be an amount of 0 or more`/.test(input)) fail('estimated/actual totals must be 0 or more')
if (!/for \(const k of \['laborHours', 'laborCost', 'partsCost'\]\)/.test(input)) fail('service labor/parts amounts must be checked')
const refs = r.slice(r.indexOf('async function roRefError('), r.indexOf('// GET /repair-orders'))
for (const [what, re] of [['customer', /eq\(contact\.id, refs\.customerId\), eq\(contact\.companyId, companyId\)/], ['unit', /eq\(unit\.id, String\(refs\.unitId\)\), eq\(unit\.companyId, companyId\)/], ['technician', /eq\(user\.id, String\(refs\.technicianId\)\), eq\(user\.companyId, companyId\)/]] as [string, RegExp][]) {
  if (!re.test(refs)) fail(`the ${what} must belong to the company`)
}
const post = r.slice(r.indexOf("app.post('/', requirePermission('contacts:create')"), r.indexOf("app.put('/:id'"))
if (!/const inputError = roInputError\(body, true\)/.test(post) || !/const refError = await roRefError\(/.test(post) || post.indexOf('roRefError(') > post.indexOf('db.insert(repairOrder)')) fail('create must validate input and references before inserting')
const put = r.slice(r.indexOf("app.put('/:id'"), r.indexOf("app.post('/:id/check-in'"))
if (!/const inputError = roInputError\(body, false\)/.test(put) || !/const refError = await roRefError\(/.test(put) || put.indexOf('roRefError(') > put.indexOf('db.update(repairOrder)')) fail('edit must validate input and references before updating')
if (!/if \(totals\.total > 0\) try \{/.test(put)) fail('closing an RO must not create an invoice when there is nothing to collect')

if (!/alert\(\(err as Error\)\?\.message \|\| 'Failed to update status'\)/.test(read('templates/crm-rv/frontend/src/pages/rv/ServicePage.tsx'))) fail("the Service page must show the server's reason when a status change is refused")

if (failed) { console.error(`\nrv repair orders: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv repair orders: real statuses, non-negative amounts, company-owned references, no $0 invoices')
