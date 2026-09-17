// CI guard: a module switched off in Settings › Features is refused at the API, not just hidden in the
// menu. ONE gate implementation (packages/tenant-backend/src/enabledFeature.ts), wired as glue in every
// CRM template; each template gates, at the mount, the sidebar-gated families whose route module
// authenticates everything and has no public path (a list = any of those features, the sidebar's reading);
// Email Marketing is gated inside the shared marketing routes so the public unsubscribe / tracking links
// stay open, the processor does not send for a company that switched it off, and the sidebar shows
// Marketing on email_marketing only (RV: or follow_up_sequences — same page). Pages that merely look up
// another module's data (a project for an RFI, a PO for a bill) tolerate that module being off.
// (SALON-M1 → T15 M5 #165 → fleet-wide #167)
//   bun scripts/check-enabled-feature-gates.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']

// one implementation, one id or any-of a list
const shared = read('packages/tenant-backend/src/enabledFeature.ts')
if (!/export function createEnabledFeatureGate\(/.test(shared)) fail('packages/tenant-backend must export createEnabledFeatureGate')
if (!/code: 'FEATURE_NOT_ENABLED'/.test(shared) || !/, 403\)/.test(shared)) fail('the gate must answer 403 FEATURE_NOT_ENABLED')
if (!/function requireEnabledFeature\(feature: string \| string\[\]\)/.test(shared) || !/isFeatureEnabled = async \(companyId: string, feature: string \| string\[\]\)/.test(shared)) fail('requireEnabledFeature / isFeatureEnabled must accept one id or a list (any-of)')
if (!/export \{ createEnabledFeatureGate \} from '\.\/enabledFeature'/.test(read('packages/tenant-backend/src/index.ts'))) fail('index.ts must export createEnabledFeatureGate')
for (const t of TEMPLATES) {
  const glue = read(`templates/${t}/backend/src/middleware/enabledFeature.ts`)
  if (!/createEnabledFeatureGate\(\{ db, tables: \{ company \} \}\)/.test(glue) || !/from '\.\.\/shared\/index\.ts'/.test(glue)) fail(`${t}/middleware/enabledFeature.ts must be glue over the shared gate`)
  if (/db\.select\(/.test(glue)) fail(`${t}/middleware/enabledFeature.ts carries its own gate logic`)
}

// the mount gates each template registers, in front of the route mounts
type Gate = [string, string | string[]]
const FS: Gate[] = [['/api/fleet', 'fleet'], ['/api/locations', 'multi_location'], ['/api/commissions', 'commission_tracking'], ['/api/inventory', ['inventory', 'parts_tracking']], ['/api/equipment', 'equipment_tracking'], ['/api/agreements', ['service_agreements', 'maintenance_contracts']], ['/api/maintenance-contracts', ['service_agreements', 'maintenance_contracts']], ['/api/warranties', 'warranties'], ['/api/recurring', 'recurring_jobs']]
const CONSTRUCTION: Gate[] = [['/api/rfis', 'rfis'], ['/api/submittals', 'submittals'], ['/api/lien-waivers', 'lien_waivers'], ['/api/draw-schedules', 'draw_schedules'], ['/api/aia-forms', 'aia_forms'], ['/api/gantt-charts', 'gantt_charts'], ['/api/change-orders', 'change_orders'], ['/api/punch-lists', 'punch_lists'], ['/api/daily-logs', 'daily_logs'], ['/api/inspections', 'inspections'], ['/api/bids', 'bid_management'], ['/api/takeoffs', 'takeoff_tools'], ['/api/selections', 'selections']]
const GATES: Record<string, Gate[]> = {
  'crm': [['/api/projects', 'projects'], ['/api/tasks', 'projects'], ['/api/purchase-orders', 'purchase_orders'], ['/api/bills', 'vendor_bills'], ...CONSTRUCTION, ['/api/fleet', 'fleet'], ['/api/inventory', 'inventory'], ['/api/equipment', 'equipment_tracking'], ['/api/agreements', 'service_agreements'], ['/api/warranties', 'warranties'], ['/api/recurring', 'recurring_jobs']],
  'crm-fieldservice': FS,
  'crm-landscaping': [...FS, ['/api/recurring-routes', 'recurring_routes'], ['/api/area-pricing', 'area_pricing'], ['/api/snow', 'snow_billing']],
  'crm-rv': [['/api/warranties', 'warranties'], ['/api/inventory', ['inventory', 'parts_tracking']]],
  'crm-vet': [],
  'crm-salon': [['/api/projects', 'projects'], ['/api/jobs', 'jobs'], ['/api/quotes', 'quotes'], ...CONSTRUCTION, ['/api/fleet', 'fleet'], ['/api/inventory', 'inventory'], ['/api/equipment', 'equipment_tracking'], ['/api/pricebook', 'pricebook'], ['/api/memberships', 'salon_memberships'], ['/api/recurring', 'recurring_jobs']],
  'crm-restaurant': [['/api/projects', 'projects'], ['/api/jobs', 'jobs'], ['/api/quotes', 'quotes']],
}
const arg = (f: string | string[]) => (Array.isArray(f) ? `[${f.map((x) => `'${x}'`).join(', ')}]` : `'${f}'`)
// families with public sub-routes (widget, webhooks, portal links) are never blanket-gated at the mount
const NEVER_AT_MOUNT = ['booking', 'sms', 'calltracking', 'ai-receptionist', 'leads', 'ads', 'reviews', 'gbp', 'marketing', 'portal', 'vendor-portal', 'webhooks', 'public']
for (const t of TEMPLATES) {
  const idx = read(`templates/${t}/backend/src/index.ts`)
  for (const [path, feature] of GATES[t]) {
    for (const p of [path, `${path}/*`]) if (!idx.includes(`app.use('${p}', authenticate, requireEnabledFeature(${arg(feature)}))`)) fail(`${t} index.ts must gate ${p} on ${arg(feature)}`)
  }
  if (GATES[t].length) {
    const mountAt = idx.indexOf("app.route('/api/auth'"), gateAt = idx.indexOf('authenticate, requireEnabledFeature(')
    if (gateAt < 0 || mountAt < 0 || gateAt > mountAt) fail(`${t} index.ts must register the gates before the route mounts`)
  }
  for (const fam of NEVER_AT_MOUNT) if (new RegExp(`app\\.use\\('/api/${fam}(/\\*)?', authenticate, requireEnabledFeature\\(`).test(idx)) fail(`${t} index.ts blanket-gates /api/${fam}, which has public sub-routes — gate inside its routes instead`)
}

// call tracking / AI receptionist: never gated at the mount (the phone providers' webhooks are public), so each
// route file gates its OWN authenticated endpoints — the gate sits right after its `app.use('*', authenticate)`,
// with the webhooks registered above it. (Landscaping T14 M4: both answered with data while switched off)
for (const t of TEMPLATES) {
  for (const [file, feature] of [['calltracking', 'call_tracking'], ['aiReceptionist', 'ai_receptionist']] as const) {
    let src = ''
    try { src = read(`templates/${t}/backend/src/routes/${file}.ts`) } catch { continue } // template without the module
    const authAt = src.indexOf("app.use('*', authenticate)"), gateAt = src.indexOf(`app.use('*', requireEnabledFeature('${feature}'))`)
    if (gateAt < 0) { fail(`${t} ${file}.ts must refuse its own endpoints when ${feature} is off`); continue }
    if (authAt < 0 || gateAt < authAt) fail(`${t} ${file}.ts must gate after authenticate (the webhooks above it stay public)`)
    const webhookAt = src.indexOf("app.post('/webhook")
    if (webhookAt >= 0 && webhookAt > gateAt) fail(`${t} ${file}.ts registers a webhook after the gate — it would stop being public`)
  }
}

// email marketing: gated inside the shared routes, public links exempt; processor honours the switch
const mkt = read('packages/tenant-backend/src/marketing/marketing.ts')
if (!/featureGate\?: any/.test(mkt)) fail('MarketingRoutesDeps must accept featureGate')
if (!/if \(featureGate\) app\.use\('\*', async \(c, next\) => \(PUBLIC\.test\(c\.req\.path\) \? next\(\) : featureGate\(c, next\)\)\)/.test(mkt)) fail('createMarketingRoutes must apply featureGate to every non-public path')
if (!/isFeatureEnabled\?: \(companyId: string, featureId: string\) => Promise<boolean>/.test(mkt)) fail('MarketingServiceDeps must accept isFeatureEnabled')
const campaigns = mkt.slice(mkt.indexOf('async function processScheduledCampaigns('), mkt.indexOf('async function createSequence('))
if (!/isFeatureEnabled && !\(await isFeatureEnabled\(row\.companyId, 'email_marketing'\)\)/.test(campaigns)) fail('processScheduledCampaigns must skip a company that switched Email Marketing off')
const drips = mkt.slice(mkt.indexOf('async function processDripEmails('), mkt.indexOf('function startMarketingProcessor('))
if (!/isFeatureEnabled && !\(await isFeatureEnabled\(e\.company_id, 'email_marketing'\)\)/.test(drips)) fail('processDripEmails must skip a company that switched Email Marketing off')
// every template wires it; on RV the same page is also the Follow-Up product, so either switch keeps the module (and
// its drips) open — but email campaigns and templates need email_marketing itself, at the API, in the processor and
// in the sidebar, where "Marketing" and "Follow-Up" are separate entries the shell reads as any-of. (RV T19 M6)
const MARKETING_ARG: Record<string, string> = { 'crm-rv': "['email_marketing', 'follow_up_sequences']" }
for (const t of TEMPLATES) {
  const a = MARKETING_ARG[t] || "'email_marketing'"
  const routesGlue = read(`templates/${t}/backend/src/routes/marketing.ts`)
  if (!routesGlue.includes(`featureGate: requireEnabledFeature(${a})`)) fail(`${t} routes/marketing.ts must pass featureGate: requireEnabledFeature(${a})`)
  if (t === 'crm-rv' && !routesGlue.includes("campaignsGate: requireEnabledFeature('email_marketing')")) fail('crm-rv routes/marketing.ts must gate campaigns and templates on email_marketing (campaignsGate)')
  const svcGlue = read(`templates/${t}/backend/src/services/marketing.ts`)
  if (!/from '\.\.\/middleware\/enabledFeature\.ts'/.test(svcGlue)) fail(`${t} services/marketing.ts must import isFeatureEnabled from the enabled-feature gate`)
  const wired = MARKETING_ARG[t]
    ? svcGlue.includes('isFeatureEnabled: (companyId, featureId) => isFeatureEnabled(companyId, featureId)') && svcGlue.includes(`sequencesEnabled: (companyId) => isFeatureEnabled(companyId, ${a})`)
    : /isFeatureEnabled \}\)/.test(svcGlue)
  if (!wired) fail(`${t} services/marketing.ts must pass isFeatureEnabled${MARKETING_ARG[t] ? ' (campaigns: the feature asked for) and sequencesEnabled for ' + a : ''}`)
  const shell = read(`templates/${t}/frontend/src/shellConfig.ts`)
  if (!shell.includes("to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing']")) fail(`${t} sidebar Marketing must gate on ['email_marketing']`)
  if (t === 'crm-rv' && !shell.includes("to: '/crm/marketing', icon: Send, label: 'Follow-Up', features: ['follow_up_sequences']")) fail('crm-rv sidebar must keep the Follow-Up item on follow_up_sequences')
}
const mktRoutes = mkt.slice(mkt.indexOf('export function createMarketingRoutes('))
if (!/if \(campaignsGate\) for \(const p of \['\/campaigns', '\/campaigns\/\*', '\/templates', '\/templates\/\*', '\/audience\/\*'\]\) app\.use\(p, campaignsGate\)/.test(mktRoutes)) fail('the shared marketing routes must apply campaignsGate to campaigns, templates and audience')
if (!/if \(sequencesEnabled \? !\(await sequencesEnabled\(e\.company_id\)\) : isFeatureEnabled && !\(await isFeatureEnabled\(e\.company_id, 'email_marketing'\)\)\) continue/.test(drips)) fail('processDripEmails must use sequencesEnabled when a template provides it')
{
  let gate = ''
  try { gate = read('packages/tenant-ui/src/shell/routeGate.ts') } catch { /* missing → fails below */ }
  if (!/samePath\.some\(\(i\) => \(i\.features \|\| \[\]\)\.some\(\(f\) => hasFeature\(f\)\)\)/.test(gate)) fail('the shell route gate (shell/routeGate.ts) must allow a path when any menu entry for it is enabled')
}
// events frontend: the route bounces too (the other templates rely on the shared shell's URL gate)
const app = read('templates/crm-restaurant/frontend/src/App.tsx')
if (!/<Route path="marketing" element=\{<FeatureGate feature="email_marketing"><MarketingPage \/><\/FeatureGate>\} \/>/.test(app)) fail('crm-restaurant App.tsx must gate /crm/marketing on email_marketing')
if (!/'\/crm\/marketing': \['email_marketing'\]/.test(read('templates/crm-restaurant/frontend/src/shellConfig.ts'))) fail('crm-restaurant routeGates must include /crm/marketing')

