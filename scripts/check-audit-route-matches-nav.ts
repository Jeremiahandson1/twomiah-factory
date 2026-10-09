// CI guard: the audit log is the owner's and the admins', on the server AND in the menu.
//
// T58 lined the two sides up on reports:read, which a manager holds. Then the owner decided
// (2026-10-09): only owners and admins see the audit log — it carries everybody's sign-ins, IP
// addresses and two-factor changes, not only the business's records. So it has its own permission,
// audit:read, granted to admin and nobody else (owner holds '*').
//
// For every template that mounts the audit route:
//   · every GET under /api/audit asks requirePermission('audit:read'), after authenticate, never a rank;
//   · the Audit Log nav link asks permission 'audit:read' — the same question, so the menu cannot offer
//     a page the server refuses, or hide one it would serve.
// And in every permission matrix (the shared one and the dispensary fork): no role below admin holds
// audit:read or audit:*, and nothing grants a read-everything wildcard that would match it.
//   bun scripts/check-audit-route-matches-nav.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') : '')
const TEMPLATES = ['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-restaurant', 'crm-salon', 'crm-vet', 'crm-roof']
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

for (const t of TEMPLATES) {
  const route = read(`templates/${t}/backend/src/routes/audit.ts`)
  if (!route) { fail(`${t}: routes/audit.ts is missing`); continue }
  const gets = [...route.matchAll(/app\.get\('([^']+)',\s*([^,]+),/g)]
  if (gets.length < 3) fail(`${t}: expected the list, one record's history and the filters (found ${gets.length} GET routes)`)
  for (const g of gets) if (!/requirePermission\('audit:read'\)/.test(g[2])) fail(`${t}: GET /api/audit${g[1] === '/' ? '' : g[1]} must ask requirePermission('audit:read') — it asks ${g[2].trim()}`)
  if (/requireRole\(/.test(route)) fail(`${t}: the audit route must not gate on a rank (requireRole)`)
  if (!/app\.use\('\*', authenticate\)/.test(route)) fail(`${t}: the audit route must authenticate before it authorizes`)

  const nav = read(`templates/${t}/frontend/src/shellConfig.ts`) + read(`templates/${t}/frontend/src/components/layout/AppLayout.tsx`)
  const link = nav.split('\n').find((l) => l.includes("'/crm/audit'") && /label:/.test(l))
  if (!link) fail(`${t}: no Audit Log link in the nav`)
  else if (!/permission: 'audit:read'/.test(link)) fail(`${t}: the Audit Log link must ask the route's permission, audit:read — ${link.trim()}`)
}

// The dispensary forks the route, the matrix and the nav.
{
  const route = read('templates/crm-dispensary/backend/src/routes/audit.ts')
  if (!/app\.use\('\*', authenticate\)\n[\s\S]*?app\.use\('\*', requirePermission\('audit:read'\)\)/.test(route)) fail("crm-dispensary: the audit route must authenticate, then ask requirePermission('audit:read')")
  if (/requireRole\(/.test(route.replace(/\/\/[^\n]*/g, ''))) fail('crm-dispensary: the audit route must not gate on a rank')
  const nav = read('templates/crm-dispensary/frontend/src/components/layout/AppLayout.tsx').split('\n').find((l) => l.includes("'/crm/audit'") && /label:/.test(l)) || ''
  if (!/minRole: 'admin'/.test(nav)) fail(`crm-dispensary: the Audit Log link must be admin and up — ${nav.trim()}`)
  const order = read('templates/crm-dispensary/frontend/src/pages/OrderDetailPage.tsx')
  if (!/isAdmin \? api\.get\('\/api\/audit'/.test(order) || !/\{isAdmin && \(<div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">/.test(order)) fail("crm-dispensary: the order page's Audit Trail must be fetched and shown only for owners and admins")
}

// No role below admin holds it, in either matrix.
const roleLists = (src: string) => {
  const out: Record<string, string> = {}
  // A role's list is either on one line (`  owner: ['*'],`) or opens a line and closes on its own
  // two-space `  ],` line. The first form must be tried first, or `owner` swallows `admin` whole.
  for (const m of src.matchAll(/^ {2}(\w+): \[([^\n]*)\],?$|^ {2}(\w+): \[\n([\s\S]*?)^ {2}\],?$/gm)) {
    out[m[1] ?? m[3]] = (m[2] ?? m[4]).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
  }
  return out
}
for (const [label, file] of [['shared', 'packages/tenant-backend/src/auth/permissions.ts'], ['crm-dispensary', 'templates/crm-dispensary/backend/src/middleware/permissions.ts']] as const) {
  const lists = roleLists(read(file))
  if (!lists.admin || !/'audit:(read|\*)'/.test(lists.admin)) fail(`${label}: admin must hold audit:read`)
  for (const [role, body] of Object.entries(lists)) {
    if (role === 'owner' || role === 'admin') continue
    if (/'audit:(read|\*)'/.test(body)) fail(`${label}: ${role} holds audit access — the audit log is owners and admins only`)
    if (/'\*'|'\*:read'/.test(body)) fail(`${label}: ${role} holds a wildcard that would match audit:read`)
  }
  if (Object.keys(lists).length < 4) fail(`${label}: found only ${Object.keys(lists).length} role lists — the parse is not reading this matrix`)
}

if (failed) { console.error(`\naudit route vs nav: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`audit route vs nav: ${TEMPLATES.length} templates + dispensary ask audit:read on both sides; no role below admin holds it`)
