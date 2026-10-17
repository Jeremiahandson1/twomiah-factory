// CI guard: home care's two-factor is wired end to end. (Launch list, 10/17)
//
// Home care got two-factor on 10/17 through the shared engine with a single-company scope (users table, no company
// table). The fleet's two two-factor guards (check-mfa-screen-has-api, check-my-account-reachable) skip home care as
// "parked" — they look for a SettingsPage and an /account route it does not have — so nothing in CI held its wiring.
// Its behaviour test (tests/homecare/mfa-sign-in) proves the flow; this holds every piece of the wiring in place:
//   · the tables exist (they are what switches the shared engine on), in a migration the journal applies;
//   · enrolment is mounted, and the sign-in route asks the gate and finishes at POST /mfa — all with the SAME scope;
//   · the sign-in screen has the code step, the client calls /api/auth/mfa, and both seat types are offered the card.
//   bun scripts/check-homecare-mfa-wiring.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const H = 'templates/crm-homecare/'
const read = (p: string) => { try { return readFileSync(ROOT + H + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── backend
const mig = read('backend/db/migrations/0026_mfa.sql')
if (!/CREATE TABLE IF NOT EXISTS "mfa_devices"/.test(mig) || !/CREATE TABLE IF NOT EXISTS "mfa_challenges"/.test(mig)) fail('migration 0026_mfa.sql must create mfa_devices and mfa_challenges')
if (!/"tag": "0026_mfa"/.test(read('backend/db/migrations/meta/_journal.json'))) fail('…and the journal must apply it')
const schema = read('backend/db/schema.ts')
if (!/pgTable\('mfa_devices'/.test(schema) || !/pgTable\('mfa_challenges'/.test(schema)) fail('schema.ts must declare both tables (reconcile builds from it)')
const index = read('backend/src/index.ts')
if (!/app\.route\('\/api\/auth\/mfa-devices', mfaRoutes\)/.test(index) || !/import mfaRoutes from '\.\/routes\/mfa\.ts'/.test(index)) fail('index.ts must mount the enrolment routes at /api/auth/mfa-devices')
const auth = read('backend/src/routes/auth.ts')
const login = auth.slice(auth.indexOf("app.post('/login'"), auth.indexOf("app.post('/mfa'"))
if (!/await mfaGateFor\(db, MFA_SCOPE\.singleCompanyId!, \w+\.id, MFA_SCOPE\)/.test(login)) fail('POST /login must ask the shared gate with MFA_SCOPE')
if (!/if \(gate\.required\)/.test(login) || !/mfaRequired: true/.test(login)) fail('…and answer a challenge, not tokens, when a factor is enrolled')
const finish = auth.slice(auth.indexOf("app.post('/mfa'"))
if (!finish || !/verifyLoginChallenge\(db, challengeId, code, MFA_SCOPE\)/.test(finish)) fail('POST /api/auth/mfa must verify with the same MFA_SCOPE')
const mfaRoutes = read('backend/src/routes/mfa.ts')
if (!/^\s*scope: MFA_SCOPE,/m.test(mfaRoutes.replace(/^\s*\/\/.*$/gm, ''))) fail('the enrolment routes must use the same MFA_SCOPE (or devices are written under one company id and read under another)')
const scope = read('backend/src/helpers/mfaScope.ts')
if (!/usersTable: 'users'/.test(scope) || !/singleCompanyId: '[^']+'/.test(scope)) fail('helpers/mfaScope.ts must name the users table and the single company id')

// ── frontend
const loginUi = read('frontend/src/components/Login.tsx')
if (!/mfaRequired/.test(loginUi) || !/completeMfa\(/.test(loginUi)) fail('components/Login.tsx (the sign-in screen in use) must have the code step')
const api = read('frontend/src/services/api.ts')
if (!/this\.request\('\/api\/auth\/mfa', \{ method: 'POST'/.test(api)) fail('services/api.ts must finish sign-in at POST /api/auth/mfa')
if (!/mfa = \{/.test(api) || !/\/api\/auth\/mfa-devices\/setup/.test(api)) fail('…and give the Two-Factor card its enrolment calls')
for (const [file, seat] of [['frontend/src/components/AdminDashboard.tsx', 'the office'], ['frontend/src/components/CaregiverDashboard.tsx', 'a caregiver']] as const) {
  if (!/<TwoFactorSettings \/>/.test(read(file))) fail(`${file}: ${seat} must be offered the Two-Factor card`)
}
if (!existsSync(ROOT + H + 'frontend/src/components/TwoFactorSettings.tsx') || !/<TwoFactorCard\b/.test(read('frontend/src/components/TwoFactorSettings.tsx'))) fail('TwoFactorSettings must render the shared TwoFactorCard')

if (failed) { console.error(`\nhomecare mfa wiring: ${failed} check(s) failed`); process.exit(1) }
console.log('homecare mfa wiring: tables, mounts, sign-in gate and finish on one scope; code step; card for office and caregivers')
