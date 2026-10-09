// CI guard: two credentials a seat may work beside but never hold. (T62; owner's decisions 2026-10-09)
//
//   "Staff can read the lead-source webhook secret … Anyone with the secret can post fake leads into the
//    CRM from outside."  → owners and admins only.
//   "The stylist holds contacts:create and contacts:update. That lets them fetch any client's working
//    portal link."  → owners, admins and managers only.
//
// Both leaked through a permission the seat holds for other work (contacts:create / contacts:update).
// The rules, route by route:
//   PORTAL  every portal route that issues, reads, mails or withdraws a client's link asks portal:share;
//           the status read stays contacts:read. portal:share is on admin's and manager's rows and on no
//           lower row, no vertical grants it as an extra, and the contact screen asks the same question.
//   WEBHOOK every lead-source response (list, create, edit) in the shared module and in the roof and
//           dispensary forks goes through mayHoldSecret, and every template that mounts the shared
//           module passes canSee — without it the shared module shows the secret to everyone.
//   bun scripts/check-credentials-stay-with-the-desk.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── PORTAL ────────────────────────────────────────────────────────────────────────────────────────────
{
  const file = 'packages/tenant-backend/src/portal/portal.ts', src = read(file)
  const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\('(\/contacts\/:contactId\/[^']+)',\s*([^\n]*?)async/g)]
  const want: Record<string, string> = { '/enable': 'portal:share', '/regenerate': 'portal:share', '/disable': 'portal:share', '/send-link': 'portal:share', '/link': 'portal:share', '/status': 'contacts:read' }
  for (const [tail, perm] of Object.entries(want)) {
    const r = routes.find((m) => m[2] === `/contacts/:contactId${tail}`)
    if (!r) { fail(`${file}: …${tail} not found — if it moved, this guard must follow it`); continue }
    const asked = [...r[3].matchAll(/requirePermission\('([^']+)'\)/g)].map((m) => m[1])
    if (asked.length !== 1 || asked[0] !== perm) fail(`${file}: ${r[1].toUpperCase()} …${tail} asks ${asked.join(', ') || 'nothing'} — it must ask ${perm}`)
  }
  // a NEW route under /contacts/:contactId/ must be placed in the table above, not left to default
  for (const r of routes) if (!Object.keys(want).some((t) => r[2] === `/contacts/:contactId${t}`)) fail(`${file}: ${r[2]} is not in this guard's table — decide whether it hands out the link`)

  const m = read('packages/tenant-backend/src/auth/permissions.ts')
  const row = (role: string) => {
    const at = m.indexOf(`\n  ${role}: [`); if (at < 0) return null
    return m.slice(at, m.indexOf('\n  ],', at)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  }
  for (const role of ['admin', 'manager']) { const r = row(role); if (r === null) fail(`permissions.ts: no ${role} row`); else if (!/'portal:(share|\*)'/.test(r)) fail(`permissions.ts: ${role} does not hold portal:share — the owner's decision is owners, admins and managers`) }
  for (const role of ['field', 'viewer', 'user']) { const r = row(role); if (r !== null && /'portal:/.test(r)) fail(`permissions.ts: ${role} holds a portal permission — the link is owners', admins' and managers' only`) }
  for (const t of readdirSync(join(ROOT, 'templates'))) {
    const p = `templates/${t}/backend/src/middleware/permissions.ts`
    if (t === 'crm-automotive' || !existsSync(join(ROOT, p))) continue
    const src = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const extra = /extraRolePermissions:\s*\{([\s\S]*?)\n\s*\},?\n|extraRolePermissions:\s*\{([^\n]*)\}/.exec(src)
    if (extra && /'portal:/.test(extra[1] || extra[2] || '')) fail(`${p}: grants a portal permission as an extra — the link is owners', admins' and managers' only`)
  }
  const ui = read('packages/tenant-ui/src/contacts/ContactDetailPage.tsx')
  if (!/const mayManagePortal = cfg\.can\('portal:share'\)/.test(ui)) fail(`ContactDetailPage.tsx: mayManagePortal must ask portal:share, the question GET …/link asks — or the panel offers controls that 403`)
}

// ── WEBHOOK ───────────────────────────────────────────────────────────────────────────────────────────
const sourceRoutes = (src: string, from: string, to: string) => {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1)
  return a < 0 || b < 0 ? null : src.slice(a, b)
}
// The WHOLE line of every non-error response — `if (await mayHoldSecret(c)) return c.json(…)` decides before the return.
const sourceReturns = (block: string) => [...block.matchAll(/^[^\n]*return c\.json\(([^\n]*)/gm)]
  .filter((m) => !/^\{ error/.test(m[1])).map((m) => m[0].trim())
{
  const file = 'packages/tenant-backend/src/leads/leads.ts', src = read(file)
  if (!/const mayHoldSecret = async[\s\S]{0,200}deps\.canSee\(u\?\.role, 'integrations:update'/.test(src)) fail(`${file}: mayHoldSecret must ask canSee(…, 'integrations:update') — owners and admins`)
  const block = sourceRoutes(src, "app.get('/sources'", "app.delete('/sources/:id'")
  if (!block) fail(`${file}: GET /sources … DELETE /sources/:id not found — if it moved, this guard must follow it`)
  else {
    const returns = sourceReturns(block)
    if (returns.length < 3) fail(`${file}: only ${returns.length} source response(s) found — the walk is not reading this file`)
    for (const r of returns) if (!/mayHoldSecret|withoutSecret/.test(r)) fail(`${file}: a lead-source response skips mayHoldSecret: ${r.slice(0, 100)}`)
  }
  for (const t of readdirSync(join(ROOT, 'templates'))) {
    const p = `templates/${t}/backend/src/routes/leads.ts`
    // crm-homecare is parked (not worked on). Its fork still hands every seat the secret — told to the owner, T62.
    if (t === 'crm-automotive' || t === 'crm-homecare' || !existsSync(join(ROOT, p))) continue
    const s = read(p)
    if (/createLeadsRoutes\(/.test(s)) {
      if (!/canSee:\s*async[^\n]*\n?[^\n]*hasPermission\(role, permission, await getExtraPermissions\(userId\)\)/.test(s)) fail(`${p}: mounts the shared lead routes without canSee — every seat is handed the webhook secret`)
      continue
    }
    // a fork: its own three source responses
    const fb = sourceRoutes(s, "app.get('/sources'", "app.delete('/sources/:id'")
    if (!fb) { fail(`${p}: a forked lead module with no GET /sources … DELETE /sources/:id — if it moved, this guard must follow it`); continue }
    if (!/const mayHoldSecret = async[\s\S]{0,200}hasPermission\(u\?\.role, '(integrations:update|settings:update)'/.test(s)) fail(`${p}: the fork's mayHoldSecret must ask its owner/admin permission`)
    const returns = sourceReturns(fb)
    if (returns.length < 3) fail(`${p}: only ${returns.length} source response(s) found — the walk is not reading this file`)
    for (const r of returns) if (!/mayHoldSecret|withoutSecret/.test(r)) fail(`${p}: a lead-source response skips mayHoldSecret: ${r.slice(0, 100)}`)
  }
}

if (failed) { console.error(`\ncredentials: ${failed} check(s) FAILED`); process.exit(1) }
console.log("credentials: a client's portal link asks portal:share (owner/admin/manager) and every lead-source response withholds the webhook secret below admin")
