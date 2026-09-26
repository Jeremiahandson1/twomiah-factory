// CI guard: the Reports dashboard reports only on modules the tenant actually has.
//
// evttest has `quotes` switched off. GET /api/quotes answers 403 — "This module is not enabled for your
// account" — and GET /api/reports/dashboard returned, to the same session:
//
//     quotes: { total: 8, approved: 5, conversionRate: 83, … }
//
// which is how a Quote-conversion tile came to sit on an events venue's Reports page. The vertical config
// stops the tile being drawn; this stops the numbers being computed and handed over at all, so the next
// surface that reads this payload cannot inherit the same problem.
//
// Two halves, and both matter: the shared service must ASK, and every template must TELL it.
//
//   bun scripts/check-dashboard-reports-what-exists.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => { try { return strip(readFileSync(ROOT + p, 'utf8')) } catch { return '' } }

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the shared service asks ────────────────────────────────────────────────────────────────────────
const svc = read('packages/tenant-backend/src/reporting/reporting.ts')
if (!svc) fail('packages/tenant-backend/src/reporting/reporting.ts is missing')
else {
  if (!/featuresFor\?: \(companyId: string\) => Promise<string\[\]>/.test(svc)) {
    fail('ReportingOptions must accept featuresFor — without it the dashboard cannot know what the tenant has')
  }
  if (!/const enabled = deps\.options\?\.featuresFor \? await deps\.options\.featuresFor\(companyId\) : null/.test(svc)) {
    fail('dashboardSummary must read the tenant\'s features')
  }
  if (!/const has = \(id: string\) => enabled === null \|\| enabled\.includes\(id\)/.test(svc)) {
    // `enabled === null` is what keeps this additive: a template that wires nothing gets the old payload.
    fail('a template that does not wire featuresFor must keep the payload it has today (enabled === null ⇒ everything)')
  }
  for (const [section, feature] of [['jobStats', 'jobs'], ['projectStats', 'projects'], ['quoteStats', 'quotes']]) {
    if (!new RegExp(`has\\('${feature}'\\) \\? ${section}\\(`).test(svc)) {
      fail(`dashboardSummary must skip ${section} when '${feature}' is off — computing it is how the numbers reached a page that should not have them`)
    }
    if (!new RegExp(`\\.\\.\\.\\(${feature === 'jobs' ? 'jobs' : feature === 'projects' ? 'projects' : 'quotes'} \\? \\{`).test(svc)) {
      fail(`…and omit the '${feature}' key entirely rather than sending zeros: "has no quotes" and "quoted nothing this month" are different answers`)
    }
  }
  // Revenue and recent activity are deliberately NOT gated: every vertical bills, and every vertical has
  // a history. If someone gates them, a tenant's own money vanishes from its own dashboard.
  if (/has\('invoices'\) \? revenueOverview|has\('[a-z_]+'\) \? recentActivity/.test(svc)) {
    fail('revenue and recent activity must not be feature-gated — every vertical bills and every vertical has a history')
  }
}

// ── every template tells it ────────────────────────────────────────────────────────────────────────
const TEMPLATES = ['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
let wired = 0
for (const t of TEMPLATES) {
  const p = `templates/${t}/backend/src/routes/reporting.ts`
  const src = read(p)
  if (!src) { fail(`${p} is missing`); continue }
  if (!/createReportingRoutes/.test(src)) continue // a vertical with its own Reports backend
  wired++
  if (!/import \{ enabledFeaturesFor \} from '\.\.\/middleware\/enabledFeature\.ts'/.test(src)) {
    fail(`${t} does not import enabledFeaturesFor — its dashboard will report on modules the tenant does not have`)
  }
  if (!/featuresFor: enabledFeaturesFor/.test(src)) {
    fail(`${t} does not pass featuresFor to createReportingRoutes`)
  }
}

if (failed) { console.error(`\ndashboard reports what exists: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`dashboard reports what exists: the shared summary skips jobs, projects and quotes for a tenant without them and omits the key rather than sending zeros, revenue and history stay ungated, and all ${wired} templates hand it their own feature list`)
