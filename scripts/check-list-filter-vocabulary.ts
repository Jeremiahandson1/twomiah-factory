// CI guard: a list filter naming a value outside the vocabulary is refused, not answered with an empty list.
// On the live contractor tenant ?status=banana returned 0 invoices of 78, 0 jobs of 90 and 0 quotes of 27 — each
// indistinguishable from a company with nothing on its books. The house style already existed (the lead inbox
// refuses an unknown status; the marketing audience refuses an unknown audience and names what it accepts,
// T21 M4) and is now followed by every list whose field has a vocabulary. (Contractor T29 N2)
//
// The vocabulary must be the SAME list that governs writes — never a second copy that can drift from it. A field
// that is free text on the way in (a document's `type`) has no vocabulary, so an empty result there is the true
// answer and must not be refused.
//   bun scripts/check-list-filter-vocabulary.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// one helper, one answer shape
const helper = read('packages/tenant-backend/src/listFilter.ts')
if (!helper) fail('packages/tenant-backend/src/listFilter.ts is missing — the refusal must have one implementation')
if (!/export function checkFilter\(c: any, field: string, value: string \| undefined \| null, accepted: readonly string\[\]\)/.test(helper)) fail('checkFilter must take the field, the value and the accepted vocabulary')
if (!/code: 'INVALID_FILTER'/.test(helper)) fail('the refusal must carry one code every caller can recognise')
if (!/\n\s*400,\n\s*\)/.test(helper) && !/\}, 400\)/.test(helper)) fail('the refusal must be a 400')
if (!/Choose one of: \$\{accepted\.join\(', '\)\}/.test(helper)) fail('the refusal must NAME the values it accepts — that is the half that makes it useful')
if (!/accepted: \[\.\.\.accepted\]/.test(helper)) fail('…and hand them back as data too, so a caller can offer them')
if (!/if \(!filterGiven\(value\)\) return null/.test(helper)) fail('no filter, or an empty one, must stay "no filter" — the picker\'s first option sends it')
if (!/export \{ checkFilter, invalidFilter, filterGiven \} from '\.\/listFilter'/.test(read('packages/tenant-backend/src/index.ts'))) fail('the shared index must export the helper')

// every list whose filter has a vocabulary uses it, against the vocabulary the write side uses
const SITES: Array<[string, string, string, string]> = [
  ['packages/tenant-backend/src/jobs/jobs.ts', 'status', 'q.status', 'JOB_STATUSES'],
  ['packages/tenant-backend/src/invoicing/quotes.ts', 'status', 'status', 'QUOTE_STATUSES'],
  ['packages/tenant-backend/src/invoicing/invoices.ts', 'status', 'status', 'statusFilters'],
  ['packages/tenant-backend/src/contacts/contacts.ts', 'type', 'type', 'types'],
  ['packages/tenant-backend/src/expenses/expenses.ts', 'category', 'q.category', 'categories'],
]
for (const [file, field, value, vocabulary] of SITES) {
  const src = read(file)
  if (!src) { fail(`${file} is missing`); continue }
  if (!new RegExp(`import \\{ checkFilter \\} from '\\.\\.\\/listFilter'`).test(src)) fail(`${file} does not use the shared refusal`)
  if (!new RegExp(`checkFilter\\(c, '${field}', ${value.replace('.', '\\.')}, ${vocabulary}\\)`).test(src)) fail(`${file} must check its ${field} filter against ${vocabulary} — the same list that governs writes`)
  if (!new RegExp(`if \\(bad[A-Za-z]*\\) return bad[A-Za-z]*`).test(src)) fail(`${file} checks the filter but does not return the refusal`)
}
// the invoice vocabulary is built from this template's own open statuses, not a second hard-coded list
const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/const statusFilters = \[\.\.\.new Set\(\[\.\.\.openStatuses, 'draft', 'paid', 'refunded', 'void', 'overdue'\]\)\]/.test(inv)) fail("the invoice filter vocabulary must extend this template's open statuses, and include the derived 'overdue'")
// contacts must use the per-vertical list (the RV dealership says 'customer' where the others say 'client')
if (!/const types = \(o\.types && o\.types\.length \? o\.types : DEFAULT_CONTACT_TYPES\)/.test(read('packages/tenant-backend/src/contacts/contacts.ts'))) fail('contacts must keep one per-vertical type vocabulary for both writes and the filter')

// a free-text field has no vocabulary to be outside of
const docs = read('packages/tenant-backend/src/files/documents.ts')
if (/checkFilter\(c, 'type'/.test(docs)) fail("a document's type is free text on the way in — refusing it as a filter would refuse a true answer")

if (failed) { console.error(`\nlist filter vocabulary: ${failed} check(s) FAILED`); process.exit(1) }
console.log('list filter vocabulary: an unknown status / type / category is refused by name, not answered with an empty list; free-text fields are left alone')
