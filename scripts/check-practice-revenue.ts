// CI guard: the business's takings, as one figure, ask revenue:read. (T62; owner's decision 2026-10-09)
//
//   "Staff can see practice money through /api/invoices/stats and the dashboard revenue tile, even
//    though Reports is refused for them."  → vet staff do not see practice revenue.
//
// The vet gives its staff invoices:read so they can bill a visit, and the totals asked only that. Rules:
//   · GET /api/invoices/stats asks invoices:read AND revenue:read
//   · revenue:read is on admin's, manager's and viewer's rows (so no other vertical changes), not field's,
//     and the vet grants it to nobody as an extra
//   · the vet dashboard's three revenue figures are returned only when the caller holds revenue:read,
//     and the tile does not draw the money line when they are withheld
//   bun scripts/check-practice-revenue.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const uncomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
const stats = /app\.get\('\/stats',\s*([^\n]*?)async/.exec(inv)
if (!stats) fail('invoices.ts: GET /stats not found — if it moved, this guard must follow it')
else {
  const asked = [...stats[1].matchAll(/requirePermission\('([^']+)'\)/g)].map((m) => m[1]).sort().join(',')
  if (asked !== 'invoices:read,revenue:read') fail(`invoices.ts: GET /stats asks [${asked}] — it must ask invoices:read AND revenue:read`)
}

const m = read('packages/tenant-backend/src/auth/permissions.ts')
const row = (role: string) => { const at = m.indexOf(`\n  ${role}: [`); return at < 0 ? null : uncomment(m.slice(at, m.indexOf('\n  ],', at))) }
for (const role of ['admin', 'manager', 'viewer']) if (!/'revenue:(read|\*)'/.test(row(role) || '')) fail(`permissions.ts: ${role} lacks revenue:read — that seat read the totals before T62 and must still`)
if (/'revenue:/.test(row('field') || '')) fail('permissions.ts: field holds revenue:read — vet staff (field) must not see practice revenue')
const vetPerm = uncomment(read('templates/crm-vet/backend/src/middleware/permissions.ts'))
if (/'revenue:/.test(vetPerm)) fail('crm-vet permissions.ts grants revenue:* as an extra — vet staff do not see practice revenue')

const dash = read('templates/crm-vet/backend/src/routes/dashboard.ts')
if (!/const maySeeRevenue = hasPermission\(user_\?\.role, 'revenue:read', await getExtraPermissions\(user_\?\.userId\)\)/.test(dash)) fail("crm-vet dashboard.ts: maySeeRevenue must ask hasPermission(…, 'revenue:read', extras)")
const ret = /visits: maySeeRevenue\n\s*\? \{[^}]*revenueThisMonth[^}]*\}\n\s*: \{([^}]*)\}/.exec(dash)
if (!ret) fail('crm-vet dashboard.ts: the visits figures are not chosen by maySeeRevenue')
else if (/revenue(ThisMonth)?\b|unbilled|scheduled/.test(ret[1].replace('revenueWithheld', ''))) fail(`crm-vet dashboard.ts: the withheld branch still carries a figure: {${ret[1]}}`)
const tile = read('templates/crm-vet/frontend/src/pages/vet/DashboardPage.tsx')
if (!/\{!visits\.revenueWithheld && \(\n[^\n]*\n[^\n]*\n\s*\{money\(visits\.revenueThisMonth\)\} billed/.test(tile)) fail('crm-vet DashboardPage.tsx: the "billed" line is drawn without checking revenueWithheld — it would print $0.00')

if (failed) { console.error(`\npractice revenue: ${failed} check(s) FAILED`); process.exit(1) }
console.log('practice revenue: the totals ask revenue:read, every seat that read them still does, and vet staff are not handed them')
