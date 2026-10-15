// CI guard: an emailed invite or reset link works in a browser that is already signed in.
//
// 10/14: the owner clicked four team invites in their own browser. /reset-password sat inside PublicRoute, which sends a
// signed-in visitor to the dashboard — so each link opened the OWNER's dashboard ("it logged me in as admin"), the form
// never showed, and no password was set. Nobody gained access; nothing worked either.
//
//   · no CRM puts /reset-password behind PublicRoute / PublicOnly (or any wrapper that redirects a signed-in visitor)
//   · the shared page signs the current session out when the new password is saved, and says so beforehand
//   bun scripts/check-reset-link-while-signed-in.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const PARKED = new Set(['crm-homecare', 'crm-automotive'])

let routes = 0
for (const t of readdirSync(ROOT + 'templates').filter((d) => /^crm(-|$)/.test(d) && !PARKED.has(d))) {
  const f = `templates/${t}/frontend/src/App.tsx`
  if (!existsSync(ROOT + f)) continue
  const src = readFileSync(ROOT + f, 'utf8')
  const lines = src.split(/\r?\n/).filter((l) => /path=["']\/reset-password["']/.test(l))
  if (!lines.length) { fail(`${f} has no /reset-password route — the invite and reset emails link there`); continue }
  routes += lines.length
  for (const l of lines) {
    const element = l.match(/element=\{(.*)\}\s*\/>/)?.[1] || ''
    // the page itself, alone: <ResetPasswordPage /> — any wrapper around it is what sent the owner to the dashboard
    if (!/^<\w*ResetPassword\w*\s*\/>$/.test(element.trim())) fail(`${f}: /reset-password is wrapped (${element.trim().slice(0, 80)}) — a signed-in browser would never see the form`)
  }
}

const shared = readFileSync(ROOT + 'packages/tenant-ui/src/auth/ResetPasswordPage.tsx', 'utf8')
if (!/if \(isAuthenticated\) await logout\(\)/.test(shared)) fail('the shared ResetPasswordPage must sign the current session out after saving, or sign-in carries the old account straight through')
if (!/This browser is signed in as/.test(shared)) fail('the shared ResetPasswordPage must say who is signed in before the password is saved')
// The templates that keep their OWN reset page must end the old session too — through the AUTH CONTEXT. (E2E Run 2,
// 10/15) The store's cleared only the api tokens: the old person stayed in memory, Sign in bounced to their dashboard,
// and Sign out failed on its refused server call. Dispensary and roof never signed out at all.
const OWN_RESET: Record<string, RegExp> = {
  'crm-store': /if \(isAuthenticated \|\| api\.hasToken\) await logout\(\)/,
  'crm-dispensary': /if \(isAuthenticated\) await logout\(\);/,
  'crm-roof': /if \(signedIn\) logout\(\);/,
}
for (const [t, rule] of Object.entries(OWN_RESET)) {
  const page = readFileSync(ROOT + `templates/${t}/frontend/src/pages/ResetPasswordPage.tsx`, 'utf8')
  if (!/useAuth\(\)/.test(page) || !rule.test(page)) fail(`${t} ResetPasswordPage must end the signed-in session through the auth context (useAuth().logout) after saving`)
  if (/api\.logout\(\)/.test(page)) fail(`${t} ResetPasswordPage calls api.logout() directly — that clears the tokens and leaves the old person signed in in memory`)
}
// Every template's reset page is either the shared one (re-exported — the check above covers it) or listed here.
let wrappers = 0
for (const t of readdirSync(ROOT + 'templates').filter((d) => /^crm(-|$)/.test(d) && !PARKED.has(d))) {
  const f = ROOT + `templates/${t}/frontend/src/pages/ResetPasswordPage.tsx`
  if (!existsSync(f) || t in OWN_RESET) continue
  if (/ResetPasswordPage as \w+ \} from '\.\.\/shared'/.test(readFileSync(f, 'utf8'))) { wrappers++; continue }
  fail(`${t} has its own ResetPasswordPage (not the shared one) that this guard does not check — add it to OWN_RESET`)
}
// And signing out must always sign out: state cleared even when the server call is refused.
const storeAuth = readFileSync(ROOT + 'templates/crm-store/frontend/src/contexts/AuthContext.tsx', 'utf8')
if (!/try \{ await api\.logout\(\) \} catch[^]*?finally \{[^}]*setUser\(null\)/.test(storeAuth)) fail('crm-store AuthContext.logout must clear the signed-in person in a finally — a refused server call must not stop Sign out')

if (failed) { console.error(`\nreset link while signed in: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`reset link while signed in: ${routes} /reset-password route(s), none wrapped; the shared and store pages end the old session`)
