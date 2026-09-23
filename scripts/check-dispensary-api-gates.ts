// A dispensary module the sidebar hides is refused by the API too — and a switch in the catalog
// actually switches something.
//
// With digital_signage, curbside and training_lms switched off, the nav items disappeared and the
// pages said "isn't part of this CRM" — while /api/signage/screens, /api/curbside/stats and
// /api/training/courses each answered 200 with real data. A UI that hides a page the API still serves
// is a paywall made of CSS. (Dispensary T29 M5.)
//
// Then T31 found three more — Kiosk, Loyalty and Cash Management — switched off and still working.
// The M5 fix was built from the SIDEBAR, and those three have no nav entry keyed to their feature, so
// mirroring the menu could never have covered them. Three checks now, because the first one asks a
// question too narrow to have caught the second:
//
//   1. every `features: [...]` entry in the sidebar has a matching requireEnabledFeature mount
//   2. the page behind that entry gets its data from a gated family — /crm/soc2 reads
//      /api/compliance-controls, so comparing the two lists by NAME saw nothing to compare
//   3. every non-core feature this template sells is enforced SOMEWHERE server-side, because the
//      registry — not the menu — is the list of what an operator can switch off
//
//   bun run scripts/check-dispensary-api-gates.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const NAV = join(ROOT, 'templates/crm-dispensary/frontend/src/components/layout/AppLayout.tsx')
const APP = join(ROOT, 'templates/crm-dispensary/frontend/src/App.tsx')
const PAGES = join(ROOT, 'templates/crm-dispensary/frontend/src/pages')
const INDEX = join(ROOT, 'templates/crm-dispensary/backend/src/index.ts')
const ROUTES = join(ROOT, 'templates/crm-dispensary/backend/src/routes')
const REGISTRY = join(ROOT, 'packages/tenant-backend/src/featureRegistry.ts')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

if (!existsSync(NAV) || !existsSync(INDEX)) {
  console.log('crm-dispensary not present — nothing to check'); process.exit(0)
}

const nav = readFileSync(NAV, 'utf8')
const index = readFileSync(INDEX, 'utf8')

// Routes the sidebar gates, and on what. `to: '/crm/x' ... features: ['a', 'b']`
// The character class allows digits: `/crm/soc2` matched nothing while it was [a-z-]+, so the one
// entry whose API this guard could not see was also the one entry it never read. (T31)
const navGates = new Map<string, string[]>()
for (const m of nav.matchAll(/to: '\/crm\/([a-z0-9-]+)'[^}]*?features: \[([^\]]*)\]/g)) {
  const feats = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])
  if (feats.length) navGates.set(m[1], feats)
}
if (navGates.size < 20) fail(`only ${navGates.size} gated nav entries found — the sidebar's shape changed and this guard can no longer read it`)

// Gates mounted on the API. `app.use('/api/x', authenticate, requireEnabledFeature('a'))`
const apiGates = new Map<string, string[]>()
for (const m of index.matchAll(/app\.use\('\/api\/([a-z0-9-]+)',\s*authenticate,\s*requireEnabledFeature\(([^)]*)\)\)/g)) {
  const feats = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])
  if (feats.length) apiGates.set(m[1], feats)
}

// The kiosk is public by design — a customer at a tablet, no user to authenticate — and carries its
// own feature + paired-device gate inside kiosk.ts instead. Anything else the nav gates, the API must gate.
const NOT_API_GATED = new Set([
  'kiosk',        // gated inside kiosk.ts: requireDevice + kioskModuleOn on the public half, requireEnabledFeature on the manager half
  'email',        // branded_email: gated inside its own routes so public unsubscribe/tracking stay open
  'google-reviews', // gbp routes carry public callback endpoints
])

// ---- 1. the menu and the API agree ----
for (const [route, feats] of navGates) {
  if (NOT_API_GATED.has(route)) continue
  const mounted = apiGates.get(route)
  if (!mounted) {
    // An /api/<same-name> that is mounted and ungated is the M5 defect exactly. A nav entry with no
    // same-named family is a name mismatch instead — check 2 below is what covers those.
    if (index.includes(`app.route('/api/${route}'`)) {
      fail(`the sidebar hides /crm/${route} behind ${feats.join(" or ")}, but /api/${route} is mounted with no requireEnabledFeature — the page is hidden and the data is not`)
    }
    continue
  }
  const missing = feats.filter(f => !mounted.includes(f))
  const extra = mounted.filter(f => !feats.includes(f))
  if (missing.length) fail(`/api/${route} does not accept ${missing.join(', ')}, which the sidebar treats as unlocking /crm/${route} — the menu offers a page the API refuses`)
  if (extra.length) fail(`/api/${route} unlocks on ${extra.join(', ')}, which the sidebar does not — the API is more generous than the menu`)
}