// a page that only looks up another module's data tolerates that module being switched off (403)
const TOLERANT: [string, RegExp][] = [
  ['packages/tenant-ui/src/recurring/RecurringForm.tsx', /api\.get\('\/api\/projects\?limit=200'\)\.catch\(\(\) => \(\{ data: \[\] \}\)\)/],
  ['templates/crm/frontend/src/pages/BillsPage.tsx', /api\.purchaseOrders\.list\(\{ limit: 100 \}\)\.catch\(\(\) => \(\{ data: \[\] \}\)\)/],
  ...['RFIsPage', 'DailyLogsPage', 'ChangeOrdersPage', 'PunchListsPage', 'InspectionsPage'].map((p): [string, RegExp] => [`templates/crm/frontend/src/pages/${p}.tsx`, /api\.projects\.list\(\{ limit: 100 \}\)\.catch\(\(\) => \(\{ data: \[\] \}\)\)/]),
  ...['AiaFormsPage', 'DrawSchedulesPage', 'LienWaiversPage', 'SubmittalsPage'].map((p): [string, RegExp] => [`templates/crm/frontend/src/pages/${p}.tsx`, /api\.get\('\/api\/projects'\)\.catch\(\(\) => \(\{ data: \[\] \}\)\)/]),
]
for (const [file, re] of TOLERANT) if (!re.test(read(file))) fail(`${file} must look up the other module's data tolerantly (.catch(() => ({ data: [] })))`)

if (failed) { console.error(`\nenabled-feature gates: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`enabled-feature gates: one shared gate (id or any-of list); ${TEMPLATES.length} templates wire it; ${Object.values(GATES).reduce((n, g) => n + g.length, 0)} mount gates before the mounts, none on a public-bearing family; email marketing gated in-route (links open), processor + sidebar honour the switch; cross-module lookups tolerant`)
