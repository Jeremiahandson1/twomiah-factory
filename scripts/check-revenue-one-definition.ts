// CI guard: "revenue" means ONE thing on this product, and the surfaces that report it share the definition.
//
// Three screens answered the same question three ways on the same day — compliance $3,395, analytics $2,825,
// dashboard $2,395 — and all three were labelled revenue. The disagreement was never arithmetic: it was three
// row sets and two measures, none of them written down anywhere. (Dispensary T21 H8)
//
//   SETTLED  completed, partially_refunded, refunded — a sale that was later refunded still happened
//   gross    SUM(total) over settled          — what you sold, which is what a regulator asks
//   refunded SUM(refunded_amount) over settled — reported, never applied by omission
//   net      gross − refunded                  — what the business kept
//
// A fully refunded sale adds its total to gross and the same to refunded, so it adds exactly ZERO to net.
// That is what lets every surface share one row set.
//   bun scripts/check-revenue-one-definition.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const R = 'templates/crm-dispensary/backend/src/'

const rev = read(R + 'utils/revenue.ts')
if (!rev) fail('utils/revenue.ts is missing — the definition must have one home')
if (!/export const SETTLED_SALE_STATUSES = \['completed', 'partially_refunded', 'refunded'\] as const/.test(rev)) fail('the settled statuses must be stated once')
if (!/export const settledSale = sql`\('completed', 'partially_refunded', 'refunded'\)`/.test(rev)) fail('…with one SQL form for the surfaces that use raw SQL')
// Net is gross minus what went back, FLOORED AT ZERO per sale. The floor is part of the definition,
// not an optional nicety: without it a single row refunded beyond its own total drags a whole day
// negative, and the analytics series showed 13 September at −$50 with an average order value of
// −$16.67. A sale cannot have earned negative money; refunds are reported separately, so the clamp
// hides nothing. (Dispensary T29 L3)
if (!/export const netExprBare = sql`GREATEST\(0, COALESCE\(total::numeric, 0\) - COALESCE\(NULLIF\(refunded_amount, ''\)::numeric, 0\)\)`/.test(rev)) fail('net must be gross minus what went back, floored at zero, written once')
if (!/export const netExpr = sql`GREATEST\(0, /.test(rev)) fail('the aliased net expression must carry the same floor as the bare one')

// every surface uses it — and none of them keeps its own copy of the rule
for (const [file, label] of [['routes/compliance.ts', 'the compliance report'], ['routes/analytics.ts', 'analytics'], ['routes/dashboard.ts', 'the dashboard']] as Array<[string, string]>) {
  let src = read(R + file)
  if (!src) { fail(`${file} is missing`); continue }
  // The TAX report keeps its own narrower set ON PURPOSE — it nets a fully refunded sale out of what is
  // owed, and what tax you owe is a different question from what you sold. Exempt it by name, so the rule
  // below still bites everywhere else.
  if (file === 'routes/compliance.ts') src = src.replace(/case 'tax':[\s\S]*?(?=\n    case '|\n  \}\n)/, '')
  if (!/from '\.\.\/utils\/revenue\.ts'/.test(src)) fail(`${label} must take the definition from utils/revenue.ts`)
  if (/status IN \('completed', 'partially_refunded'\)/.test(src)) fail(`${label} drops fully refunded sales — that is one of the three answers this fixes`)
  if (/const settledSale = sql`/.test(src)) fail(`${label} keeps its own copy of the settled set`)
}
const dash = read(R + 'routes/dashboard.ts')
if (/SUM\(CASE WHEN status = 'completed' THEN total::numeric ELSE 0 END\), 0\) as revenue/.test(dash)) fail('the dashboard must not report GROSS of completed-only as "revenue"')
if (!/as refunded/.test(dash)) fail('…and must say what went back beside what was kept')
if (!/refunded: Number\(todayOrders\.refunded \|\| 0\)/.test(dash)) fail('…including in the response the tile actually reads')

