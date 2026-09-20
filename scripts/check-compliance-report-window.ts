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
//
// The helper was `endOfDayIfDateOnly`, widening a date-only end to 23:59:59.999Z. T27 H2 folded it
// into `reportRange`, which widens to the end of that day on the STORE's clock instead — the report
// already grouped rows by the store's day, so the old server-day window disagreed with its own
// grouping. The rule here is unchanged and is about the WINDOW, not the spelling: a date-only end
// covers the whole of that day, from one place, and a real timestamp still means that instant.
// Which clock it uses, and that the bound is half-open, belong to check-store-day-ranges.ts.
if (!/const reportRange = \(start: string, end: string, tz: string\): \{ start: Date; end: Date \} =>/.test(src)) fail('a date-only end of range must be widened to the end of that day, in one place')
if (!/end: DATE_ONLY\.test\(end\) \? storeDayRange\(tz, end\)\.end :/.test(src)) fail('…to the end of that day, read on the clock the report groups by')
if (!/: new Date\(new Date\(end\)\.getTime\(\) \+ 1\)/.test(src)) fail('…while a caller that sends a real timestamp still means that instant (nudged a millisecond so the half-open bound keeps the old inclusive meaning)')
if (!/const \{ start: startDate, end: endDate \} = reportRange\(data\.startDate, data\.endDate, tzDay\)/.test(src)) fail('the report generator must use it')
if (/const endDate = new Date\(data\.endDate\)/.test(src)) fail('…and must not go back to the raw midnight parse, which drops the last day from every query below it')

// 2 — a refunded sale is still a sale
// The definition moved to utils/revenue.ts, shared with analytics and the dashboard, when those three
// surfaces were reconciled (T21 H8). What this guard cares about is that the report USES it.
// Matched on the symbol, not the whole import list — the list grew when tax got its own stated row set
// beside this one (T23 H1), and pinning the exact text failed a change that kept the rule perfectly.
if (!/import \{[^}]*\bsettledSale\b[^}]*\} from '\.\.\/utils\/revenue\.ts'/.test(src)) fail('the report must take the settled-sale definition from utils/revenue.ts')
const daily = src.slice(src.indexOf("case 'daily_sales'"), src.indexOf("case 'inventory_snapshot'"))
if (!daily) fail('the daily_sales report is missing')
if (/AND o\.status = 'completed'/.test(daily)) fail("daily_sales must not count only status = 'completed' — every refunded sale disappears from the report a regulator reads as what you sold")
if (!/AND o\.status IN \$\{settledSale\}/.test(daily)) fail('daily_sales must count every settled sale')
if (!/as total_refunded/.test(daily)) fail('…and REPORT what was given back, rather than deducting it by omission')
// the comma matters: "as net_revenue" is a prefix of "as net_revenue_anything"
if (!/as net_revenue,/.test(daily)) fail('…with a net figure alongside the gross')

if (failed) { console.error(`\ncompliance report window: ${failed} check(s) FAILED`); process.exit(1) }
console.log('compliance report window: the last day is in the window; a refunded sale still counts as a sale, with the refund reported beside it')
