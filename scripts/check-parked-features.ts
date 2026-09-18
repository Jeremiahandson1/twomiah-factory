// CI guard: a feature that is NOT ready to sell cannot be switched on anywhere.
//
// Parking a feature means four things at once, and they must stay in step:
//   1. the registry entry is `hidden` and offered to NO template — so it is off the tenant's
//      Settings › Features page (GET /api/company/features/catalog reads the registry), off every
//      public/advertisable list, and never a default;
//   2. no plan tier names it — v1 tiers push raw id lists straight into a new tenant;
//   3. the Factory's own feature catalogue (GET /api/factory/features) does not list it;
//   4. the Factory wizard does not offer it.
// The id itself stays in the registry, so the gates that reference it are still valid vocabulary and
// the pages simply never open. (Twomiah Ads, 2026-09-17; Instant Roof Estimator, 2026-08-20)
//   bun scripts/check-parked-features.ts
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
const { FEATURE_REGISTRY, PLAN_TIERS, getAdvertisableFeatures, getFeaturesForPlan } = await import(pathToFileURL(ROOT + 'packages/tenant-backend/src/featureRegistry.ts').href)
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** Features that exist in code but must not be sellable yet. */
const PARKED = ['paid_ads', 'instant_estimator']

for (const id of PARKED) {
  const def = (FEATURE_REGISTRY as any[]).find((f) => f.id === id)
  if (!def) { fail(`${id} must stay in the registry so the gates that use it are known vocabulary`); continue }
  if (!def.hidden) fail(`${id} must be hidden: true — it is not ready to sell`)
  if (def.templates.length) fail(`${id} must be offered to no template (found: ${def.templates.join(', ')})`)
  for (const [template, tiers] of Object.entries(PLAN_TIERS as Record<string, Record<string, string[]>>)) {
    for (const [tier, ids] of Object.entries(tiers)) if (ids.includes(id)) fail(`${template} plan tier "${tier}" still seeds ${id}`)
  }
  if ((getAdvertisableFeatures() as any[]).some((f) => f.id === id)) fail(`${id} must not be advertisable`)
  for (const template of Object.keys(PLAN_TIERS as Record<string, unknown>)) {
    for (const plan of [...Object.keys((PLAN_TIERS as any)[template]), 'business50', 'team25', 'starter10', 'not-a-plan']) {
      if ((getFeaturesForPlan(template, plan) as string[]).includes(id)) fail(`${template}/${plan} resolves to a feature list containing ${id}`)
    }
  }
}

// the Factory's catalogue and wizard must not offer them either
const factory = read('apps/api/src/routes/factory/generation.ts')
const wizard = read('apps/platform/src/components/factory/StepFeatures.tsx')
for (const id of PARKED) {
  if (new RegExp(`\\{ id: '${id}', name:`).test(factory)) fail(`apps/api factory /features still lists ${id}`)
  if (new RegExp(`\\{ id: '${id}', name:`).test(wizard)) fail(`the Factory wizard still lists ${id}`)
}
// the Ads tab and its panel are behind one switch, so turning Ads back on is a one-line change
if (!/const ADS_READY = false/.test(wizard)) fail('the wizard must keep the Ads tab behind ADS_READY = false while Twomiah Ads is parked')
if (!/\{ADS_READY && \(\s*\n\s*<button onClick=\{\(\) => setTab\('ads'\)\}/.test(wizard)) fail('the Ads tab button must be behind ADS_READY')
if (!/\{ADS_READY && tab === 'ads' && \(/.test(wizard)) fail('the Ads panel must be behind ADS_READY')

// Ads off must mean Ads off in the product too: crm-roof carries its OWN /api/ads router (landing-page A/B tests
// plus illustrative sample campaigns) and has no shared enabled-feature middleware, so it gates itself; and no CRM
// may push a signed-in user out to the Ads sales page when the switch is off.
const roofAds = read('templates/crm-roof/backend/src/routes/ads.ts')
if (!/if \(!list\.includes\('paid_ads'\)\) return c\.json\(\{ error: 'Ads is not enabled for your account\.', code: 'FEATURE_NOT_ENABLED', feature: 'paid_ads' \}, 403\)/.test(roofAds)) fail('crm-roof /api/ads must refuse a tenant that does not have Ads switched on')
if (roofAds.indexOf("app.use('*', authenticate)") > roofAds.indexOf("!list.includes('paid_ads')")) fail('crm-roof /api/ads must authenticate before it reads the feature list')
for (const t of ['crm-roof', 'crm-homecare']) {
  const page = read(`templates/${t}/frontend/src/pages/ads/AdsPage.tsx`)
  if (/window\.location\.href = 'https:\/\/twomiah\.com\/ads'/.test(page)) fail(`${t} AdsPage sends a signed-in user to the Ads sales page when the feature is off`)
  if (!/Ads is not enabled for your account\./.test(page)) fail(`${t} AdsPage must say Ads is not enabled instead of redirecting`)
}

if (failed) { console.error(`\nparked features: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`parked features: ${PARKED.join(', ')} — hidden, offered to no template, in no plan tier, in no Factory catalogue`)
