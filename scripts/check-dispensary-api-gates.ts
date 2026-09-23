// A dispensary module the sidebar hides is refused by the API too.
//
// With digital_signage, curbside and training_lms switched off, the nav items disappeared and the
// pages said "isn't part of this CRM" — while /api/signage/screens, /api/curbside/stats and
// /api/training/courses each answered 200 with real data. A UI that hides a page the API still serves
// is a paywall made of CSS. (Dispensary T29 M5.)
//
// The nav had gated these families for a long time; the routes never were. Nothing could notice,
// because the two lists live in different files in different languages. This makes them one fact:
// every `features: [...]` entry in the sidebar must have a matching requireEnabledFeature mount, on
// the same feature keys.
//
//   bun run scripts/check-dispensary-api-gates.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const NAV = join(ROOT, 'templates/crm-dispensary/frontend/src/components/layout/AppLayout.tsx')
const INDEX = join(ROOT, 'templates/crm-dispensary/backend/src/index.ts')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

if (!existsSync(NAV) || !existsSync(INDEX)) {
  console.log('crm-dispensary not present — nothing to check'); process.exit(0)
}

const nav = readFileSync(NAV, 'utf8')
const index = readFileSync(INDEX, 'utf8')

// Routes the sidebar gates, and on what. `to: '/crm/x' ... features: ['a', 'b']`
const navGates = new Map<string, string[]>()
for (const m of nav.matchAll(/to: '\/crm\/([a-z-]+)'[^}]*?features: \[([^\]]*)\]/g)) {
  const feats = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])
  if (feats.length) navGates.set(m[1], feats)
}
if (navGates.size < 20) fail(`only ${navGates.size} gated nav entries found — the sidebar's shape changed and this guard can no longer read it`)

// Gates mounted on the API. `app.use('/api/x', authenticate, requireEnabledFeature('a'))`
const apiGates = new Map<string, string[]>()
for (const m of index.matchAll(/app\.use\('\/api\/([a-z-]+)',\s*authenticate,\s*requireEnabledFeature\(([^)]*)\)\)/g)) {
  const feats = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])
  if (feats.length) apiGates.set(m[1], feats)
}

// The kiosk is public by design — a customer at a tablet, no user to authenticate — and carries its
// own paired-device gate instead. Anything else the nav gates, the API must gate.
const NOT_API_GATED = new Set([
  'kiosk',        // public routes + paired-device gate (kiosk.ts requireDevice)
  'email',        // branded_email: gated inside its own routes so public unsubscribe/tracking stay open
  'google-reviews', // gbp routes carry public callback endpoints
])

for (const [route, feats] of navGates) {
  if (NOT_API_GATED.has(route)) continue
  const mounted = apiGates.get(route)
  if (!mounted) {
    fail(`the sidebar hides /crm/${route} behind ${feats.join(' or ')}, but /api/${route} has no requireEnabledFeature — the page is hidden and the data is not`)
    continue
  }
  const missing = feats.filter(f => !mounted.includes(f))
  const extra = mounted.filter(f => !feats.includes(f))
  if (missing.length) fail(`/api/${route} does not accept ${missing.join(', ')}, which the sidebar treats as unlocking /crm/${route} — the menu offers a page the API refuses`)
  if (extra.length) fail(`/api/${route} unlocks on ${extra.join(', ')}, which the sidebar does not — the API is more generous than the menu`)
}

// A gate on the collection but not its children leaves every sub-path open.
for (const [route] of apiGates) {
  if (!new RegExp(`app\\.use\\('/api/${route}/\\*'`).test(index)) {
    fail(`/api/${route} is gated but /api/${route}/* is not — every sub-path stays open`)
  }
}

console.log(failures
  ? `\n${failures} problem(s).`
  : `crm-dispensary: ${apiGates.size} API gates, matching every gated nav entry`)
process.exit(failures ? 1 : 0)
