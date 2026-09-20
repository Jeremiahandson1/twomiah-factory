// CI guard: writing the company record is admin/owner, and the UI does not offer a button the API refuses.
//
// Roof is the only template with a settings router, and it carried `app.use('*', authenticate)` and
// nothing else — so any signed-in user could rewrite the company name, phone, email and address, and
// the branding. Proven live on rooftest: role=user got `200 {"message":"Saved"}`.
//
// The same file already guarded PUT /api/company/features with requireAdmin, noting that accepting
// features on a non-admin route "would also have been a privilege hole". The features field was
// protected and the record around it was not.
//
// Reading stays open — `company:read` is in the field role on every template. This is about writes.
//
//   bun scripts/check-settings-writes-are-admin.ts
import { readFileSync, existsSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (rel: string) => { try { return readFileSync(ROOT + rel, 'utf8') } catch { fail(`${rel} is missing`); return '' } }

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-roof', 'crm-dispensary', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']

// ── every write on a settings router is role-guarded, in every template that has one ──────────────
{
  for (const t of TEMPLATES) {
    const rel = `templates/${t}/backend/src/routes/settings.ts`
    if (!existsSync(ROOT + rel)) continue   // eight of nine put this behind PUT /api/company instead
    const src = readFileSync(ROOT + rel, 'utf8')
    const writes = [...src.matchAll(/^app\.(put|post|patch|delete)\('([^']+)'\s*,\s*([^\n]*)$/gm)]
    if (!writes.length) fail(`${rel} has no write routes — this guard has drifted from the file it is about`)
    for (const [, method, path, rest] of writes) {
      if (!/require(Admin|Role|Permission)/.test(rest))
        fail(`${rel}: ${method.toUpperCase()} ${path} has no role guard — a settings router with only \`authenticate\` lets a field tech rewrite the company record`)
    }
    // and the router must not be relying on a blanket app.use that someone could delete silently
    if (!/import \{[^}]*\brequireAdmin\b[^}]*\} from '\.\.\/middleware\/auth\.ts'/.test(src))
      fail(`${rel} must import requireAdmin from the real auth middleware`)
    // reading is deliberately open; if that changed it would lock a tech out of their own company page
    if (/^app\.get\('\/company',\s*require/m.test(src))
      fail(`${rel}: GET /company must stay open — company:read is in the field role on every template`)
  }
}

// ── roof specifically: the three writes and the three buttons ─────────────────────────────────────
{
  const rel = 'templates/crm-roof/backend/src/routes/settings.ts'
  const src = read(rel)
  for (const p of ['/company', '/branding', '/estimator']) {
    if (!new RegExp(`app\\.put\\('${p}', requireAdmin,`).test(src))
      fail(`${rel}: PUT ${p} must be requireAdmin`)
  }

  const settings = read('templates/crm-roof/frontend/src/pages/settings/SettingsPage.tsx')
  const estimator = read('templates/crm-roof/frontend/src/pages/settings/EstimatorSettingsPage.tsx')
  if (!/const isAdmin = currentUser\?\.role === 'admin' \|\| currentUser\?\.role === 'owner'/.test(settings))
    fail('SettingsPage must know the admin tier')
  if (!/\{isAdmin && \(\s*<button onClick=\{saveCompany\}/.test(settings))
    fail('the company Save button must be admin-only — the API refuses it to anyone else, so showing it hands a field tech a button that 403s')
  if (!/\{isAdmin && \(\s*<button onClick=\{saveBrandingSettings\}/.test(settings))
    fail('the branding Save button must be admin-only')
  if (!/canManageUsers = isAdmin/.test(settings))
    fail('user administration must still be gated on the same tier')
  if (!/\{isAdmin && \(\s*<button onClick=\{save\}/.test(estimator))
    fail('the estimator Save button must be admin-only')
  // a hidden button with no explanation reads as a broken page
  if (!/Only an administrator can change/.test(settings) || !/Only an administrator can change/.test(estimator))
    fail('…and each hidden Save must say why, or the form looks broken to a non-admin')
}

console.log(failed ? `\n${failed} failure(s)` : 'ok: settings writes are admin-only, and the UI offers no button the API refuses')
process.exit(failed ? 1 : 0)
