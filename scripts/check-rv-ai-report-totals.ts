// CI guard: RV AI Reports doesn't trust the model's arithmetic. The model gets exact precomputed totals and is told
// to copy them; every table Total row in its answer is re-added from the rows shown and corrected (the wrong figure
// corrected everywhere it repeats) with a visible note. (RV T19 H4: rows $156,084, report said $194,584)
//   bun scripts/check-rv-ai-report-totals.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const r = readFileSync(join(ROOT, 'templates/crm-rv/backend/src/routes/aiReports.ts'), 'utf8')
const SVC = 'templates/crm-rv/backend/src/services/aiReportTotals.ts'
const svc = readFileSync(join(ROOT, SVC), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

if (/^import /m.test(svc)) fail('aiReportTotals.ts must stay pure (no imports) so it can be checked without a database')
if (!/import \{ precomputedTotals, fixReportTotals \} from '\.\.\/services\/aiReportTotals\.ts'/.test(r)) fail('the route must use the aiReportTotals helpers')
if (!/export function precomputedTotals\(/.test(svc) || !/unitsByStatusAndCategory/.test(svc) || !/internetPriceTotal/.test(svc)) fail('precomputedTotals must give exact unit counts and price totals by status / category')
if (!/=== PRECOMPUTED TOTALS \(exact[^`]*`?\$\{JSON\.stringify\(precomputedTotals\(units, leads, ros, invoices\)\)\}/.test(r) && !/PRECOMPUTED TOTALS[\s\S]{0,120}precomputedTotals\(units, leads, ros, invoices\)/.test(r)) fail('the model context must include the precomputed totals')
if (!/use the PRECOMPUTED TOTALS section[\s\S]*do not add up numbers yourself/.test(r)) fail('the instructions must tell the model to copy totals rather than add')
if (!/export function fixReportTotals\(/.test(svc)) fail('fixReportTotals must exist')
const gen = r.slice(r.indexOf("app.post('/generate'"))
if (!/const checked = fixReportTotals\(raw\)/.test(gen) || !/report = checked\.corrections\.length/.test(gen) || /report: raw|\breport, question[\s\S]*= raw/.test(gen.replace(/const raw = [^\n]*\n/, ''))) fail('the model text must pass through fixReportTotals before it is returned')
if (!/\*\*Note:\*\*/.test(gen) || !/totalsCorrected: checked\.corrections/.test(gen)) fail('a corrected report must carry a visible note and the list of corrections')

// behaviour: run the pure helper on the T19 shape
const { fixReportTotals } = await import(join(ROOT, SVC))
if (typeof fixReportTotals !== 'function') fail('aiReportTotals.ts must export fixReportTotals')
else {
  const t = fixReportTotals('Total $194,584.\n\n| Cat | Price |\n|---|---|\n| a | $100,000 |\n| b | $56,084 |\n| **Total** | **$194,584** |')
  if (!t.report.includes('| **Total** | **$156,084** |') || !t.report.startsWith('Total $156,084.')) fail('fixReportTotals must correct a wrong Total row and the repeated figure')
  if (fixReportTotals('| a | b |\n|---|---|\n| x | 50% |\n| Total | 100% |').corrections.length) fail('fixReportTotals must not sum percent columns')
}

if (failed) { console.error(`\nrv ai report totals: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv ai report totals: totals are precomputed for the model and every table total is re-added and corrected before the report is shown')
