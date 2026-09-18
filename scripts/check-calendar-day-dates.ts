// CI guard: a due date, an issue date and a quote expiry are CALENDAR DAYS, not instants.
//
// They were stored two different ways — 43 of 58 invoices on one tenant carried the time of day they
// happened to be created at, 15 were clean midnights — so two invoices raised the same way differed, and
// "overdue" tripped at whatever moment was stamped rather than when the day ran out. The screens have always
// waited for the day to end (isPastDay), so the backend and the frontend disagreed by up to a day.
// (Contractor T14 M17)
//
// Normalising in insertInvoice as well as the route is what makes it true everywhere: snow billing,
// agreements, wellness plans, a billed visit and an event deposit all raise invoices through it.
//   bun scripts/check-calendar-day-dates.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const money = read('packages/tenant-backend/src/invoicing/money.ts')
if (!money) fail('packages/tenant-backend/src/invoicing/money.ts is missing')
if (!/export function startOfUtcDay\(d: Date\): Date/.test(money)) fail('there must be one way to say "the day this belongs to"')
if (!/Date\.UTC\(d\.getUTCFullYear\(\), d\.getUTCMonth\(\), d\.getUTCDate\(\)\)/.test(money)) fail('…and it must be the UTC day, or the day drifts with the server')
if (!/export function overdueCutoff\(/.test(money)) fail('a SQL query needs the same rule as isOverdue')

// stored as a day
if (!/return startOfUtcDay\(new Date\(from\.getTime\(\) \+ paymentTermsDaysFrom\(settings\) \* 86400000\)\)/.test(money)) {
  fail('a due date from payment terms must land on a day boundary — it used to carry the time of day')
}
if (!/return \{ value: startOfUtcDay\(d\) \}/.test(money)) {
  fail('a date coming from a form must be stored as its day, so a picker and a full timestamp agree')
}

// the customer gets the whole day
const overdue = money.match(/export function isOverdue[\s\S]*?\n\}/)?.[0] || ''
if (!overdue) fail('isOverdue is missing')
if (/return new Date\(inv\.dueDate as any\) < new Date\(\)/.test(overdue)) fail('isOverdue compares the stored instant — an invoice goes overdue part-way through its due day')
if (!/23, 59, 59, 999/.test(overdue)) fail('…it must wait for the END of the due day')

// every path that raises an invoice
const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/const dueDate = startOfUtcDay\(v\.dueDate\)/.test(inv) || !/const issueDate = startOfUtcDay\(v\.issueDate\)/.test(inv)) {
  fail('insertInvoice must normalise both dates — it is the one write path every vertical raises invoices through')
}
if (!/const issueDate = issue\.value \?\? startOfUtcDay\(new Date\(\)\)/.test(inv)) fail('a defaulted issue date must be a day too')
if (!/const now = overdueCutoff\(\)/.test(inv)) fail('the invoice list filter must use the shared cut-off')
const reporting = read('packages/tenant-backend/src/reporting/reporting.ts')
if (!/lt\(t\.invoice\.dueDate, overdueCutoff\(\)\)/.test(reporting)) fail('Reports must use it as well, or it disagrees with the page it links to')

// reachable from a template
if (!/startOfUtcDay, overdueCutoff/.test(read('packages/tenant-backend/src/index.ts'))) fail('both helpers must be exported from the shared barrel')

if (failed) { console.error(`\ncalendar-day dates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('calendar-day dates: due/issue/expiry are stored as days, and an invoice is overdue only once its day is over')
