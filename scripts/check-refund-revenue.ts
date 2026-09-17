// CI guard: a refund never takes a sale out of "invoiced". Gross invoiced (Reports overview, monthly trend, top
// customers, projects; invoice stats totalAmount) counts every billed invoice — only draft and void are excluded,
// a refunded sale stays — and refunds are reported on their own. Balances keep excluding refunded (they owe
// nothing). (Landscaping T14 H4: refunding the rest of a paid $1,000 invoice dropped it from Total Invoiced)
//   bun scripts/check-refund-revenue.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const r = read('packages/tenant-backend/src/reporting/reporting.ts')
const fn = (name: string) => { const i = r.indexOf(`async function ${name}(`); if (i < 0) return ''; const j = r.indexOf('\n  async function ', i + 1); return r.slice(i, j < 0 ? undefined : j) }

if (!/const BILLED = \['void', 'draft'\]/.test(r) || !/const billed = sql`\$\{t\.invoice\.status\} NOT IN \(\$\{sql\.join\(BILLED\.map/.test(r)) fail("reporting must define billed = status NOT IN ('void', 'draft')")
const overview = fn('revenueOverview')
if (!/\.select\(\{ total: sum\(t\.invoice\.total\), count: count\(\) \}\)\.from\(t\.invoice\)\s*\.where\(and\(eq\(t\.invoice\.companyId, companyId\), billed,/.test(overview)) fail('revenueOverview: invoiced must be summed over billed (a refunded sale stays)')
if (!/sql`\$\{t\.payment\.amount\}::numeric < 0`/.test(overview) || !/refunded: r2\(num\(ref\.total\)\)/.test(overview)) fail('revenueOverview must report refunded (negative payment rows in the period)')
if ((overview.match(/\.from\(t\.invoice\)\.where\(and\(eq\(t\.invoice\.companyId, companyId\), issued/g) || []).length !== 2) fail('outstanding and overdue must still be summed over issued (refunded owes nothing)')
if (!/gte\(t\.invoice\.createdAt, start\), billed\)/.test(fn('revenueByMonth'))) fail('revenueByMonth: invoiced must be summed over billed')
if (!/isNotNull\(t\.invoice\.contactId\), billed,/.test(fn('revenueByCustomer'))) fail('revenueByCustomer: invoiced must be summed over billed')
if (!/inArray\(t\.invoice\.projectId, ids\), billed\)/.test(fn('projectProfitability'))) fail('projectProfitability: invoiced must be summed over billed')

const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/if \(inv\.status !== 'draft' && inv\.status !== 'void'\) stats\.totalAmount = round2\(stats\.totalAmount \+ Number\(inv\.total\)\)/.test(inv)) fail('invoice stats totalAmount must include refunded sales (only draft and void excluded)')
if (!/if \(inv\.status !== 'draft' && inv\.status !== 'void' && inv\.status !== 'refunded'\) stats\.outstanding = /.test(inv)) fail('invoice stats outstanding must still exclude refunded')
if (!/stats\.refundedAmount = round2\(stats\.refundedAmount \+ Number\(inv\.amountRefunded \|\| 0\)\)/.test(inv)) fail('invoice stats must report refundedAmount')

const page = read('packages/tenant-ui/src/reporting/ReportsPage.tsx')
if (!/\$\{revenue\.refunded \? ` · \$\{money\(revenue\.refunded\)\} refunded` : ''\}/.test(page)) fail('the Reports page must show refunds next to invoiced')
if (failed) { console.error(`\nrefund revenue: ${failed} check(s) FAILED`); process.exit(1) }
console.log('refund revenue: refunded sales stay in gross invoiced; refunds reported separately; balances unchanged')