// ---- 2. the page behind a gated entry reads from a gated family ----
// Not "every family the page calls is gated" — every one of these pages also reads products, contacts
// or team, and those are core. The question is whether ANY of the page's data sits behind the switch.
// If none of it does, the nav gate is decoration: hiding the link while the data stays served.
// A page that is only a different VIEW of core data has nothing of its own to gate, and gating what it
// reads would take the core away from everyone. The switch still earns its place — it decides whether
// the shop gets the view — but there is no server-side half to match, and pretending otherwise would
// mean putting a feature gate on /api/products.
const VIEWS_OF_CORE_DATA: Record<string, string> = {
  merch: 'the merch store is the product catalog filtered to merch — /api/products and /api/orders are core and readable from Products anyway',
}
const app = existsSync(APP) ? readFileSync(APP, 'utf8') : ''
const pageFiles = existsSync(PAGES) ? readdirSync(PAGES).filter(f => f.endsWith('.tsx')) : []
for (const [route, feats] of navGates) {
  if (NOT_API_GATED.has(route) || VIEWS_OF_CORE_DATA[route]) continue
  const rm = new RegExp(`<Route path="${route}"[^>]*element=\\{<(\\w+)`).exec(app)
  if (!rm) continue                     // not a routed page (external link, redirect)
  const file = pageFiles.find(f => f === rm[1] + '.tsx')
  if (!file) continue
  const src = readFileSync(join(PAGES, file), 'utf8')
  const fams = [...new Set([...src.matchAll(/['"`]\/api\/([a-z0-9-]+)/g)].map(m => m[1]))]
  if (!fams.length) continue            // a page with no API of its own
  const behindTheSwitch = fams.some(f => apiGates.get(f)?.some(x => feats.includes(x)))
  if (!behindTheSwitch) {
    fail(`/crm/${route} is hidden behind ${feats.join(' or ')}, but ${rm[1]} reads ${fams.map(f => '/api/' + f).join(', ')} and none of those is gated on it — the link disappears and the data does not`)
  }
}

// ---- 3. every switch this template sells is wired to something ----
// A feature in the registry is a switch in the operator's Settings. If nothing server-side asks about
// it, the switch is decorative: it moves, and the product does not change. That is what T31 found on
// three modules at once, and the only way to see it is to start from the registry.
const registry = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : ''
const sold: string[] = []
for (const m of registry.matchAll(/\{ id: '([a-z0-9_]+)',[^}]*?core: (true|false),[^}]*?templates: \[([^\]]*)\]/g)) {
  if (m[2] === 'true') continue
  if (!m[3].includes('crm-dispensary')) continue
  sold.push(m[1])
}

// Sold in the catalog, implemented nowhere: no route, no page, no check. These are not gating bugs —
// there is nothing to gate — they are product gaps, and they are listed here so the difference stays
// visible instead of being discovered by a customer who paid for one. Delete an entry when the feature
// is built (the guard will then require it to be enforced) or when it leaves the registry.
const NOT_BUILT: Record<string, string> = {
  two_way_texting: 'no unified-inbox surface in this template; /api/sms is transactional sends, which every shop gets',
  sms_marketing: 'no campaign surface — /api/marketing has no sms campaign type here',
  email_campaigns: 'no campaign surface — /api/marketing has no email campaign type here',
  order_ahead: 'no online-ordering surface; /api/public/menu is a read-only menu',
  dispensary_analytics: 'the Analytics page is core in this template and /api/analytics is not sold separately',
  pin_login: 'no PIN credential on the user table and no PIN endpoint on /api/auth',
  tip_management: 'orders carry no tip column and no tip is collected anywhere',
  budtender_performance: 'no per-budtender attribution surface; sales are not attributed to a user',
  lab_testing: 'no CoA import or lab-result surface on products or compliance',
  open_api: 'no published OpenAPI document is served',
  ach_payments: 'no ACH path; /api/pay-by-bank is its own feature (pay_by_bank)',
}

for (const f of sold) {
  if (NOT_BUILT[f]) continue
  const wired = readdirSync(ROUTES).filter(x => x.endsWith('.ts'))
    .map(x => readFileSync(join(ROUTES, x), 'utf8')).concat(index)
    .some(src => new RegExp(`(requireEnabledFeature|isFeatureEnabled)\\([^)]*'${f}'`).test(src))
  if (!wired) fail(`'${f}' is sold to dispensaries and nothing server-side asks whether it is on — the switch moves and the product does not change`)
}
for (const f of Object.keys(NOT_BUILT)) {
  if (!sold.includes(f)) fail(`'${f}' is listed here as not-built but is no longer a non-core crm-dispensary feature — remove the entry`)
}

// A gate on the collection but not its children leaves every sub-path open.
for (const [route] of apiGates) {
  if (!index.includes(`app.use('/api/${route}/*'`)) {
    fail(`/api/${route} is gated but /api/${route}/* is not — every sub-path stays open`)
  }
}

console.log(failures
  ? `\n${failures} problem(s).`
  : `crm-dispensary: ${apiGates.size} API gates; ${sold.length - Object.keys(NOT_BUILT).length} of ${sold.length} sold features enforced, ${Object.keys(NOT_BUILT).length} not built`)
process.exit(failures ? 1 : 0)
