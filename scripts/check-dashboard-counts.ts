// CI guard: the home/portal dashboard counts. "Open Jobs" is what is still to do (not every job, not today's), and
// what was billed stays billed after a refund — the same rule as Reports and the invoice stats.
// (Landscaping T14 M2: the portal's "Open Jobs" counted completed and cancelled jobs; T14 H4 → #204 for the money)
//   bun scripts/check-dashboard-counts.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const d = read('packages/tenant-backend/src/reporting/jobsDashboard.ts')
if (!/open: sumCounts\(jobsByStatus\) - \(byStatus\(jobsByStatus\)\.completed \|\| 0\) - \(byStatus\(jobsByStatus\)\.cancelled \|\| 0\)/.test(d)) fail('dashboard stats must return jobs.open = everything not completed or cancelled')
if (!/if \(inv\.status === 'draft' \|\| inv\.status === 'void'\) continue/.test(d)) fail('only draft and void are left out of what was billed')
if (!/invoiceStats\.totalValue = r2\(invoiceStats\.totalValue \+ num\(inv\.total\)\)\s*\n\s*if \(ISSUED\.includes\(inv\.status\)\) continue/.test(d)) fail('a refunded sale must be counted as billed, then skipped for owed/paid')
for (const t of ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-vet']) {
  const p = read(`templates/${t}/frontend/src/pages/CustomerPortal.tsx`)
  const tile = (p.match(/\{ label: 'Open Jobs'[^\n]*/) || [''])[0]
  if (!tile) fail(`${t}: the portal has no Open Jobs tile`)
  else if (!/\?\.open \?\? 0/.test(tile) || /\?\.total \?\? 0/.test(tile) || /\?\.today \?\? 0/.test(tile)) fail(`${t}: the Open Jobs tile must read jobs.open (not total, not today) — ${tile.trim().slice(0, 90)}`)
}
if (failed) { console.error(`\ndashboard counts: ${failed} check(s) FAILED`); process.exit(1) }
console.log('dashboard counts: Open Jobs = still to do; billed totals keep refunded sales')
