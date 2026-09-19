// CI guard: a compliance report covers the days it says it covers, and counts the sales that happened.
//
// Two ways the dispensary's sales report misreported, both silent (Dispensary T20 B3):
//
//   1. Every query compares `<= endDate`, and a date-only "2026-09-19" parses to MIDNIGHT — so a
//      1–19 September report contained nothing at all from the 19th. No error, no gap, just a missing day.
//   2. daily_sales alone asked for status = 'completed'. A sale that was later refunded still happened, and
//      the tax, patient-count and diversion reports in the same file already knew that; only the one report
//      a regulator reads as "what did you sell" dropped them.
//
// A report that is quietly short is worse than one that fails: nobody goes looking for a day that isn't there.
//   bun scripts/check-compliance-report-window.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const file = 'templates/crm-dispensary/backend/src/routes/compliance.ts'
const src = read(file)
if (!src) fail(`${file} is missing`)

// 1 — the window includes its last day
if (!/const endOfDayIfDateOnly = \(v: string\): Date =>/.test(src)) fail('a date-only end of range must be widened to the end of that day, in one place')
if (!/if \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(v\)\) return new Date\(`\$\{v\}T23:59:59\.999Z`\)/.test(src)) fail('…to 23:59:59.999 of that day')
if (!/return new Date\(v\)/.test(src)) fail('…while a caller that sends a real timestamp still means that instant')
if (!/const endDate = endOfDayIfDateOnly\(data\.endDate\)/.test(src)) fail('the report generator must use it')
if (/const endDate = new Date\(data\.endDate\)/.test(src)) fail('…and must not go back to the raw midnight parse, which drops the last day from every query below it')

// 2 — a refunded sale is still a sale
if (!/const settledSale = sql`\('completed', 'partially_refunded', 'refunded'\)`/.test(src)) fail('there must be one definition of a SETTLED sale')
const daily = src.slice(src.indexOf("case 'daily_sales'"), src.indexOf("case 'inventory_snapshot'"))
if (!daily) fail('the daily_sales report is missing')
if (/AND o\.status = 'completed'/.test(daily)) fail("daily_sales must not count only status = 'completed' — every refunded sale disappears from the report a regulator reads as what you sold")
if (!/AND o\.status IN \$\{settledSale\}/.test(daily)) fail('daily_sales must count every settled sale')
if (!/as total_refunded/.test(daily)) fail('…and REPORT what was given back, rather than deducting it by omission')
// the comma matters: "as net_revenue" is a prefix of "as net_revenue_anything"
if (!/as net_revenue,/.test(daily)) fail('…with a net figure alongside the gross')

if (failed) { console.error(`\ncompliance report window: ${failed} check(s) FAILED`); process.exit(1) }
console.log('compliance report window: the last day is in the window; a refunded sale still counts as a sale, with the refund reported beside it')
