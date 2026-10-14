// CI guard: a company the Factory has cancelled is LOCKED — on the server and on screen — in every CRM the Factory can lock.
//
// 10/14: the Factory said "Ended. The CRM is locked" and the owner was not locked out. The only lock was a browser check
// on an expired trial date, so a paid company that cancelled was never locked, and the server never refused anyone.
//
// For every CRM that mounts /api/internal/sync-subscription (the Factory can mark it cancelled):
//   · its authenticate refuses a locked company: the shared createAuthMiddleware is given the company table, or its own
//     authenticate calls refuseWhileLocked(c, db, company) before next()
//   · its route guard sends a locked company to the lock page (isAccountLocked), and the lock page is mounted
//   · its lock page is the shared PaywallScreen, whose words follow WHY it is locked
//   · its API client turns a 402 ACCOUNT_LOCKED into the lock page (noticeAccountLock)
// And in the shared code: every role is told (settings.accountLock), and a Factory push takes effect at once.
//   bun scripts/check-cancelled-company-is-locked.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (f: string) => (existsSync(ROOT + f) ? readFileSync(ROOT + f, 'utf8') : '')
const PARKED = new Set(['crm-homecare', 'crm-automotive'])

let crms = 0
for (const t of readdirSync(ROOT + 'templates').filter((d) => /^crm(-|$)/.test(d) && !PARKED.has(d))) {
  const T = `templates/${t}/`
  if (!/sync-subscription/.test(read(T + 'backend/src/index.ts'))) continue
  crms++

  // ── server: the authenticate every route uses
  const mw = read(T + 'backend/src/middleware/auth.ts')
  if (!mw) { fail(`${t}: no backend/src/middleware/auth.ts`); continue }
  const usesShared = /createAuthMiddleware\(\s*\{[^}]*tables:\s*\{[^}]*\bcompany\b[^}]*\}/.test(mw)
  const ownAuth = /export const authenticate\s*=/.test(mw)
  if (ownAuth) {
    const body = mw.slice(mw.indexOf('export const authenticate'))
    const end = body.indexOf('\nexport ')
    const fn = end > 0 ? body.slice(0, end) : body
    const lock = fn.indexOf('refuseWhileLocked(c, db, company)'), next = fn.indexOf('await next()')
    if (lock < 0) fail(`${t}: its own authenticate never calls refuseWhileLocked(c, db, company) — a cancelled company keeps every door`)
    else if (next < 0 || lock > next) fail(`${t}: authenticate calls refuseWhileLocked AFTER next() — the route has already answered`)
  } else if (!usesShared) {
    fail(`${t}: createAuthMiddleware is not given the company table — the shared authenticate cannot see the lock`)
  }

  // ── screen: the route guard, the lock page and its mount
  const app = read(T + 'frontend/src/App.tsx')
  const guardFile = t === 'crm-roof' ? app : t === 'crm-dispensary' ? read(T + 'frontend/src/components/auth/ProtectedRoute.tsx') : read('packages/tenant-ui/src/auth/ProtectedRoute.tsx')
  if (!/isAccountLocked\(company/.test(guardFile)) fail(`${t}: the route guard does not ask isAccountLocked(company) — a paid company that cancelled is never sent to the lock page`)
  if (/isTrialExpired\(company/.test(guardFile)) fail(`${t}: the route guard still locks on isTrialExpired alone`)
  if (!/path=["'](\/crm\/)?paywall["']/.test(app)) fail(`${t}: App.tsx mounts no paywall route — the redirect would land on a 404`)
  const page = read(T + 'frontend/src/pages/PaywallPage.tsx')
  if (!/<PaywallScreen\b/.test(page)) fail(`${t}: pages/PaywallPage.tsx is not the shared PaywallScreen — its words would not follow why the company is locked`)

  // ── the API client: a refusal becomes the lock page, not "Request failed" on every screen
  const client = t === 'crm-roof' || t === 'crm-dispensary' ? read(T + 'frontend/src/services/api.ts') : read('packages/tenant-ui/src/api/client.ts')
  const notices = (client.match(/noticeAccountLock\(/g) || []).length
  if (notices < 3) fail(`${t}: the API client does not pass every response through noticeAccountLock (found ${notices - 1 < 0 ? 0 : notices - 1} call(s); both the first answer and the retry after a refresh need it)`)
}
if (crms < 10) fail(`only ${crms} CRM(s) mount sync-subscription — expected at least 10; the walk is not finding them`)

// ── the shared rule
const redact = read('packages/tenant-backend/src/auth/redactSettings.ts')
const lockLine = redact.indexOf('.accountLock = accountLockOf(source)'), privLine = redact.indexOf('if (!options.privileged)')
if (lockLine < 0) fail('redactCompanySettings does not tell every role settings.accountLock — staff are never sent the subscription status')
else if (privLine >= 0 && lockLine > privLine) fail('settings.accountLock is set inside/after the privileged branch — it must reach every role')
const billing = read('packages/tenant-backend/src/billing.ts')
const apply = billing.slice(billing.indexOf('export async function applySubscriptionToCompany'))
if (!/forgetAccountLock\(\)/.test(apply.slice(0, apply.indexOf('\n}\n') + 1 || undefined))) fail('applySubscriptionToCompany does not forgetAccountLock() — a lock or unlock would wait out the cache')
const shared = read('packages/tenant-backend/src/auth/middleware.ts')
if (!/refuseWhileLocked\(c, db, company\)/.test(shared)) fail('the shared createAuthMiddleware never calls refuseWhileLocked')

if (failed) { console.error(`\ncancelled company is locked: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`cancelled company is locked: ${crms} CRM(s) refuse on the server, send every role to the shared lock page, and turn a 402 into it`)
