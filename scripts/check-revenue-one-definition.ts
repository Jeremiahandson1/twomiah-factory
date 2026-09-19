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
if (!/export const netExprBare = sql`\(COALESCE\(total::numeric, 0\) - COALESCE\(NULLIF\(refunded_amount, ''\)::numeric, 0\)\)`/.test(rev)) fail('net must be gross minus what went back, written once')

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
if ((filing.match(/AND status IN \$\{taxCollected\}/g) || []).length < 3) fail('…every tax total in it (the filing itself and both year-to-date summaries) must use the shared row set')
// EOD was already right; pinned so it cannot drift back.
const eod = read(R + 'routes/eod.ts')
if ((eod.match(/FILTER \(WHERE status IN \$\{taxCollected\}\)/g) || []).length < 3) fail('the EOD report must take excise, sales and total tax from the shared row set')
// And the dashboard tile has to count its sales the way it counts its money, or AOV × orders ≠ revenue.
if (/COUNT\(CASE WHEN status = 'completed' THEN 1 END\)::int as completed/.test(dash)) fail('the dashboard counts completed-only sales under a settled revenue figure — 26 sales beside money from 33 (T23 H1)')
if (!/COUNT\(CASE WHEN status IN \$\{settledSale\} THEN 1 END\)::int as completed/.test(dash)) fail('…it must count the same row set its revenue comes from')

if (failed) { console.error(`\nrevenue one definition: ${failed} check(s) FAILED`); process.exit(1) }
console.log('revenue one definition: settled sales, gross / refunded / net stated once and shared by compliance, analytics and the dashboard; tax has its own stated row set (a sale returned in full returned its tax) shared by all five surfaces including the filing; Product Mix is one row per product')
