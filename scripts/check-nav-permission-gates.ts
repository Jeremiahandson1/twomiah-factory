// CI guard: the sidebar does not offer a page the signed-in person will be refused.
//
// "Staff: every module is in the nav, including Invoices, Quotes, Reports, Team, Marketing and Settings.
// Invoices, Quotes and Marketing open as empty lists with New Invoice / New Quote / New Campaign buttons
// (they look like 'no data', not 'no access')." — Field Service T30 M-R1
//
// A menu built from features alone answers a question about the COMPANY: does this tenant have the module.
// Whether this PERSON may use it is a different question, and Salon T28 M5 answered it with a rank, which
// is a third thing again: `viewer` outranks nobody and holds invoices:read, so minRole: 'manager' on
// Invoices hides the page from someone the API serves happily. Permission is the question the server asks,
// so it is the question the menu has to ask.
//
// Nothing here is hand-maintained. The guard reads the role matrix out of the shared permissions module
// and the required permission out of each module's own list route, and then insists: if a page's API needs
// a permission that a rung of the hierarchy does NOT hold, that vertical's nav entry has to declare it.
// A page whose read is open to everyone is left alone — a technician needs the price list and the parts
// list, and hiding those is the more expensive mistake.
//
//   bun scripts/check-nav-permission-gates.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']

/**
 * Sidebar route → the module whose list route it opens. `{t}` is the template, for families a vertical
 * owns itself. Only routes that lead to a guarded list need to be here; anything absent is simply not
 * checked, and a page whose read is ungated is skipped below anyway.
 */
