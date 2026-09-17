// CI guard: the RV dashboard's category panel counts units for sale (not sold ones), and its close rate is labelled as
// this month's with the lost count. (RV T19 L7: "8 available" tile over counts that included sold units; L9: "100%
// close" while lost leads existed in other months)
//   bun scripts/check-rv-dashboard.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const d = read('templates/crm-rv/backend/src/routes/dashboard.ts')
if (!/where\(and\(eq\(unit\.companyId, companyId\), eq\(unit\.status, 'available'\)\)\)\.groupBy\(unit\.category\)/.test(d) || !/availableByCategory \}/.test(d)) fail('stats must return availableByCategory (available units only)')
if (!/closedLostThisMonth: Number\(closedLostThisMonth\)/.test(d)) fail("stats must return this month's lost count")
const p = read('templates/crm-rv/frontend/src/pages/rv/DashboardPage.tsx')
if (!/const byCategory = inventory\.availableByCategory \|\| \{\}/.test(p) || !/Available by category/.test(p)) fail('the category panel must show available units')
if (!/decidedThisMonth > 0 \? pct\(sales\.closeRate\) : '—'/.test(p) || !/close \(mo\) · \{num\(sales\.closedLostThisMonth\)\} lost/.test(p)) fail("the close rate must be labelled as this month's with its lost count")
if (failed) { console.error(`\nrv dashboard: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv dashboard: available-by-category panel and a labelled monthly close rate')
