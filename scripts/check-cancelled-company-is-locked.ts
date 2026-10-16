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
// crm-homecare was parked here on 10/14, and that is how "Cancel now" left a home care agency's CRM fully open: it had
// no sync-subscription route, so the walk skipped it and this guard stayed green (Run 3, blocker 2). Only the parked
// crm-automotive is left out now.
const PARKED = new Set(['crm-automotive'])
// The table each own-authenticate passes: crm-store has no company row (store_settings.subscription); home care's
// company is its agencies row.
const LOCK_CALL: Record<string, string> = {
  'crm-store': 'refuseWhileLocked(c, db, storeSettings, storeSettings.subscription)',
  'crm-homecare': 'refuseWhileLocked(c, db, agencies)',
}

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
    // crm-store has no company row: it mirrors the Factory's summary into store_settings.subscription.
    const call = LOCK_CALL[t] || 'refuseWhileLocked(c, db, company)'
    const lock = fn.indexOf(call), next = fn.indexOf('await next()')
    // Asking is not enough: the answer must stop the request. (A mutation that deleted `if (locked) return locked` in
    // crm-store survived the call-only check — and the suites cannot see it, since they run the auth fixture.)
    const acted = fn.indexOf('if (locked) return locked', lock)
    if (lock < 0) fail(`${t}: its own authenticate never calls ${call} — a cancelled company keeps every door`)
    else if (next < 0 || lock > next) fail(`${t}: authenticate calls refuseWhileLocked AFTER next() — the route has already answered`)
    else if (!fn.includes('const locked = await ' + call) || acted < 0 || acted > next) fail(`${t}: authenticate asks refuseWhileLocked but never RETURNS its refusal before next() — the lock is ignored`)
  } else if (!usesShared) {
    fail(`${t}: createAuthMiddleware is not given the company table — the shared authenticate cannot see the lock`)
  }

  // ── screen: the route guard, the lock page and its mount
  const app = read(T + 'frontend/src/App.tsx')
  if (t === 'crm-store') {
    // The store's screens are at / and its /me carries the lock itself (no company row).
    if (!/if \(accountLock\) return <Navigate to="\/paywall" replace \/>/.test(app)) fail(`${t}: Protected does not send a locked store to /paywall`)
    if (!/accountLock: accountLockOf\(store\?\.subscription/.test(read(T + 'backend/src/routes/auth.ts'))) fail(`${t}: /api/auth/me does not tell every seat whether the store is locked`)
  } else {
    const guardFile = t === 'crm-roof' || t === 'crm-homecare' ? app : t === 'crm-dispensary' ? read(T + 'frontend/src/components/auth/ProtectedRoute.tsx') : read('packages/tenant-ui/src/auth/ProtectedRoute.tsx')
    if (!/isAccountLocked\(company/.test(guardFile)) fail(`${t}: the route guard does not ask isAccountLocked(company) — a paid company that cancelled is never sent to the lock page`)
    if (/isTrialExpired\(company/.test(guardFile)) fail(`${t}: the route guard still locks on isTrialExpired alone`)
  }
  if (!/path=["'](\/crm\/|\/)?paywall["']/.test(app)) fail(`${t}: App.tsx mounts no paywall route — the redirect would land on a 404`)
  const page = read(T + 'frontend/src/pages/PaywallPage.tsx')
  if (!/<PaywallScreen\b/.test(page)) fail(`${t}: pages/PaywallPage.tsx is not the shared PaywallScreen — its words would not follow why the company is locked`)
  // The way back is a payment, not an email (owner, 10/14): the lock page needs this template's API client to open it.
  else if (!/<PaywallScreen\b[^>]*\brequest=\{/.test(page)) fail(`${t}: the lock page is not given the API client (request=) — the owner could not restart by paying`)
  const billing = read(T + 'backend/src/routes/billing.ts')
  if (t === 'crm-store') {
    if (!/billingRoutes\.use\('\*', authenticate, requirePermission\('billing:manage'\)\)/.test(billing) || !/billingRoutes\.post\('\/restart-checkout'/.test(billing)) fail(`${t}: routes/billing.ts has no POST /restart-checkout behind billing:manage (the owner's)`)
    if (!/app\.route\('\/api\/internal\/sync-subscription', subscriptionSyncRoute\)/.test(read(T + 'backend/src/index.ts'))) fail(`${t}: the Factory's subscription push has nowhere to land`)
  } else if (!/createBillingRoutes\(/.test(billing) || !/canManage:/.test(billing)) fail(`${t}: routes/billing.ts does not mount the shared billing routes with canManage — POST /api/billing/restart-checkout would refuse everyone`)

  // ── the API client: a refusal becomes the lock page, not "Request failed" on every screen
  if (t === 'crm-store') {
    // The store's client has one response path (a refreshed retry re-enters it), so the check sits there once.
    if (!/res\.status === 402 && \(data as any\)\?\.code === 'ACCOUNT_LOCKED'[^\n]*location\.assign\('\/paywall'\)/.test(read(T + 'frontend/src/services/api.ts'))) fail(`${t}: the API client does not turn a 402 ACCOUNT_LOCKED into the lock page`)
    continue
  }
  if (t === 'crm-homecare') {
    // Home care's screens make ~500 raw fetch() calls, so the 402 is caught under fetch itself, for all of them at once:
    // services/sessionFetch.ts, which services/api.ts installs over window.fetch. The lock page's sign-in summary must
    // carry the lock too, since a locked agency's /api/company is itself a 402.
    const sf = read(T + 'frontend/src/services/sessionFetch.ts'), apiTs = read(T + 'frontend/src/services/api.ts')
    if (!/res\.status === 402 && body\?\.code === 'ACCOUNT_LOCKED'[\s\S]{0,80}port\.locked\(\)/.test(sf)) fail(`${t}: services/sessionFetch.ts does not turn a 402 ACCOUNT_LOCKED into the lock page`)
    if (!/window\.fetch = createSessionFetch\(/.test(apiTs) || !/locked: \(\) => window\.location\.assign\(LOCK_PAGE\)/.test(apiTs)) fail(`${t}: services/api.ts does not install the session fetch with the lock page — raw fetch() screens would show "Failed to load" instead`)
    if (!/settings: \{ accountLock: accountLockOf\(agency\.settings\) \}/.test(read(T + 'backend/src/routes/auth.ts'))) fail(`${t}: sign-in and /api/auth/me do not tell every role whether the agency is locked`)
    continue
  }
  const client = t === 'crm-roof' || t === 'crm-dispensary' ? read(T + 'frontend/src/services/api.ts') : read('packages/tenant-ui/src/api/client.ts')
  const notices = (client.match(/noticeAccountLock\(/g) || []).length
  if (notices < 3) fail(`${t}: the API client does not pass every response through noticeAccountLock (found ${notices - 1 < 0 ? 0 : notices - 1} call(s); both the first answer and the retry after a refresh need it)`)
}
if (crms < 12) fail(`only ${crms} CRM(s) mount sync-subscription — expected at least 12 (the ten CRMs, home care and crm-store); the walk is not finding them`)

// ── the shared rule
const redact = read('packages/tenant-backend/src/auth/redactSettings.ts')
const lockLine = redact.indexOf('.accountLock = accountLockOf(source)'), privLine = redact.indexOf('if (!options.privileged)')
if (lockLine < 0) fail('redactCompanySettings does not tell every role settings.accountLock — staff are never sent the subscription status')
else if (privLine >= 0 && lockLine > privLine) fail('settings.accountLock is set inside/after the privileged branch — it must reach every role')
const billing = read('packages/tenant-backend/src/billing.ts')
const apply = billing.slice(billing.indexOf('export async function applySubscriptionToCompany'))
if (!/forgetAccountLock\(\)/.test(apply.slice(0, apply.indexOf('\n}\n') + 1 || undefined))) fail('applySubscriptionToCompany does not forgetAccountLock() — a lock or unlock would wait out the cache')
const shared = read('packages/tenant-backend/src/auth/middleware.ts')
if (!/const locked = await refuseWhileLocked\(c, db, company\)\s*\n\s*if \(locked\) return locked\s*\n\s*await next\(\)/.test(shared.replace(/\r\n/g, '\n'))) fail('the shared createAuthMiddleware does not ask refuseWhileLocked and RETURN its refusal before next()')
for (const fx of ['tests/harness/fixtures/middleware-auth.ts', 'tests/harness/fixtures/middleware-auth.crm-store.ts', 'tests/harness/fixtures/middleware-auth.crm-homecare.ts']) {
  // The suites' auth stand-ins must keep the lock too, or no suite would ever see a locked company.
  const src = read(fx).replace(/\r\n/g, '\n')
  if (!/const locked = await refuseWhileLocked\([^)]*\)\s*\n\s*if \(locked\) return locked/.test(src)) fail(`${fx}: the test bridge drops the lock — no suite would see a locked company`)
}

// ── the way back: pay and restart (owner, 10/14: "why email?")
const lockRule = read('packages/tenant-backend/src/auth/accountLock.ts')
if (!/'\/api\/billing\/subscription'/.test(lockRule) || !/'\/api\/billing\/restart-checkout'/.test(lockRule)) fail('a locked company no longer keeps /api/billing/subscription and /restart-checkout — the Restart button would be refused by the lock it is meant to lift')
// …and ONLY those: home care's /api/billing is also its client invoicing, which a cancelled agency must not keep.
if (/'\/api\/billing'/.test(lockRule)) fail('the lock keeps the whole of /api/billing open — home care\'s client invoices, payments and rates would stay open to a cancelled agency')
if (!/app\.post\('\/restart-checkout'[\s\S]{0,400}deps\.canManage/.test(billing)) fail('POST /restart-checkout is missing from the shared billing routes, or does not ask canManage (owner only)')
const screen = read('packages/tenant-ui/src/auth/PaywallScreen.tsx')
if (!/'\/api\/billing\/restart-checkout'/.test(screen)) fail('the shared lock page never asks for the restart checkout — the owner is back to emailing support')
if (/mailto:support@twomiah\.com\?subject=Restart/.test(screen)) fail('the shared lock page still sends the owner to email support to restart')
const billingPage = read('packages/tenant-ui/src/settings/BillingPage.tsx')
if (/Reactivate it in the billing portal/.test(billingPage)) fail('Settings › Billing tells a cancelled owner to reactivate in the Stripe portal — an ended subscription cannot be switched back on there')

if (failed) { console.error(`\ncancelled company is locked: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`cancelled company is locked: ${crms} CRM(s) refuse on the server, send every role to the shared lock page, turn a 402 into it, and let the owner restart by paying`)
