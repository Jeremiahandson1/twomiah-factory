// CI guard: RV Reports shows dealership figures, and every CRM's quote conversion is labelled against the same
// denominator it is calculated on. RV: /api/dashboard/sales-report (units sold, front-end gross, close rate, pipeline,
// service ROs for the period) + the shared Reports page's dealership mode, with the contractor jobs / projects / team
// panels off. Shared: "X of N decided · P pending" (conversion = approved ÷ decided). (RV T19 M8: Jobs completed 0%,
// Job status, team hours from time entries RV doesn't have, and "86%" labelled "6 of 9 approved")
//   bun scripts/check-rv-dealer-reports.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const dash = read('templates/crm-rv/backend/src/routes/dashboard.ts')
const rep = dash.slice(dash.indexOf("app.get('/sales-report'"), dash.indexOf("app.get('/recent-activity'"))
if (!rep) fail('RV must serve /api/dashboard/sales-report')
else {
  if (!/eq\(salesLead\.companyId, companyId\), eq\(salesLead\.stage, 'closed_won'\), gte\(salesLead\.closedAt, start\), lt\(salesLead\.closedAt, end\)/.test(rep)) fail('units sold = Sold leads closed in the period, company-scoped')
  if (!/closeRate: won \+ lost > 0 \? Math\.round\(\(won \/ \(won \+ lost\)\) \* 100\) : 0/.test(rep)) fail('close rate must be won ÷ (won + lost)')
  if (!/Number\(deal\.price\) - \(Number\(deal\.discount\) \|\| 0\)/.test(rep) || !/s\.cost != null/.test(rep)) fail('gross must use the saved desk price (less discount) and only units with a cost')
  if (!/eq\(repairOrder\.companyId, companyId\), eq\(repairOrder\.status, 'closed'\)/.test(rep)) fail('service figures must be company-scoped closed ROs in the period')
}
const cfg = read('templates/crm-rv/frontend/src/reportingConfig.ts')
if (!/dealership: true/.test(cfg) || !/jobs: false/.test(cfg) || !/team: false/.test(cfg) || !/projects: false/.test(cfg)) fail('RV Reports must use dealership mode with jobs / team / projects off')
const page = read('packages/tenant-ui/src/reporting/ReportsPage.tsx')
if (!/cfg\.dealership \? api\.get\('\/api\/dashboard\/sales-report', q\)/.test(page)) fail('the Reports page must load the dealership report in dealership mode')
if (!/title="Units sold"/.test(page) || !/Sales pipeline \(open leads\)/.test(page)) fail('dealership mode must show units sold and the sales pipeline')
if (!/const decided = quotes\.approved \+ \(quotes\.rejected \|\| 0\) \+ \(quotes\.expired \|\| 0\)/.test(page) || !/of \$\{decided\} decided/.test(page) || /subtitle=\{`\$\{quotes\.approved\} of \$\{quotes\.total\} approved`\}/.test(page)) fail('quote conversion must be labelled against the decided quotes it is calculated on')
if (!/conversionRate: decided > 0 \? Math\.round\(\(approved\.count \/ decided\) \* 100\) : 0/.test(read('packages/tenant-backend/src/reporting/reporting.ts'))) fail('the server conversion rate must stay approved ÷ decided (the label depends on it)')

if (failed) { console.error(`\nrv dealer reports: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv dealer reports: dealership figures for the period; quote conversion labelled on its real denominator')
