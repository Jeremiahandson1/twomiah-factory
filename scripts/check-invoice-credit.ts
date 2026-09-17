// CI guard: a refund and a credit stay two different actions on every shared invoice.
//   refund  returns money     → a negative payment row + amountRefunded; on a part-paid invoice the balance rises
//   credit  forgives money    → lowers the price (the invoice discount), the balance falls, nothing is paid out
// Apply credit is ONE locked core (applyInvoiceCredit) behind POST /api/invoices/:id/credit: capped at what is
// still owed (checked first so the answer names the most allowed), re-totalled through retotalInvoice (tax
// recalculated, never below money collected), recorded on the invoice notes; the invoice page offers it next to
// Refund with a balance preview that mirrors the server, and the refund note points to it. (events T15–T17 B2)
//   bun scripts/check-invoice-credit.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
const core = inv.slice(inv.indexOf('export async function applyInvoiceCredit('), inv.indexOf('let invoiceStatusReconciled'))
if (!core) fail('invoices.ts must define applyInvoiceCredit')
if (!/SELECT \* FROM invoice WHERE id = \$\{id\} AND company_id = \$\{input\.companyId\} FOR UPDATE/.test(core)) fail('applyInvoiceCredit must lock the invoice row, scoped to the company')
for (const [re, what] of [
  [/row\.status === 'void'/, 'refuse a void invoice'],
  [/row\.status === 'refunded'/, 'refuse a refunded sale'],
  [/balanceBefore <= 0\.005/, 'refuse when nothing is owed'],
] as const) if (!re.test(core)) fail(`applyInvoiceCredit must ${what}`)
const capAt = core.indexOf('takesOff(amount) > balanceBefore + 0.005'), retotalAt = core.indexOf('retotalInvoice(')
if (capAt < 0 || retotalAt < 0 || capAt > retotalAt) fail('applyInvoiceCredit must cap the credit at what is owed BEFORE re-totalling')
if (!/round2\(Number\(row\.discount \|\| 0\) \+ amount\)/.test(core)) fail('applyInvoiceCredit must add the credit to the invoice discount (the price reduction the events ledger keeps)')
// no money moves: no payment row, and the invoice write carries no amountPaid / amountRefunded
if (/tx\.insert\(t\.payment\)/.test(core)) fail('applyInvoiceCredit must not write a payment row — a credit moves no money')
const written = core.match(/const set: Record<string, any> = \{([^\n]*)\}/)?.[1]
if (written === undefined) fail('applyInvoiceCredit must build the invoice update as `const set`')
else if (/amountPaid|amountRefunded/.test(written)) fail('applyInvoiceCredit must not change amountPaid / amountRefunded — a credit moves no money')
if (!/Credit \$\$\{amount\.toFixed\(2\)\} applied/.test(core)) fail('applyInvoiceCredit must record the credit on the invoice notes')

const route = inv.slice(inv.indexOf("app.post('/:id/credit'"), inv.indexOf('// ---------------------------------------------------------------- pdf'))
if (!/requirePermission\('invoices:update'\)/.test(route) || !/applyInvoiceCredit\(db, t, \{ invoiceId: id, companyId: currentUser\.companyId/.test(route)) fail('POST /:id/credit must require invoices:update and call applyInvoiceCredit scoped to the company')
if (!/reason: z\.string/.test(route)) fail('POST /:id/credit must require a reason')
if (!/emitToCompany\(currentUser\.companyId, EVENTS\.INVOICE_UPDATED/.test(route)) fail('POST /:id/credit must emit INVOICE_UPDATED (event invoices move their due date on it)')
if (!/applyInvoiceCredit \}/.test(read('packages/tenant-backend/src/index.ts').replace(/\s+/g, ' ').replace(/, /g, ', ')) && !/applyInvoiceCredit/.test(read('packages/tenant-backend/src/index.ts'))) fail('tenant-backend index.ts must export applyInvoiceCredit')

const ui = read('packages/tenant-ui/src/invoicing/ui.tsx')
if (!/export const balanceAfterCredit = /.test(ui)) fail('ui.tsx must export balanceAfterCredit (the modal preview)')
if (!/use Apply credit on the invoice instead/.test(ui)) fail('refundEffectNote must point to Apply credit for lowering what is owed without returning money')
const page = read('packages/tenant-ui/src/invoicing/InvoiceDetailPage.tsx')
if (!/api\.post\(`\/api\/invoices\/\$\{id\}\/credit`/.test(page)) fail('InvoiceDetailPage must apply a credit through POST /api/invoices/:id/credit')
if (!/!closed && balance > 0\.005 && <Button variant="secondary" onClick=\{\(\) => \{ setCreditForm\(/.test(page)) fail('InvoiceDetailPage must offer Apply credit only while something is owed')
if (!/balanceAfterCredit\(invoice, Number\(creditForm\.amount\)\)/.test(page)) fail('the Apply credit modal must preview the balance with balanceAfterCredit')
// the page's own "Credit Balance" (an overpayment) is a different thing from the Apply credit form — never the same name
if (!/const credit = closed \? 0 : Math\.max\(0, netPaid - total\)/.test(page) || /const \[credit, /.test(page)) fail('InvoiceDetailPage: the Apply credit form state must not reuse the name of the Credit Balance amount')

if (failed) { console.error(`\ninvoice credit: ${failed} check(s) FAILED`); process.exit(1) }
console.log('invoice credit: refund returns money, credit lowers the price — one locked credit core, capped at what is owed, recorded, offered on the invoice with a matching preview')
