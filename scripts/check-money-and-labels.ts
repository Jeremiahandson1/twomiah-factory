// CI guard: money the customer sees keeps its cents, a team rate is money, a count of one takes the singular label,
// and the Recurring Invoices tiles have their numbers. (Landscaping T14 L1, L2, L5, L6)
//   bun scripts/check-money-and-labels.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// L1 — the portal's money helpers both carry cents (moneyShort used to drop them: "$824.6")
const common = read('packages/tenant-ui/src/portal/common.tsx')
if (!/export const money = .*minimumFractionDigits: 2, maximumFractionDigits: 2/.test(common)) fail('portal money() must show cents')
if (!/export const moneyShort = money\b/.test(common)) fail('portal moneyShort must show cents too (it is money)')
// L2 — a team rate is money
const team = read('packages/tenant-ui/src/people/TeamPage.tsx')
if (!/\$\$\{Number\(v\)\.toFixed\(2\)\}\/hr/.test(team.replace(/\$\{/g, '$${')) && !/\$\{Number\(v\)\.toFixed\(2\)\}\/hr/.test(team)) fail('the team Rate column must show 2 decimals')
// L6 — one job is not "1 jobs"
const reports = read('packages/tenant-ui/src/reporting/ReportsPage.tsx')
if (!/const labelFor = \(n: number\) => \(n === 1 \? cfg\.jobsLabel\.replace\(\/s\$\/, ''\) : cfg\.jobsLabel\)\.toLowerCase\(\)/.test(reports)) fail('Reports must pick the singular label for a count of one')
if (!/\$\{labelFor\(jobs\.total\)\} in this period/.test(reports) || !/\{labelFor\(m\.jobsCompleted\)\} completed/.test(reports)) fail('both job counts must use labelFor')
if (/\$\{cfg\.jobsLabel\.toLowerCase\(\)\} in this period/.test(reports) || /\{cfg\.jobsLabel\.toLowerCase\(\)\} completed/.test(reports)) fail('a job count still uses the plural label unconditionally')
// L5 — the Recurring Invoices tiles have numbers
const rec = read('packages/tenant-backend/src/recurring/recurring.ts')
const stats = rec.slice(rec.indexOf('async function getRecurringStats('), rec.indexOf('async function updateRecurringStatus('))
if (!/total: rows\(totalRes\)\[0\]\?\.count \|\| 0/.test(stats) || !/monthlyRecurringRevenue: Math\.round\(monthly \* 100\) \/ 100/.test(stats)) fail('recurring stats must return total and monthlyRecurringRevenue')
if (!/status = 'active'`\),\s*\]\)/.test(stats) || !/const perMonth = \(frequency: string\)/.test(stats)) fail('monthly revenue must come from the active schedules, by frequency')

if (failed) { console.error(`\nmoney and labels: ${failed} check(s) FAILED`); process.exit(1) }
console.log('money and labels: portal cents, team rate, singular job label, recurring totals')