// The same rule for the people behind the sales. Unique Customers counted status='completed' only, so
// refunding anything erased that customer: four people bought on the live tenant and the tile read 1,
// because three of their orders had been refunded. A customer who returns something still walked in. (T21 M12)
const cust = read(R + 'routes/analytics.ts')
const custStart = cust.indexOf("app.get('/customers'")
// to the end of THIS handler, so the checks below cannot be satisfied by a neighbouring endpoint
const custRest = custStart >= 0 ? cust.slice(custStart + 20) : ''
const custEnd = custRest.indexOf('\napp.get(')
const customersBlock = custStart < 0 ? '' : cust.slice(custStart, custEnd >= 0 ? custStart + 20 + custEnd : undefined)
if (!customersBlock) fail('the customer insights endpoint is missing')
if (/AND status = 'completed'/.test(customersBlock)) fail('customer insights must not count completed-only — a refund drops the customer out of Unique Customers entirely')
if ((customersBlock.match(/AND status IN \$\{settledSale\}/g) || []).length < 3) fail('…every cohort in it (in-range, first-ever, first-order) must run over settled sales')
if (!/SELECT contact_id, SUM\(\$\{netExprBare\}\) AS spend/.test(customersBlock)) fail('…and lifetime value must be NET of refunds, on the one revenue definition')

// Product Mix: one row per product, not one per name it has ever had
const an = read(R + 'routes/analytics.ts')
if (/GROUP BY oi\.product_id, oi\.product_name, oi\.category/.test(an)) fail('Product Mix must not group by the name and category SNAPSHOT on the line — renaming a product split it in two under one id (T21)')
if (!/GROUP BY oi\.product_id, CASE WHEN oi\.product_id IS NULL THEN oi\.product_name END/.test(an)) fail('…group by the id, and by name only for a line that has no product')
if (!/LEFT JOIN products p ON p\.id = oi\.product_id/.test(an)) fail('…and show the name the product has NOW')

// ── TAX: the same failure, one measure over ───────────────────────────────────────────────────────
// Revenue got written down; tax did not, so six surfaces answered it three ways on one day — $488.75
// against $710.75. 'completed' alone (dashboard, analytics summary, the tax FILING), completed +
// partially refunded (EOD, compliance tax report), or every settled status (analytics timeseries,
// compliance sales report). Tax is not a choice of measure like gross-vs-net: a sale handed back in
// full returned its tax too, so counting it overstates what is owed, and dropping a partially refunded
// sale entirely — which is what the filing did — understates it far more. (Dispensary T23 H1)
if (!/export const TAX_COLLECTED_STATUSES = \['completed', 'partially_refunded'\] as const/.test(rev)) fail('the tax row set must be stated once, beside the revenue one')
if (!/export const taxCollected = sql`\('completed', 'partially_refunded'\)`/.test(rev)) fail('…with one SQL form the raw-SQL surfaces share')
if (!/TAX/.test(rev) || !/handed back|refunded IN FULL|in full/i.test(rev)) fail('…and must say WHY it differs from the settled set, or the next reader will "fix" it back')

