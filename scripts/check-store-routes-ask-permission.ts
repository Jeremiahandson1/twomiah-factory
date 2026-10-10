// CI guard: every crm-store write asks a permission. (Owner's decision, 2026-10-10: owner / manager / staff)
//
// The store shipped with two roles and gated on RANK — requireOwner on a handful of routes and nothing but
// `authenticate` on the rest — so a member of staff could refund an order and put its stock back, delete
// the catalogue and write discount codes, and there was no seat between them and the owner. It now runs
// the fleet's matrix (backend/src/middleware/permissions.ts). This holds it there:
//
//   1. No rank gates. requireOwner / requireRole( / minRole are gone from the store; a rank cannot say
//      "manager yes, staff no" for one action and the opposite for the next.
//   2. Every POST / PUT / PATCH / DELETE a signed-in session reaches carries requirePermission or
//      requireAnyPermission — on the route itself, or on its router's `use('*', …)` when that mount asks
//      for something more than `:read`. A mount on `orders:read` lets staff read; it says nothing about
//      who may refund.
//
// Exempt, by file and with the reason, because a permission would be the wrong question there:
const EXEMPT: Record<string, string> = {
  'routes/auth.ts': 'sign-in, refresh, password reset and changing your OWN password — the caller is proving who they are',
  'routes/public.ts': 'the storefront: guest checkout, payment and supplier webhooks, shopper reviews — no seat at all',
  'routes/inboundParse.ts': 'the inbound-email hook, authenticated by its own key, not a session',
  'routes/onboarding.ts': 'POST /complete clears the first-run flag; gating it makes a non-owner loop on the wizard for ever (check-write-routes-authorise.ts)',
  'routes/inboundMessages.ts': 'the shared inbox, open to every seat on purpose — answering a customer is the work (check-write-routes-authorise.ts)',
  'routes/platformSupport.ts': 'raising a ticket with Twomiah — how anyone in the shop gets help',
}
//
//   bun scripts/check-store-routes-ask-permission.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'templates/crm-store/backend/src')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

const files: string[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'shared' || e === 'node_modules') continue // the vendored package is checked by the fleet guards
    if (statSync(p).isDirectory()) walk(p)
    else if (e.endsWith('.ts')) files.push(p)
  }
}
walk(SRC)

const PERMISSION = /require(?:Any)?Permission\(/
let writes = 0, gated = 0, exemptWrites = 0
for (const path of files) {
  const rel = path.slice(SRC.length + 1).replace(/\\/g, '/')
  const src = strip(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))

  // 1. rank gates
  for (const [re, what] of [[/\brequireOwner\b/, 'requireOwner'], [/\brequireRole\s*\(/, 'requireRole('], [/\bminRole\b/, 'minRole']] as const) {
    if (rel === 'middleware/permissions.ts') continue // re-exports the shared module's names; uses none of them
    if (re.test(src)) fail(`${rel}: uses ${what} — a rank is not a permission. Gate on requirePermission('resource:action') from middleware/permissions.ts`)
  }

  // 2. every write asks
  const mounts = new Map<string, string>() // router var → the middleware text of its use('*', …)
  for (const m of src.matchAll(/^(\w+)\.use\(\s*'\*'\s*,([^\n]*)\)/gm)) mounts.set(m[1], m[2])
  for (const m of src.matchAll(/^(\w+)\.(post|put|patch|delete)\(\s*'([^']*)'\s*,([^\n]*?)async\b/gm)) {
    const [, router, verb, route, inline] = m
    writes++
    if (rel in EXEMPT) { exemptWrites++; continue }
    const mount = mounts.get(router) || ''
    // A mount asking only `:read` does not authorise a write; one asking for more (settings:update,
    // integrations:update) gates the whole module and does.
    const mountAuthorises = PERMISSION.test(mount) && !/Permission\(\s*'[a-z-]+:read'\s*\)/.test(mount)
    if (PERMISSION.test(inline) || mountAuthorises) { gated++; continue }
    fail(`${rel}: ${verb.toUpperCase()} ${route} on '${router}' asks no permission (${(inline.trim() || 'nothing on the route').slice(0, 60)}; mount: ${mount.trim() || 'none'}) — any signed-in seat can drive it`)
  }
}
for (const rel of Object.keys(EXEMPT)) {
  if (!files.some((f) => f.replace(/\\/g, '/').endsWith('/' + rel))) fail(`EXEMPT names ${rel}, which no longer exists — delete the line`)
}
if (writes < 40) fail(`only ${writes} write routes found under templates/crm-store/backend/src — the walk or the route pattern is stale`)

if (failed) { console.error(`\nstore routes: ${failed} problem(s)`); process.exit(1) }
console.log(`store routes: ${gated} write routes ask a permission, ${exemptWrites} exempt by file (${Object.keys(EXEMPT).length} files, each with its reason), no rank gates`)
