// CI guard: a not-ready feature is never switched on. (Owner, 2026-10-09)
//
//   "we cant use the roof report yet, it shouldnt be enabled … dont use projects that dont work right yet.
//    those are add ons."
//
// A feature marked `hidden: true` in the registry is not ready. It reached a live tenant anyway: the roof
// report (measurement_reports) sat in crm-roof's PRO plan tier, and the Paid Ads Hub was on two tenants
// although no CRM is offered it. Every path that can switch a feature on is held here:
//   1. no plan tier lists one, and every plan of every template RESOLVES to none (the real functions run);
//   2. no template's signup default contains one;
//   3. the owner's Settings › Features save filters them, in the shared route and both forks;
//   4. the Factory's admin feature save drops them, and the generator filters the deployed list.
//   bun scripts/check-not-ready-features.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURE_REGISTRY, PLAN_TIERS, getFeaturesForPlan, getDefaultFeaturesForTemplate } from '../packages/tenant-backend/src/featureRegistry.ts'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const hidden = new Set(FEATURE_REGISTRY.filter((f) => f.hidden).map((f) => f.id))
if (!hidden.size) fail('no hidden feature in the registry — this guard is checking nothing')
const templates = [...new Set(FEATURE_REGISTRY.flatMap((f) => f.templates))]
const PLANS = ['starter', 'pro', 'business', 'construction', 'storm', 'enterprise', 'website', 'starter10', 'team25', 'business50', 'no-such-plan']

// 1 + 2
for (const [t, tiers] of Object.entries(PLAN_TIERS)) {
  for (const [tier, ids] of Object.entries(tiers)) {
    const bad = ids.filter((id) => hidden.has(id))
    if (bad.length) fail(`PLAN_TIERS['${t}'].${tier} lists not-ready feature(s): ${bad.join(', ')}`)
  }
}
let resolved = 0
for (const t of templates) {
  for (const p of PLANS) {
    resolved++
    const bad = getFeaturesForPlan(t, p).filter((id) => hidden.has(id))
    if (bad.length) fail(`getFeaturesForPlan('${t}', '${p}') switches on not-ready: ${bad.join(', ')}`)
  }
  const d = getDefaultFeaturesForTemplate(t).filter((id) => hidden.has(id))
  if (d.length) fail(`getDefaultFeaturesForTemplate('${t}') switches on not-ready: ${d.join(', ')}`)
}

// 3 — the owner's save, in every implementation
for (const [file, re] of [
  ['packages/tenant-backend/src/company/company.ts', /const offered = getFeaturesForTemplate\(template\)\.filter\(\(f\) => !f\.hidden\)/],
  ['templates/crm-roof/backend/src/routes/company.ts', /const offered = getFeaturesForTemplate\(CRM_TEMPLATE\)\.filter\(\(f\) => !f\.hidden\)/],
  ['templates/crm-dispensary/backend/src/routes/company.ts', /const offered = getFeaturesForTemplate\(CRM_TEMPLATE\)\.filter\(f => !f\.hidden\)/],
] as const) {
  const src = read(file)
  const put = src.slice(src.indexOf("put('/features'"))
  if (!put || !re.test(put)) fail(`${file}: the owner's feature save must offer only ready features (filter !f.hidden)`)
  // …and say so in words: a not-ready feature by its real name, not "Unknown feature ids … measurement_reports"
  if (!/code: 'feature_not_ready'/.test(put) || !/ready yet, so/.test(put)) fail(`${file}: refusing a not-ready feature must name it and say it isn't ready yet (code feature_not_ready)`)
}

// 4 — the Factory
const admin = read('apps/api/src/routes/factory/admin.ts')
const patch = admin.slice(admin.indexOf("factory.patch('/customers/:id/features'"))
if (!/const notReady = features\.filter\([^\n]*\?\.hidden\)/.test(patch) || !/const newFeatures: string\[\] = features\.filter\([^\n]*!notReady\.includes\(f\)\)/.test(patch)) fail("apps/api admin: PATCH /customers/:id/features must drop not-ready features before saving and syncing")
const gen = read('apps/api/src/services/generator.ts')
if (!/\.filter\(\(id: string\) => !FEATURE_MAP\[id\]\?\.hidden\)/.test(gen.slice(gen.indexOf('function processCRM')))) fail('apps/api generator: processCRM must filter not-ready features out of the deployed list')

if (failed) { console.error(`\nnot-ready features: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`not-ready features: ${hidden.size} not-ready (${[...hidden].join(', ')}); ${resolved} plan resolutions + ${templates.length} defaults switch none on; owner + Factory saves filter them`)
