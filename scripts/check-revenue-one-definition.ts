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

// Product Mix: one row per product, not one per name it has ever had
const an = read(R + 'routes/analytics.ts')
if (/GROUP BY oi\.product_id, oi\.product_name, oi\.category/.test(an)) fail('Product Mix must not group by the name and category SNAPSHOT on the line — renaming a product split it in two under one id (T21)')
if (!/GROUP BY oi\.product_id, CASE WHEN oi\.product_id IS NULL THEN oi\.product_name END/.test(an)) fail('…group by the id, and by name only for a line that has no product')
if (!/LEFT JOIN products p ON p\.id = oi\.product_id/.test(an)) fail('…and show the name the product has NOW')

if (failed) { console.error(`\nrevenue one definition: ${failed} check(s) FAILED`); process.exit(1) }
console.log('revenue one definition: settled sales, gross / refunded / net stated once and shared by compliance, analytics and the dashboard; Product Mix is one row per product')