const PAGE_MODULE: Record<string, string> = {
  '/crm/contacts': 'packages/tenant-backend/src/contacts/contacts.ts',
  '/crm/jobs': 'packages/tenant-backend/src/jobs/jobs.ts',
  '/crm/quotes': 'packages/tenant-backend/src/invoicing/quotes.ts',
  '/crm/invoices': 'packages/tenant-backend/src/invoicing/invoices.ts',
  '/crm/team': 'packages/tenant-backend/src/team/team.ts',
  '/crm/time': 'packages/tenant-backend/src/time/time.ts',
  '/crm/expenses': 'packages/tenant-backend/src/expenses/expenses.ts',
  '/crm/recurring': 'packages/tenant-backend/src/recurring/recurring.ts',
  '/crm/leads': 'packages/tenant-backend/src/leads/leads.ts',
}
/** Modules whose guard is not on `app.get('/')` — the permission is named where the routes are built. */
const PAGE_GUARD_DECL: Record<string, [string, RegExp]> = {
  '/crm/reports': ['packages/tenant-backend/src/reporting/reporting.ts', /const guard = deps\.requirePermission\('([^']+)'\)/],
  '/crm/marketing': ['packages/tenant-backend/src/marketing/marketing.ts', /app\.get\('\/campaigns', requirePermission\('([^']+)'\)/],
  '/crm/ads': ['packages/tenant-backend/src/ads/ads.ts', /app\.get\('\/', requirePermission\('([^']+)'\)/],
}

// ---------------------------------------------------------------- the role matrix, read not copied
const permSrc = read('packages/tenant-backend/src/auth/permissions.ts')
if (!permSrc) { console.error('FAIL: cannot read the shared permission matrix'); process.exit(1) }
const ROLES = ['viewer', 'field', 'manager', 'admin', 'owner']
const matrix: Record<string, string[]> = {}
{
  // Bracket-counted rather than pattern-matched: the arrays carry comments between their entries, and a
  // regex that reads three of the five rungs and says nothing is worse than no guard at all.
  const block = stripComments(permSrc.slice(permSrc.indexOf('BASE_ROLE_PERMISSIONS')))
  for (const role of [...ROLES, 'user']) {
    const at = block.indexOf(`\n  ${role}: [`)
    if (at < 0) continue
    let i = block.indexOf('[', at), depth = 0, end = -1
    for (; i < block.length; i++) {
      if (block[i] === '[') depth++
      else if (block[i] === ']') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) continue
    matrix[role] = [...block.slice(at, end).matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
}
if (ROLES.some((r) => !matrix[r])) {
  console.error(`FAIL: could not read every rung out of BASE_ROLE_PERMISSIONS (got ${Object.keys(matrix).join(', ')})`)
  process.exit(1)
}
/**
 * A vertical may widen a rung — vet's technicians get invoices:read so they can bill for care, salon's
 * stylists get contacts:create. Reading only the base matrix would report vet's Invoices entry as hiding
 * a page from people who can in fact open it: right conclusion, wrong reason, and a wrong reason in a
 * guard message is what sends the next person to fix the wrong file.
 */
const extrasFor = (t: string): Record<string, string[]> => {
  const src = read(`templates/${t}/backend/src/middleware/permissions.ts`)
  if (!src) return {}
  const at = stripComments(src).indexOf('extraRolePermissions:')
  if (at < 0) return {}
  const block = stripComments(src).slice(at)
  const out: Record<string, string[]> = {}
  for (const m of block.matchAll(/(\w+): \[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  return out
}
const roleHas = (role: string, permission: string, extras: Record<string, string[]> = {}) => {
  const list = [...(matrix[role] || []), ...(extras[role] || [])]
  return list.includes('*') || list.includes(permission) || list.includes(`${permission.split(':')[0]}:*`)
}

// ---------------------------------------------------------------- what each page's API asks for
const needsOf = (page: string): string | null => {
  const decl = PAGE_GUARD_DECL[page]
  if (decl) {
    const src = read(decl[0])
    return src ? (decl[1].exec(stripComments(src))?.[1] ?? null) : null
  }
  const mod = PAGE_MODULE[page]
  if (!mod) return null
  const src = read(mod)
  if (!src) return null
  const line = stripComments(src).split('\n').find((l) => /^\s*app\.get\('\/'/.test(l))
  return line?.match(/requirePermission\('([^']+)'\)/)?.[1] ?? null
}

let checked = 0, gated = 0
for (const t of TEMPLATES) {
  const rel = `templates/${t}/frontend/src/shellConfig.ts`
  const src = read(rel)
  if (!src) { fail(`${t} has no shellConfig.ts`); continue }
  const extras = extrasFor(t)
  // one nav entry per line, which is how every vertical writes them
  const entries = src.split('\n').filter((l) => /^\s*\{ to: '\/crm/.test(l))
  if (!entries.length) { fail(`${t} shellConfig declares no nav entries — the format changed and this guard is now blind`); continue }

  for (const line of entries) {
    const page = /to: '([^']+)'/.exec(line)![1]
    const needs = needsOf(page)
    if (!needs) continue
    checked++
    // Every rung holds it → there is nobody to hide it from, and declaring it would be noise.
    if (ROLES.every((r) => roleHas(r, needs, extras))) continue
    gated++
    const declared = /permission: '([^']+)'/.exec(line)?.[1]
    const shortOf = ROLES.filter((r) => !roleHas(r, needs, extras))
    if (!declared) {
      fail(`${t}: ${page} opens a page whose API requires ${needs}, which ${shortOf.join('/')} do not have — the entry must carry permission: '${needs}' or it offers them a page that refuses them`)
    } else if (declared !== needs) {
      fail(`${t}: ${page} declares permission: '${declared}' but its API requires '${needs}'`)
    }
  }
}

// ---------------------------------------------------------------- and the shell honours it
const shell = read('packages/tenant-ui/src/shell/AppShell.tsx')
if (!shell) fail('cannot read AppShell')
else {
  if (!/!i\.permission \|\| can\(i\.permission\)/.test(shell)) fail('AppShell does not filter the sidebar on NavItem.permission — the declarations above would be decoration')
  if (!/reason: 'permission' as const/.test(shell)) fail('AppShell does not gate the URL on a permission — hiding a menu entry a person can still type the path to is half a gate')
  const gate = shell.slice(shell.indexOf('const gatedItem'), shell.indexOf('useEffect(() => { if (isMobile)'))
  if (gate.indexOf('if (!company) return null') > gate.indexOf("reason: 'permission' as const")) {
    fail('the permission gate runs before `if (!company) return null` — deciding a route before /me lands is how roof M7 redirected fifteen owned routes')
  }
}
const types = read('packages/tenant-ui/src/shell/types.ts')
if (types && !/can\?: \(permission: string\) => boolean/.test(types)) fail('ShellAuth does not carry `can`')

if (failed) { console.error(`\nnav permission gates: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`nav permission gates: ${checked} sidebar entries lead to a guarded list, ${gated} of them to one some rung is refused, and every one of those declares the permission its own API asks for`)
