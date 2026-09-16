// CI guard: a module switched off in Settings › Features is refused at the API, not just hidden in the
// menu. ONE gate implementation (packages/tenant-backend/src/enabledFeature.ts) — salon and events wire it
// as glue; events gates the families its UI bounces (projects / jobs / quotes) and Email Marketing inside
// the shared marketing routes (so the public unsubscribe / tracking links stay open); the processor does
// not send for a company that switched Email Marketing off; the events sidebar shows Marketing on
// email_marketing only. (SALON-M1 → T15 M5, #165)
//   bun scripts/check-enabled-feature-gates.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// one implementation
const shared = read('packages/tenant-backend/src/enabledFeature.ts')
if (!/export function createEnabledFeatureGate\(/.test(shared)) fail('packages/tenant-backend must export createEnabledFeatureGate')
if (!/code: 'FEATURE_NOT_ENABLED'/.test(shared) || !/, 403\)/.test(shared)) fail('the gate must answer 403 FEATURE_NOT_ENABLED')
if (!/export \{ createEnabledFeatureGate \} from '\.\/enabledFeature'/.test(read('packages/tenant-backend/src/index.ts'))) fail('index.ts must export createEnabledFeatureGate')
for (const t of ['crm-salon', 'crm-restaurant']) {
  const glue = read(`templates/${t}/backend/src/middleware/enabledFeature.ts`)
  if (!/createEnabledFeatureGate\(\{ db, tables: \{ company \} \}\)/.test(glue) || !/from '\.\.\/shared\/index\.ts'/.test(glue)) fail(`${t}/middleware/enabledFeature.ts must be glue over the shared gate`)
  if (/db\.select\(/.test(glue)) fail(`${t}/middleware/enabledFeature.ts carries its own gate logic`)
}

// events: the families the UI bounces are refused at the API
const idx = read('templates/crm-restaurant/backend/src/index.ts')
for (const [path, feature] of [['/api/projects', 'projects'], ['/api/jobs', 'jobs'], ['/api/quotes', 'quotes']]) {
  for (const p of [path, `${path}/*`]) if (!idx.includes(`app.use('${p}', authenticate, requireEnabledFeature('${feature}'))`)) fail(`crm-restaurant index.ts must gate ${p} on '${feature}'`)
}
const mountAt = idx.indexOf("app.route('/api/projects'"), gateAt = idx.indexOf("app.use('/api/projects', authenticate, requireEnabledFeature")
if (gateAt < 0 || mountAt < 0 || gateAt > mountAt) fail('crm-restaurant index.ts must register the gates before the route mounts')

// email marketing: gated inside the shared routes, public links exempt; processor honours the switch
const mkt = read('packages/tenant-backend/src/marketing/marketing.ts')
if (!/featureGate\?: any/.test(mkt)) fail('MarketingRoutesDeps must accept featureGate')
if (!/if \(featureGate\) app\.use\('\*', async \(c, next\) => \(PUBLIC\.test\(c\.req\.path\) \? next\(\) : featureGate\(c, next\)\)\)/.test(mkt)) fail('createMarketingRoutes must apply featureGate to every non-public path')
if (!/isFeatureEnabled\?: \(companyId: string, featureId: string\) => Promise<boolean>/.test(mkt)) fail('MarketingServiceDeps must accept isFeatureEnabled')
const campaigns = mkt.slice(mkt.indexOf('async function processScheduledCampaigns('), mkt.indexOf('async function createSequence('))
if (!/isFeatureEnabled && !\(await isFeatureEnabled\(row\.companyId, 'email_marketing'\)\)/.test(campaigns)) fail('processScheduledCampaigns must skip a company that switched Email Marketing off')
const drips = mkt.slice(mkt.indexOf('async function processDripEmails('), mkt.indexOf('function startMarketingProcessor('))
if (!/isFeatureEnabled && !\(await isFeatureEnabled\(e\.company_id, 'email_marketing'\)\)/.test(drips)) fail('processDripEmails must skip a company that switched Email Marketing off')
const routesGlue = read('templates/crm-restaurant/backend/src/routes/marketing.ts')
if (!/featureGate: requireEnabledFeature\('email_marketing'\)/.test(routesGlue)) fail('crm-restaurant routes/marketing.ts must pass featureGate: requireEnabledFeature(\'email_marketing\')')
const svcGlue = read('templates/crm-restaurant/backend/src/services/marketing.ts')
if (!/isFeatureEnabled \}\)/.test(svcGlue) || !/from '\.\.\/middleware\/enabledFeature\.ts'/.test(svcGlue)) fail('crm-restaurant services/marketing.ts must pass isFeatureEnabled from the enabled-feature gate')

// events frontend: the route bounces and the sidebar item is email marketing only
const app = read('templates/crm-restaurant/frontend/src/App.tsx')
if (!/<Route path="marketing" element=\{<FeatureGate feature="email_marketing"><MarketingPage \/><\/FeatureGate>\} \/>/.test(app)) fail('crm-restaurant App.tsx must gate /crm/marketing on email_marketing')
const shell = read('templates/crm-restaurant/frontend/src/shellConfig.ts')
if (!/to: '\/crm\/marketing', icon: Megaphone, label: 'Marketing', features: \['email_marketing'\]/.test(shell)) fail("crm-restaurant sidebar Marketing must gate on ['email_marketing'] only")
if (!/'\/crm\/marketing': \['email_marketing'\]/.test(shell)) fail('crm-restaurant routeGates must include /crm/marketing')

if (failed) { console.error(`\nenabled-feature gates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('enabled-feature gates: one shared gate; events refuses projects/jobs/quotes + email marketing at the API (links open), processor honours the switch, sidebar matches')
