// CI guard: every role can reach its own two-factor and password, on every CRM that offers them. (T60)
//
//   "Salon: … the manager has no way to reach 2FA." (open since T42)
//
// The Two-Factor card and Change Password were on Settings › Security, and Settings is admin-only on
// salon (shellConfig routeRoles) — so a person's own sign-in security sat behind the shop's door.
// crm-dispensary fixed it for itself in T41 with /crm/account. The rule, over every CRM whose backend
// mounts the MFA routes:
//   · the frontend mounts /crm/account, and the page it mounts renders the Two-Factor card;
//   · that route is not role-gated by the shell config;
//   · the shared account menu links to it with no role or permission condition.
// A card in packages/tenant-ui ships everywhere; the ROUTE is per template, which is how 7 tenants once
// offered two-factor against a 404 — so the mount is checked template by template.
//   bun scripts/check-my-account-reachable.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const PARKED = new Set(['crm-automotive', 'crm-homecare'])

let checked = 0
for (const t of readdirSync(join(ROOT, 'templates')).filter((d) => d.startsWith('crm') && !PARKED.has(d))) {
  const idx = `templates/${t}/backend/src/index.ts`
  if (!existsSync(join(ROOT, idx)) || !/app\.route\('\/api\/auth\/mfa-devices'/.test(read(idx))) continue
  checked++
  const appPath = `templates/${t}/frontend/src/App.tsx`
  const app = read(appPath)
  const m = /<Route path="account" element=\{<(\w+) \/>\} \/>/.exec(app)
  if (!m) { fail(`${t}: serves two-factor (/api/auth/mfa-devices) but mounts no /crm/account — nobody below admin can reach it`); continue }
  const imp = new RegExp(`import ${m[1]} from '(\\./pages/[^']+)';`).exec(app)
  const pagePath = imp ? `templates/${t}/frontend/src/${imp[1].replace('./', '')}.tsx` : ''
  if (!pagePath || !existsSync(join(ROOT, pagePath))) { fail(`${t}: /crm/account renders ${m[1]}, whose file was not found`); continue }
  const page = read(pagePath)
  if (!/<TwoFactorCard\b/.test(page) && !/<MyAccountPage\b/.test(page)) fail(`${pagePath}: the account page must render the Two-Factor card (directly, or via the shared MyAccountPage)`)
  const shell = `templates/${t}/frontend/src/shellConfig.ts`
  if (existsSync(join(ROOT, shell)) && /'\/crm\/account'\s*:/.test(read(shell))) fail(`${shell}: /crm/account is role- or permission-gated — it is every person's own security`)
}
if (checked < 8) fail(`only ${checked} CRM(s) serve two-factor — the walk is not reading index.ts`)

const sharedPage = read('packages/tenant-ui/src/account/MyAccountPage.tsx')
if (!/<TwoFactorCard api=\{api\} toast=\{toast\} \/>/.test(sharedPage) || !/api\.put\('\/api\/auth\/password'/.test(sharedPage)) fail('the shared MyAccountPage must carry the Two-Factor card and Change Password')
const shellSrc = read('packages/tenant-ui/src/shell/AppShell.tsx')
const link = shellSrc.indexOf('<RouterLink to="/crm/account"')
if (link < 0) fail('the shared account menu has no link to /crm/account')
else if (/&&\s*\(\s*$/.test(shellSrc.slice(Math.max(0, link - 120), link).trimEnd())) fail('the /crm/account link in the account menu is conditional — it must be offered to every role')

if (failed) { console.error(`\nmy account: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`my account: all ${checked} CRMs that serve two-factor mount /crm/account for every role, and the menu offers it`)
