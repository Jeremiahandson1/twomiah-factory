// CI guard: an invoice's due date must be validated against its ISSUE date, not against today, on both
// create and update. The old guard compared due < today (with a "before the issue date" message) and
// silently stamped the issue date to today, so it rejected a legitimately overdue/backdated invoice and
// accepted a genuinely backwards one; PUT skipped the check entirely (RV due-date high).
//   bun scripts/check-invoice-datewindow.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-backend/src/invoicing/invoices.ts', import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// Issue date must be settable so history can be backdated.
if (!/issueDate:\s*z\.string\(\)\.optional\(\)/.test(src)) fail('invoiceSchema must accept an optional issueDate (so backdated/migrated invoices can be entered)')
// The create must set issueDate on the insert.
if (!/dueDate,\s*issueDate,/.test(src)) fail('the create insert must persist issueDate')
// Create + update must reject due < issue (two comparisons: dueDate<issueDate and effDue<effIssue).
if (!/dueDate\s*<\s*issueDate/.test(src)) fail('create must reject a due date before the issue date (dueDate < issueDate)')
if (!/effDue\s*<\s*effIssue/.test(src)) fail('update must reject a due date before the issue date (PUT once skipped the guard)')
// The old today-based guard must be gone.
if (/rejectPastDueOnCreate/.test(src)) fail('the today-based rejectPastDueOnCreate guard must be removed (it wrongly rejected overdue/backdated invoices)')

if (failed) { console.error(`\ninvoice date window: ${failed} check(s) FAILED`); process.exit(1) }
console.log('invoice date window: due date is validated against the issue date on create + update; issue date is settable')
