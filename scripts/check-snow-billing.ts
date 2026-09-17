// CI guard: landscaping snow visits can be billed. POST /api/snow/contracts/:id/bill puts the unbilled visits with a
// charge on one draft invoice (shared insertInvoice, the CRM's invoice numbering, default tax and payment terms) to the
// contract's or site's customer, under a row lock so a visit is never invoiced twice; the page has the Bill button.
// (Landscaping T14 H5: "unbilled · 1 event · $175" with no way to bill it)
//   bun scripts/check-snow-billing.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const r = read('templates/crm-landscaping/backend/src/routes/snowBilling.ts')
const inv = read('templates/crm-landscaping/backend/src/routes/invoices.ts')
const i = r.indexOf("app.post('/contracts/:id/bill'")
const bill = i < 0 ? '' : r.slice(i, r.indexOf('\n})\n', i))
if (!bill) fail('POST /contracts/:id/bill is missing')
else {
  if (!/requirePermission\('invoices:create'\)/.test(bill)) fail('billing needs invoices:create')
  if (!/eq\(snowContract\.id, id\), eq\(snowContract\.companyId, cid\)/.test(bill) || !/'Contract not found' \}, 404\)/.test(bill)) fail("billing must 404 on another company's contract")
  if (!/const contactId = row\.contract\.contactId \|\| row\.siteContactId/.test(bill)) fail("the invoice goes to the contract's customer, else the site's")
  if (!/isNull\(snowEvent\.invoiceId\)\)\)\s*\.orderBy\(asc\(snowEvent\.servicedAt\)\)\.for\('update'\)/.test(bill)) fail('unbilled visits must be locked (FOR UPDATE) while billing')
  if (!/await insertInvoice\(tx, \{ invoice, invoiceLineItem \} as any, INVOICE_NUMBERING,/.test(bill)) fail('the invoice must be written by the shared insertInvoice inside the transaction')
  if (!/dueDate: dueDateFromTerms\(settings\), issueDate: new Date\(\), taxRate: defaultTaxRateFrom\(settings\)/.test(bill)) fail("the invoice must use the company's payment terms and default tax")
  if (!/await tx\.update\(snowEvent\)\.set\(\{ invoiceId: created\.id \}\)/.test(bill)) fail('billed visits must be linked to the invoice in the same transaction')
  if (!/Number\(e\.billableAmount\) > 0/.test(bill)) fail('only visits with a charge go on the invoice')
}
// numbering must match this CRM's invoices: routes/invoices.ts sets no numbering (shared default INV-00001)
if (/numbering/.test(inv)) { if (!inv.includes("numbering: { prefix: 'INV', pad: 5, seed: 0 }")) fail('snow billing numbering no longer matches routes/invoices.ts numbering') }
if (!/const INVOICE_NUMBERING = \{ prefix: 'INV', pad: 5, seed: 0 \}/.test(r)) fail('snow billing must number invoices like the shared default (INV, pad 5)')
const page = read('templates/crm-landscaping/frontend/src/pages/landscaping/SnowBillingPage.tsx')
if (!/api\.post\(`\/api\/snow\/contracts\/\$\{ct\.id\}\/bill`, \{\}\)/.test(page) || !/Number\(sm\.unbilledTotal \|\| 0\) > 0 &&/.test(page)) fail('the Snow Billing page must offer Bill for a contract with unbilled charges')
if (failed) { console.error(`\nsnow billing: ${failed} check(s) FAILED`); process.exit(1) }
console.log('snow billing: unbilled visits bill to one locked, numbered, taxed draft invoice; the page has the Bill button')
