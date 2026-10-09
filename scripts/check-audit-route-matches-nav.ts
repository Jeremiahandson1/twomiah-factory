// CI guard: the Audit Log link and the API behind it ask the SAME question. (T59)
//
// Eight templates showed the sidebar's Audit Log to reports:read — a manager holds it — while
// GET /api/audit asked requireRole('admin'). So a manager was offered a page that answered 403, and the
// nav's own comment said "the same permission the /api/audit route requires". The route now asks
// requirePermission('reports:read'); this keeps the two from drifting apart again, and keeps the route
// on a permission rather than a rank.
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
  for (const g of gets) if (!/requirePermission\('reports:read'\)/.test(g[2])) fail(`${t}: GET /api/audit${g[1] === '/' ? '' : g[1]} must ask requirePermission('reports:read') — it asks ${g[2].trim()}`)
  if (/requireRole\(/.test(route)) fail(`${t}: the audit route must not gate on a rank (requireRole)`)
  if (!/app\.use\('\*', authenticate\)/.test(route)) fail(`${t}: the audit route must authenticate before it authorizes`)

  const nav = read(`templates/${t}/frontend/src/shellConfig.ts`) + read(`templates/${t}/frontend/src/components/layout/AppLayout.tsx`)
  const link = nav.split('\n').find((l) => l.includes("'/crm/audit'"))
  if (!link) fail(`${t}: no Audit Log link in the nav`)
  else if (!/permission: 'reports:read'/.test(link)) fail(`${t}: the Audit Log link must ask the route's permission, reports:read — ${link.trim()}`)
}

if (failed) { console.error(`\naudit route vs nav: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`audit route vs nav: ${TEMPLATES.length} templates ask reports:read on both sides`)
