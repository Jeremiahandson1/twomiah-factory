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
/**
 * WHOSE END OF DAY. 78df7bb67 put the day's end on the COMPANY's clock: isOverdue (and quotePastExpiry) now ask the one
 * helper dayIsOver(), which ends a marker's day at the company's midnight when the zone is known (zoneDay.ts
 * markerDayIsOver — the end of storeDayRange) and at UTC's 23:59:59.999 otherwise, as before. UTC's midnight is 7pm in
 * Chicago, so the zone is the fix, not a loosening. The property — the whole due day is the customer's — is read
 * through that chain: isOverdue → dayIsOver → (markerDayIsOver | the UTC end of day).
 */
const dayIsOver = money.match(/function dayIsOver\([\s\S]*?\n\}/)?.[0] || ''
const zoneDay = read('packages/tenant-backend/src/time/zoneDay.ts')
const endOfDayInline = /23, 59, 59, 999/.test(overdue)
const endOfDayShared = /return dayIsOver\(inv\.dueDate, Date\.now\(\), timeZone\)/.test(overdue)
  && /if \(timeZone\) return markerDayIsOver\(d, timeZone, now\)/.test(dayIsOver)
  && /return Date\.UTC\(d\.getUTCFullYear\(\), d\.getUTCMonth\(\), d\.getUTCDate\(\), 23, 59, 59, 999\) < now/.test(dayIsOver)
  && /export function markerDayIsOver\([^\n]*\): boolean \{(?:(?!\n\})[\s\S])*?return storeDayRange\(tz, day\)\.end\.getTime\(\) <= now/.test(zoneDay)
if (!endOfDayInline && !endOfDayShared) fail('…it must wait for the END of the due day')

// every path that raises an invoice
const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/const dueDate = startOfUtcDay\(v\.dueDate\)/.test(inv) || !/const issueDate = startOfUtcDay\(v\.issueDate\)/.test(inv)) {
  fail('insertInvoice must normalise both dates — it is the one write path every vertical raises invoices through')
}
// A defaulted issue date must still be a DAY (midnight-normalised, never the instant the invoice was
// raised) — and it must be the BUSINESS's day, not the server's. businessToday() returns a UTC-midnight
// Date for the tenant's calendar date, so it satisfies the original rule and fixes the half the rule
// never covered: Render runs UTC, so `startOfUtcDay(new Date())` stamped an invoice raised at 19:00
// Central with tomorrow, and carried that day into the due date. (Salon T27 H1)
if (!/const today = businessToday\(/.test(inv)) fail("a defaulted issue date must come from the business's calendar day (businessToday), not the server's")
if (!/const issueDate = issue\.value \?\? today/.test(inv)) fail('a defaulted issue date must be a day too')
if (!/const dueDate = due\.value \?\? dueDateFromTerms\(settings, today\)/.test(inv)) fail('payment terms must be counted from that same business day, or the due date slides with it')
// The cut-off is the start of TODAY on the same clock isOverdue ends the day on — the company's when the caller passes
// its zone (78df7bb67), UTC's when it does not. Both the list filter and Reports pass the company's zone.
if (!/export function overdueCutoff\(now: Date = new Date\(\), timeZone\?: string \| null\): Date \{\n\s*return businessToday\(timeZone, now\)\n\}/.test(money)
  && !/export function overdueCutoff\(now: Date = new Date\(\)\): Date \{\n\s*return startOfUtcDay\(now\)/.test(money)) fail('the shared cut-off must be the start of today, on the clock isOverdue uses')
if (!/const now = overdueCutoff\(\)/.test(inv) && !/const tz = await zoneOf\(currentUser\.companyId\)\n\s*const now = overdueCutoff\(new Date\(\), tz\)/.test(inv)) fail('the invoice list filter must use the shared cut-off')
const reporting = read('packages/tenant-backend/src/reporting/reporting.ts')
if (!/lt\(t\.invoice\.dueDate, overdueCutoff\(\)\)/.test(reporting) && !/lt\(t\.invoice\.dueDate, overdueCutoff\(new Date\(\), await companyTimeZone\(db, companyId\)\)\)/.test(reporting)) fail('Reports must use it as well, or it disagrees with the page it links to')

// reachable from a template
if (!/startOfUtcDay, overdueCutoff/.test(read('packages/tenant-backend/src/index.ts'))) fail('both helpers must be exported from the shared barrel')

if (failed) { console.error(`\ncalendar-day dates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('calendar-day dates: due/issue/expiry are stored as days, and an invoice is overdue only once its day is over')
