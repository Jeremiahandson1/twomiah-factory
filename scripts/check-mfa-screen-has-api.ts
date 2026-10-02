// CI guard: a template that SHOWS the two-factor card must mount the enrolment API and have the tables.
//
// WHY THIS EXISTS. I ported two-factor out of crm-dispensary into shared auth, wired crm, and stopped.
// The Two-Factor card is rendered by the SHARED SettingsPage (packages/tenant-ui/src/shell/
// SettingsPage.tsx), and eight templates use the 12-line wrapper around that page — so seven live
// tenants offered "Two-Factor Authentication / set up" on Settings → Security while
// /api/auth/mfa-devices/* answered 404. Verified on all ten test tenants: only ctrtest answered 200.
//
// Nobody reported it for the same reason nobody reports any of this class: the card renders, the page
// looks finished, and the failure only happens when a person actually clicks the button. It is the
// mirror image of the rule that an API needs a screen (#171/#172 gate the API and the nav together) —
// here the screen existed and the API did not.
//
// THREE THINGS ARE CHECKED, because any one of them alone is a half-shipped feature:
//
//   1. the mount        app.route('/api/auth/mfa-devices', mfaRoutes) in backend/src/index.ts
//   2. the wiring       backend/src/routes/mfa.ts calling createMfaRoutes with an issuer
//   3. the tables       mfa_devices + mfa_challenges in db/schema.ts — shared auth/mfa.ts asks
//                       information_schema for these and answers "no second factor" when absent, so
//                       without them the mount exists and enrolment still cannot work
//
// A template that does NOT show the card is not required to have any of it: crm-dispensary ships its
// own 1,210-line SettingsPage and crm-store its own, neither carrying the card, and crm-roof has no
// SettingsPage at all. Those are consistent, and the guard says so rather than silently passing them.
//
//   bun scripts/check-mfa-screen-has-api.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// PARKED templates are not modified anywhere in this repo, so they are not held to this either.
const PARKED = new Set(['crm-automotive', 'crm-homecare'])

/**
 * Does the SHARED SettingsPage actually render the card? If somebody removes it from there, this
 * guard would otherwise start demanding an API for a screen that no longer exists.
 */
const SHARED_SETTINGS = join(ROOT, 'packages/tenant-ui/src/shell/SettingsPage.tsx')
if (!existsSync(SHARED_SETTINGS)) {
  console.error('FAIL: packages/tenant-ui/src/shell/SettingsPage.tsx is missing — point this guard at the shared settings page')
  process.exit(1)
}
const sharedRendersCard = /<TwoFactorCard\b/.test(strip(readFileSync(SHARED_SETTINGS, 'utf8')))
if (!sharedRendersCard) {
  console.log('mfa screen/api: the shared SettingsPage no longer renders <TwoFactorCard> — nothing to hold templates to. If two-factor moved, retarget this guard.')
  process.exit(0)
}

const templates = readdirSync(join(ROOT, 'templates')).filter((d) => d.startsWith('crm') && !PARKED.has(d))
const offers: string[] = []
const consistent: string[] = []

/**
 * FIND THE SETTINGS PAGE WHEREVER IT IS. (T40)
 *
 * This looked only at `frontend/src/pages/SettingsPage.tsx`, so crm-roof — whose settings page lives
 * at `pages/settings/SettingsPage.tsx` — fell through to "no SettingsPage" and was EXCUSED from
 * needing two-factor. It has a 735-line settings screen and no two-factor at all, and the live
 * tenant confirmed it: /api/auth/mfa-devices/devices answered 404 on rooftest while the guard
 * reported the fleet clean.
 *
 * A guard that excuses a template because it could not find the file is worse than no guard: it
 * reports the absence as a deliberate choice. So the search is widened, and a template with no
 * settings page ANYWHERE is now reported as that — not quietly waved through.
 */
const findSettings = (tpl: string): string | null => {
  const base = join(ROOT, 'templates', tpl, 'frontend/src')
  const hits: string[] = []
  const walk = (d: string) => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|shared|dist/.test(e.name)) walk(p) }
      else if (/^SettingsPage\.tsx$/.test(e.name)) hits.push(p)
    }
  }
  walk(base)
  return hits[0] ?? null
}

for (const tpl of templates) {
  const settings = findSettings(tpl)
  if (!settings) { consistent.push(`${tpl} (no SettingsPage anywhere under frontend/src)`); continue }
  const sp = readFileSync(settings, 'utf8')

  /**
   * The card reaches a template one of two ways: the wrapper that re-exports the shared page, or a
   * direct <TwoFactorCard> in the template's own page. A template with its OWN settings page and no
   * card does not offer two-factor and is not required to mount it.
   */
  const viaShared = /from '\.\.\/shared'/.test(sp)
  const direct = /TwoFactorCard/.test(strip(sp))
  if (!viaShared && !direct) { consistent.push(`${tpl} (own settings page, no card)`); continue }
  offers.push(tpl)

  const B = join(ROOT, 'templates', tpl, 'backend')
  const how = viaShared ? 'the shared SettingsPage' : 'its own SettingsPage'

  // 1. the mount
  const indexPath = join(B, 'src/index.ts')
  const indexSrc = existsSync(indexPath) ? strip(readFileSync(indexPath, 'utf8')) : ''
  if (!/app\.route\(\s*'\/api\/auth\/mfa-devices'/.test(indexSrc)) {
    fail(`${tpl}: offers the Two-Factor card (via ${how}) but backend/src/index.ts never mounts it — every enrolment request answers 404. Add app.route('/api/auth/mfa-devices', mfaRoutes).`)
  }

  // 2. the wiring
  const routePath = join(B, 'src/routes/mfa.ts')
  if (!existsSync(routePath)) {
    fail(`${tpl}: offers the Two-Factor card but has no backend/src/routes/mfa.ts to wire createMfaRoutes into`)
  } else {
    const r = strip(readFileSync(routePath, 'utf8'))
    if (!/createMfaRoutes\(/.test(r)) fail(`${tpl}: backend/src/routes/mfa.ts does not call createMfaRoutes`)
    // The issuer is what the person sees in their authenticator app next to the code. An empty one
    // leaves them with an unlabelled entry they cannot tell from any other.
    if (!/issuer:\s*'[^']+'/.test(r)) fail(`${tpl}: backend/src/routes/mfa.ts has no non-empty issuer — the authenticator app would list an unlabelled entry`)
  }

  // 3. the tables — the actual feature switch
  const schemaPath = join(B, 'db/schema.ts')
  const schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : ''
  for (const table of ['mfa_devices', 'mfa_challenges']) {
    if (!new RegExp(`pgTable\\('${table}'`).test(schema)) {
      fail(`${tpl}: db/schema.ts declares no pgTable('${table}'). shared auth/mfa.ts asks information_schema for this table and answers "no second factor" when it is absent, so the mount alone does not switch two-factor on — and db/reconcile.ts creates the table from this declaration at boot.`)
    }
  }
}

if (!offers.length) {
  console.error('FAIL: no template offers the Two-Factor card, yet the shared SettingsPage renders it — the detection above is wrong, not the fleet')
  process.exit(1)
}

if (failed) {
  console.error(`\nmfa screen/api: ${failed} problem(s) across ${offers.length} template(s) offering two-factor.`)
  process.exit(1)
}
console.log(`mfa screen/api: ${offers.length} template(s) offer the Two-Factor card and all of them mount the enrolment API, wire an issuer and declare both tables (${offers.join(', ')}); ${consistent.length} offer neither: ${consistent.join(', ')}`)
