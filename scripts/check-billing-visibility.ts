// CI guard: the bill stays with whoever settles it, and no screen guesses a trial. (T60)
//
//   "Subscription billing details reach the manager through /api/company … the nested settings
//    object still returns plan, monthlyAmount (99) …"  — measured on 9 of 10 live tenants
//   "A false 'N days left in your free trial – Upgrade' banner shows for the manager … a 30-day
//    countdown from the sign-up date."  — which then paywalls every manager on a paid shop
//
// Three rules, each over EVERY copy (the shared package plus the roof and dispensary forks):
//   1. A sign-in payload never sends company.settings raw — it goes through redactCompanySettings.
//   2. GET /api/company redacts the commercial terms, inside settings too, for a non-updater.
//   3. No trial helper or banner derives an end date from createdAt.
//   bun scripts/check-billing-visibility.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const PARKED = new Set(['crm-automotive', 'crm-homecare'])
const crms = readdirSync(join(ROOT, 'templates')).filter((t) => t.startsWith('crm') && !PARKED.has(t))
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))

// 1 ─ sign-in payloads: the shared one, and every template that forks routes/auth.ts
const authFiles = ['packages/tenant-backend/src/auth/auth.ts', ...crms.map((t) => `templates/${t}/backend/src/routes/auth.ts`).filter((p) => existsSync(join(ROOT, p)))]
let payloads = 0
for (const f of authFiles) {
  code(read(f)).forEach((l) => {
    // `settings: <anything>.settings` as an object property = the blob handed to the client
    const m = /\bsettings:\s*([A-Za-z_$][\w$.]*\.settings)\b/.exec(l)
    if (!/\bsettings:/.test(l) || !/\.settings\b/.test(l)) return
    payloads++
    if (m && !/redactCompanySettings\(/.test(l)) fail(`${f}: a sign-in payload sends ${m[1]} raw — wrap it in redactCompanySettings(…, { privileged: isPrivilegedRole(normalizeRole(role)) })`)
  })
}
if (payloads < 4) fail(`only ${payloads} sign-in settings payload(s) found — the walk is not reaching the auth forks, so this proves nothing`)

// 2 ─ GET /api/company, in every implementation that answers it
const shared = read('packages/tenant-backend/src/company/company.ts')
const sharedGet = shared.slice(shared.indexOf("app.get('/', async"), shared.indexOf("app.put('/'"))
if (!/return c\.json\(redactCompanyCommercial\(safe\)\)/.test(sharedGet) || !/canSee\(currentUser\.role, 'company:update'/.test(sharedGet)) fail('shared GET /api/company must answer a non-updater with redactCompanyCommercial')
const redact = read('packages/tenant-backend/src/auth/redactSettings.ts')
const rcc = redact.slice(redact.indexOf('export function redactCompanyCommercial'))
if (!/clone\.settings = redactCompanySettings\(clone\.settings, \{ privileged: false \}\)/.test(rcc)) fail('redactCompanyCommercial must redact the settings blob too — billing.ts mirrors the subscription INTO settings')
const roof = read('templates/crm-roof/backend/src/routes/company.ts')
const roofGet = roof.slice(roof.indexOf("app.get('/', async"), roof.indexOf("app.get('/features/catalog'"))
if (!/hasPermission\(currentUser\.role, 'company:update'/.test(roofGet) || !/redactCompanyCommercial\(safe\)/.test(roofGet)) fail("crm-roof GET /api/company must redact the commercial terms for a non-updater, asked with 'company:update'")
const disp = read('templates/crm-dispensary/backend/src/routes/company.ts')
if (!/clone\.settings = redactCompanySettings\(clone\.settings, \{ privileged: isPrivilegedRole\(role\) \}\)/.test(disp)) fail('crm-dispensary GET /api/company must keep redacting settings by role')
// every other CRM must answer /api/company through the shared route (or one of the two above)
for (const t of crms) {
  const p = `templates/${t}/backend/src/routes/company.ts`
  if (!existsSync(join(ROOT, p)) || t === 'crm-roof' || t === 'crm-dispensary') continue
  if (t === 'crm-store') {
    // crm-store has no company table: its shim answers { domain, email, name } off store_settings.
    // Clean by construction — it stays clean only while it hands over nothing else.
    if (!/return c\.json\(\{ domain, email: s\?\.supportEmail \?\? null, name: s\?\.companyName \?\? null \}\)/.test(read(p))) fail(`${p} now returns more than { domain, email, name } — redact the commercial terms before it does`)
    continue
  }
  if (!/createCompanyRoutes\(/.test(read(p))) fail(`${p} no longer uses the shared company route — give it the same redaction, then list it here`)
}
// the private list keeps the keys billing.ts mirrors, and the trial date is kept only while it decides access
for (const k of ['plan', 'planName', 'monthlyAmount', 'billingStatus', 'billingCycle', 'subscriptionStatus', 'seatLimit', 'hasStripeCustomer', 'subscriptionSyncedAt', 'billingType', 'nextBillingDate']) {
  if (!new RegExp(`'${k}'`).test(redact.slice(redact.indexOf('export const PRIVATE_SETTING_KEYS'), redact.indexOf('] as const', redact.indexOf('export const PRIVATE_SETTING_KEYS'))))) fail(`PRIVATE_SETTING_KEYS lost '${k}' — billing.ts mirrors it into settings`)
}
if (!/const TRIAL_DECIDES_ACCESS = \['trialing', 'canceled'\]/.test(redact) || !/if \(!TRIAL_DECIDES_ACCESS\.includes\(\(out as any\)\.subscriptionStatus\)\) delete \(out as any\)\.trialEndsAt/.test(redact)) fail('a non-privileged role must get trialEndsAt only while a trial decides access — a paid shop keeps a stale one')

// 3 ─ no trial is ever guessed from the sign-up date, on any screen
const uiFiles: string[] = []
const walk = (d: string) => {
  if (!existsSync(join(ROOT, d))) return
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = `${d}/${e.name}`
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name)) uiFiles.push(p)
  }
}
walk('packages/tenant-ui/src'); for (const t of crms) walk(`templates/${t}/frontend/src`)
let trialReaders = 0
for (const f of uiFiles) {
  const src = read(f)
  if (!/trialEndsAt/.test(src)) continue
  trialReaders++
  const body = code(src).join('\n')
  if (/createdAt[\s\S]{0,200}getDate\(\)\s*\+\s*30|createdAt\)\s*\+\s*30/.test(body)) fail(`${f} derives a trial end from createdAt — only trialEndsAt from the Factory decides a trial`)
}
if (trialReaders < 4) fail(`only ${trialReaders} trial reader(s) found — expected the shared and roof gate + banner`)
for (const f of ['packages/tenant-ui/src/shell/TrialBanner.tsx', 'templates/crm-roof/frontend/src/components/trial/TrialBanner.tsx']) {
  if (!/trialEndDate\(/.test(read(f))) fail(`${f} must take its date from trialEndDate — the same function the paywall gate uses`)
}

if (failed) { console.error(`\nbilling visibility: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`billing visibility: ${payloads} sign-in payloads redacted, /api/company redacts in all ${crms.length} CRMs, ${trialReaders} trial readers guess nothing`)