const TAX_SURFACES: Array<[string, string]> = [
  ['routes/dashboard.ts', 'the dashboard tile'],
  ['routes/analytics.ts', 'analytics'],
  ['routes/compliance.ts', 'the compliance reports'],
  ['routes/eod.ts', 'the EOD report'],
  ['routes/tax-filing.ts', 'the tax filing'],
]
for (const [file, label] of TAX_SURFACES) {
  const src = read(R + file)
  if (!src) { fail(`${file} is missing`); continue }
  if (!/import \{[^}]*taxCollected[^}]*\} from '\.\.\/utils\/revenue\.ts'/.test(src)) fail(`${label} must take the tax row set from utils/revenue.ts`)
  if (!/status IN \$\{taxCollected\}/.test(src)) fail(`${label} must SUM tax over that row set`)
  // The shape checks below look for a tax SUM that carries no row set of its own, so they must not read a
  // query whose WHERE already IS the tax row set — the compliance tax report sums bare on purpose, and
  // that is correct there. Same exemption the revenue checks above take, for the same reason.
  const shape = file === 'routes/compliance.ts' ? src.replace(/case 'tax':[\s\S]*?(?=\n    case '|\n  \}\n)/, '') : src
  // the three wrong answers, by shape
  if (/CASE WHEN status = 'completed' THEN total_tax/.test(shape)) fail(`${label} sums tax over completed-only — that drops a partially refunded sale's tax entirely`)
  if (/CASE WHEN o\.status = 'completed' THEN o\.total_tax/.test(shape)) fail(`${label} sums tax over completed-only`)
  if (/COALESCE\(SUM\(o\.total_tax::numeric\), 0\) as total_tax/.test(shape)) fail(`${label} sums tax over every settled sale — that counts tax on a sale handed back in full`)
  if (/COALESCE\(SUM\(total_tax::numeric\), 0\) as tax_collected/.test(shape)) fail(`${label} sums tax with no row set of its own — it inherits whatever the WHERE happens to be`)
}
// The filing is the one people submit, so it gets pinned by name as well as by shape.
const filing = read(R + 'routes/tax-filing.ts')
if (/\n      AND status = 'completed'\n/.test(filing)) fail('the tax filing must not select its orders on completed-only — that is the figure the return is built from')
// Either form counts: `AND status IN ${taxCollected}` in the WHERE, or `FILTER (WHERE status IN
// ${taxCollected})` on each sum. The filing's own query now needs the second, because its COUNT is a
// different question from its money — a sale handed back in full is still a sale that happened, and
// filing 31 on a day everything else called 33 is what T31 L4 reported. The money is still scoped to
// the tax row set; only the count is not.
if ((filing.match(/status IN \$\{taxCollected\}/g) || []).length < 3) fail('…every tax total in it (the filing itself and both year-to-date summaries) must use the shared row set')
// The row set is half the question, and checking only that half is how this file passed for a whole
// round while the Summary tab — the screen the report was about — summed the GROSS. A correct row set
// summing the wrong number is still the wrong number. Any SUM over an orders tax COLUMN here has to go
// through the shared net expression; total_tax_due is a filed amount off tax_filings, not order tax.
for (const col of ['total_tax', 'excise_tax', 'sales_tax']) {
  const gross = new RegExp(`SUM\\(CAST\\(NULLIF\\(o?\\.?${col}, ''\\) AS numeric\\)\\)`).test(filing)
    || new RegExp(`SUM\\(NULLIF\\(o?\\.?${col}, ''\\)::numeric\\)`).test(filing)
  if (gross) fail(`the tax filing sums ${col} gross — it must subtract what went back with refunds (utils/revenue.ts), or it over-reports the liability on the one figure people file`)
}
if (!/SUM\(\$\{taxNetExprBare\}\)/.test(filing)) fail('…and the filing must use taxNetExprBare for its tax totals')

// "How many sales in this period" has ONE answer everywhere: the settled set. Scoping a COUNT to the
// TAX row set silently drops every sale handed back in full, and the report disagrees with the
// dashboard by exactly that many. Fixed on the filing as T31 L4 (31 against 33), found still open on
// the compliance tax report as T33 L2 (76 against 78) — the same defect twice, on the two surfaces a
// regulator reads. Both now select the settled set and FILTER the money back to taxCollected.
const compliance = read(R + 'routes/compliance.ts')
const taxCase = /case 'tax': \{([\s\S]*?)\n      break/.exec(compliance)?.[1]
if (taxCase) {
  if (!/AND o\.status IN \$\{settledSale\}/.test(taxCase)) {
    fail("the compliance tax report does not count over the settled row set — scoping its COUNT to taxCollected drops fully refunded sales and puts it out of step with every other surface (T33 L2)")
  }
  if (!/FILTER \(WHERE o\.status IN \$\{taxCollected\}\)/.test(taxCase)) {
    fail('…and having widened the rows, its tax sums must be filtered back to taxCollected, or a sale handed back in full is charged tax it does not owe')
  }
}
if (/AND status IN \$\{settledSale\}/.test(filing) && !/FILTER \(WHERE status IN \$\{taxCollected\}\)/.test(filing)) {
  fail('the tax filing selects the settled row set without scoping its tax sums back to taxCollected — that credits the state with the gross of a sale that was handed back in full')
}
// EOD was already right; pinned so it cannot drift back.
const eod = read(R + 'routes/eod.ts')
if ((eod.match(/FILTER \(WHERE status IN \$\{taxCollected\}\)/g) || []).length < 3) fail('the EOD report must take excise, sales and total tax from the shared row set')
// And the dashboard tile has to count its sales the way it counts its money, or AOV × orders ≠ revenue.
if (/COUNT\(CASE WHEN status = 'completed' THEN 1 END\)::int as completed/.test(dash)) fail('the dashboard counts completed-only sales under a settled revenue figure — 26 sales beside money from 33 (T23 H1)')
if (!/COUNT\(CASE WHEN status IN \$\{settledSale\} THEN 1 END\)::int as completed/.test(dash)) fail('…it must count the same row set its revenue comes from')

// ── and ONE definition of the business DAY ────────────────────────────────────────────────────────
// Which day a sale belongs to is the store's question. The timestamps are naive UTC, so ::date, DATE()
// and date_trunc all cut the day at UTC midnight — 20:00 in Ohio, 19:00 Central, 17:00 Pacific. A shop
// trading 09:00–21:00 therefore filed the last hours of EVERY shift under tomorrow, on the dashboard
// tile, the daily sales series, the cash reconciliation and the state sales report. The order detail
// page has shown local time since T22, so the app displayed one day and filed another. The conversion is
// the one the peak-hours chart already uses (T21 M3): label it UTC, read it in the store's zone.
// (Dispensary T24 N1)
{
  const iso = read(R + 'utils/isoTime.ts')
  if (!/export function storeTimeZone\(/.test(iso)) fail('the store\'s zone must have one resolver')
  if (!/export function storeDayRange\(/.test(iso)) fail('…and the store\'s DAY one definition, as a UTC range a query can use without wrapping the column')
  if (!/export function storeDateString\(/.test(iso)) fail('…and one answer for which date an instant falls on in that zone')
  // a day is not always 24 hours; the range has to be built from the zone, not by adding a constant
  if (/start\.getTime\(\) \+ 86400000/.test(iso)) fail('a store day is not always 24 hours — the day the clocks change is 23 or 25, so the end must come from the zone')

  const dash = read(R + 'routes/dashboard.ts')
  if (/const today = new Date\(\); today\.setHours\(0, 0, 0, 0\)/.test(dash)) fail('the dashboard Today tile must not use the SERVER\'s midnight — on Render that is UTC, and the tile reset mid-shift')
  if (!/storeDayRange\(tz\)/.test(dash)) fail('…it must use the store\'s day')

  for (const [file, what] of [
    ['routes/analytics.ts', 'the daily sales series'],
    ['routes/compliance.ts', 'the state sales report'],
    ['routes/eod.ts', 'the cash reconciliation'],
  ] as Array<[string, string]>) {
    const src = read(R + file)
    if (!/AT TIME ZONE 'UTC' AT TIME ZONE \$\{(tzDay|dayTz|tz)\}/.test(src)) fail(`${what} (${file}) must bucket by the STORE's day, not UTC`)
    if (!/storeTimeZone\(/.test(src)) fail(`…${file} must resolve that zone through the one resolver`)
  }
  // the specific shapes that cut a day at UTC midnight
  if (/\bo\.completed_at::date\b/.test(read(R + 'routes/compliance.ts'))) fail('compliance still has a bare completed_at::date — that is a UTC day')
  if (/DATE\(created_at\) = /.test(read(R + 'routes/eod.ts'))) fail('the EOD report still has a bare DATE(created_at) — that is a UTC day')
  if (/date_trunc\(\$\{dateTrunc\}, COALESCE\(completed_at, created_at\)\)/.test(read(R + 'routes/analytics.ts'))) fail('the sales series still truncates a UTC timestamp — that is a UTC day')
}

// The dashboard's Recent Orders widget reads what the API returns. It returned raw snake_case rows while
// the widget read camelCase, so `orderNumber` was never there and it printed the row id in its place —
// #lmb7ijjmytwf3b1y1fw58564 where an order number belongs, and every customer as "Walk-in". (T24)
{
  const dash = read(R + 'routes/dashboard.ts')
  if (!/recentOrders: rowsOf\(recentOrdersResult\)\.map\(camel\)/.test(dash)) fail('recent-activity must answer in camelCase like the rest of this API')
  const page = read('templates/crm-dispensary/frontend/src/pages/DashboardPage.tsx')
  if (/order\.orderNumber/.test(page)) fail('the Recent Orders widget reads orderNumber, which an order does not have')
  if (/\|\| order\.id\}/.test(page)) fail('…and must not fall back to the row id: that looks like an order number and is not one')
  // The rule has not changed; where it lives has. T28 L-b found the dashboard printing "#ORD-1145" and the
  // Orders list "#1145" for the same sale, so all six surfaces now go through utils/order. The assertion
  // follows the logic: the widget must use that helper, and the helper must obey what T24 settled here —
  // an order number, or an em dash, and never the row id dressed up as one. (It tried to: this caught it.)
  if (!/orderRef\(order\)/.test(page)) fail('…it must render the order label through utils/order, like every other surface')
  const helper = read('templates/crm-dispensary/frontend/src/utils/order.ts')
  if (/\.id\b[^\n]*slice\(0, ?8\)/.test(helper)) fail('…and the shared label helper must not fall back to the row id either — that is the T24 fault, moved')
  if (!/return '—'/.test(helper)) fail('…it has to be able to say there is no order number at all')
}

if (failed) { console.error(`\nrevenue one definition: ${failed} check(s) FAILED`); process.exit(1) }
console.log('revenue one definition: settled sales, gross / refunded / net stated once and shared by compliance, analytics and the dashboard; tax has its own stated row set (a sale returned in full returned its tax) shared by all five surfaces including the filing; Product Mix is one row per product')
