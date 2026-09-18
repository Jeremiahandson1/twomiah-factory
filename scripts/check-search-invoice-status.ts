// CI guard: global search must DERIVE an invoice's status, like every other surface. "Overdue" is computed
// at read time — billed, not fully paid, past its due date — and never stored, so a renderer that prints the
// status column disagrees with the list, the stats, the dashboard, Reports and the customer portal. Search
// was the last one doing it: an invoice everything else called overdue came back "$250 - sent"
// (contractor T14 H10, open since 12 September). Seven templates carry the same block.
//   bun scripts/check-search-invoice-status.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// crm-dispensary has no invoice block in search; crm-homecare and crm-automotive are parked.
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']

for (const t of TEMPLATES) {
  const p = `templates/${t}/backend/src/services/search.ts`
  const src = read(p)
  if (!src) { fail(`${p} is missing`); continue }
  const block = src.match(/\/\/ Invoices[\s\S]*?\n  \}/)?.[0] || ''
  if (!block) { fail(`${t}: the invoice search block is missing`); continue }

  if (/subtype: item\.status/.test(block)) fail(`${t}: search prints the STORED invoice status — an overdue invoice reads "sent"`)
  if (/- \$\{item\.status\}/.test(block)) fail(`${t}: …and so does its description`)
  if (!/subtype: deriveStatus\(item\)/.test(block)) fail(`${t}: the result chip must use deriveStatus(item)`)
  if (!/\$\{deriveStatus\(item\)\}/.test(block)) fail(`${t}: …and so must the description`)
  // deriveStatus needs the money and the date, not just the status column
  for (const col of ['dueDate: invoice.dueDate', 'amountPaid: invoice.amountPaid', 'amountRefunded: invoice.amountRefunded']) {
    if (!block.includes(col)) fail(`${t}: the query must select ${col.split(':')[0]} — deriveStatus cannot work without it`)
  }
  if (!/import \{ deriveStatus \} from '\.\.\/shared\/index\.ts'/.test(src)) fail(`${t}: deriveStatus must come from the shared money rules, not a local copy`)
}

// the rule itself stays where every surface reads it from
const money = read('packages/tenant-backend/src/invoicing/money.ts')
if (!/export function isOverdue\(/.test(money)) fail('isOverdue must remain the one definition of overdue')
if (!/export const deriveStatus =/.test(money)) fail('…and deriveStatus the one way to ask for it')
if (!/export \{ round2, calcTotals, isOverdue, deriveStatus/.test(read('packages/tenant-backend/src/index.ts'))) {
  fail('…exported from the shared barrel, or a template cannot use it')
}

if (failed) { console.error(`\nsearch invoice status: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`search invoice status: an overdue invoice reads overdue in search too, in ${TEMPLATES.length} CRMs`)
