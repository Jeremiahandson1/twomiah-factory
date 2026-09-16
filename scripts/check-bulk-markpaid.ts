// CI guard: bulk "mark paid" records money the one way money is recorded — recordInvoicePayment
// (locked, refund-aware, a payment row per invoice) — instead of setting amountPaid = total with no
// ledger row (invisible to Reports, wrong on a refunded deposit). (#159)
//   bun scripts/check-bulk-markpaid.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const bulk = read('packages/tenant-backend/src/bulk/bulk.ts')
if (!/import \{ recordInvoicePayment \} from '\.\.\/invoicing\/invoices'/.test(bulk)) fail('bulk.ts must import recordInvoicePayment from the invoicing core')
if (!/import \{ invoiceBalance \} from '\.\.\/invoicing\/money'/.test(bulk)) fail('bulk.ts must import invoiceBalance (the refund-aware balance)')
if (!/payment: any/.test(bulk) || !/tables: \{ contact, project, job, invoice, quote, timeEntry, payment \}/.test(bulk)) fail('BulkTables must carry the payment table')

const a = bulk.indexOf('async function bulkMarkInvoicesPaid('); const b = bulk.indexOf('async function bulkUpdateQuotes(')
const fn = a < 0 || b < 0 ? '' : bulk.slice(a, b)
if (!fn) fail('bulkMarkInvoicesPaid not found')
if (!/const amount = invoiceBalance\(inv\)/.test(fn)) fail('bulkMarkInvoicesPaid must record what is still owed (invoiceBalance)')
if (!/recordInvoicePayment\(db, \{ invoice, payment \}, false, \{/.test(fn)) fail('bulkMarkInvoicesPaid must record through recordInvoicePayment')
if (!/invoiceId: inv\.id, companyId, amount/.test(fn)) fail('bulkMarkInvoicesPaid must scope the write to the company')
if (/amountPaid: inv\.total/.test(fn) || /status: 'paid'/.test(fn) || /db\.update\(invoice\)/.test(fn)) fail('bulkMarkInvoicesPaid must not set amountPaid/status itself any more')
if (!/if \(!outcome\.ok\)/.test(fn) || !/if \(amount <= 0\.005\) continue/.test(fn)) fail('bulkMarkInvoicesPaid must skip (and not count) an invoice that owes nothing or is refused by the core')

if (failed) { console.error(`\nbulk mark-paid: ${failed} check(s) FAILED`); process.exit(1) }
console.log('bulk mark-paid: records the balance owed through the shared locked payment core, one payment row per invoice')
