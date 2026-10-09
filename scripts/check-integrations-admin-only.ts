// CI guard: the shop's integrations are the owner's and the admins', on every CRM. (T60)
//
//   "Dispensary: the manager can read the Stripe account ID and get a live Stripe Connect setup link.
//    /api/integrations/status and /stripe/connect-url both return 200. Every other tenant correctly
//    refuses these with 403."
//
// Every other CRM runs packages/tenant-backend/src/integrations/integrations.ts, where every control
// is requireAdmin. crm-dispensary forks it, and its copy said "manager and up" — and its QuickBooks
// auth-url had no role gate at all. The rule is checked over BOTH files, route by route:
//   every route a signed-in session reaches carries requireAdmin. Exempt only routes that no session
//   reaches: the OAuth callback (Intuit calls it) and the external-POS routes (integration key).
//   bun scripts/check-integrations-admin-only.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const CONTROLS = ['/status', '/quickbooks/auth-url', '/quickbooks/disconnect', '/quickbooks/sync', '/stripe/connect-url', '/stripe/disconnect', '/sms/toggle', '/email/toggle']

for (const [file, prefix] of [
  ['packages/tenant-backend/src/integrations/integrations.ts', '  app'],
  ['templates/crm-dispensary/backend/src/routes/integrations.ts', 'app'],
] as const) {
  const src = read(file)
  const routes = [...src.matchAll(/^\s*app\.(get|post|put|patch|delete)\('([^']+)',\s*([^\n]*?)async/gm)]
  if (routes.length < 8) fail(`${file}: only ${routes.length} routes found — the walk is not reading this file`)
  for (const [, verb, path, mw] of routes) {
    if (/callback$/.test(path)) { if (/authenticate/.test(mw)) fail(`${file} ${path}: the OAuth callback is called by the provider, not a session`); continue }
    if (/requireIntegrationKey/.test(mw)) continue // external POS, keyed — never a browser session
    if (!/requireAdmin/.test(mw)) fail(`${file}: ${verb.toUpperCase()} ${path} is reachable below admin (${mw.trim() || 'no gate'}) — the shop's integrations are owner/admin on every CRM`)
    if (/requireRole\(/.test(mw)) fail(`${file}: ${verb.toUpperCase()} ${path} gates on requireRole — mirror the fleet: requireAdmin`)
  }
  for (const c of CONTROLS) if (!routes.some((r) => r[2] === c)) fail(`${file}: ${c} not found — if it moved, this guard must follow it`)
}

if (failed) { console.error(`\nintegrations: ${failed} check(s) FAILED`); process.exit(1) }
console.log('integrations: every session-reachable integration control is owner/admin, in the shared route and the dispensary fork')
