// CI guard: you can correct your own name. Settings › Profile printed name, email and role and offered no way
// to change any of them, so a misspelled name needed an admin — and an owner had nobody to ask. (T14 M7)
//
// The line that matters is WHICH fields are self-editable: exactly the ones an admin can already change on
// someone else, minus the privileged ones. Role, active state and permission grants stay with an admin, and
// email is nobody's to change — it is the login identity and there is no re-verification flow.
//   bun scripts/check-profile-editable.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const auth = read('packages/tenant-backend/src/auth/auth.ts')
if (!auth) fail('packages/tenant-backend/src/auth/auth.ts is missing')
const route = auth.match(/app\.put\('\/profile', authenticate[\s\S]*?\n  \}\)/)?.[0] || ''
if (!route) fail('PUT /profile is missing — there is no way to change your own name')
if (!/app\.put\('\/profile', authenticate/.test(auth)) fail('…and it must require a session')
// the editable set
for (const f of ['firstName', 'lastName', 'phone']) {
  if (!new RegExp(`${f}:`).test(route)) fail(`a person must be able to change their own ${f}`)
}
// …and nothing else. The update must name its columns rather than spreading the parsed body.
if (/\.set\(\{ \.\.\.data/.test(route)) fail('the update must name the columns it writes — spreading the body lets role or isActive through')
for (const forbidden of ['role', 'isActive', 'extraPermissions', 'email', 'passwordHash']) {
  if (new RegExp(`set\\([^)]*${forbidden}:`).test(route)) fail(`${forbidden} must not be self-editable here`)
}
if (!/eq\(user\.id, currentUser\.userId\)/.test(route)) fail('the update must be scoped to the caller — never an id from the body')
if (!/phone: data\.phone \? data\.phone : null/.test(route)) fail('a cleared phone must be stored as null, not an empty string')
if (!/First name is required/.test(route) || !/Last name is required/.test(route)) fail('a blank name must be refused with a message naming the field')
if (!/userPayload\(updated/.test(route)) fail('the response must return the updated person, so the header can refresh without a reload')

// the screen
const page = read('packages/tenant-ui/src/shell/SettingsPage.tsx')
if (!/api\.put\('\/api\/auth\/profile'/.test(page)) fail('the Profile tab must save to /api/auth/profile')
if (!/<Field label="First Name">/.test(page) || !/<Field label="Last Name">/.test(page)) fail('the Profile tab must offer name fields')
if (!/auth\.updateUser\?\.\(/.test(page)) fail('…and refresh the signed-in person after saving')
if (!/set by an administrator/.test(page)) fail('…and say who can change the email and role it still shows read-only')

// the context can actually refresh the user
const ctx = read('packages/tenant-ui/src/auth/AuthContext.tsx')
if (!/const updateUser = \(updates: Partial<AuthUser>\) => \{/.test(ctx)) fail('the auth context must expose updateUser')
if (!/updateCompany, updateUser,/.test(ctx)) fail('…and provide it on the context value')
if (!/updateUser: \(updates: Partial<AuthUser>\) => void/.test(read('packages/tenant-ui/src/auth/types.ts'))) fail('…and declare it on the context type')

if (failed) { console.error(`\nprofile editable: ${failed} check(s) FAILED`); process.exit(1) }
console.log('profile editable: you can correct your own name, and only your own name')
