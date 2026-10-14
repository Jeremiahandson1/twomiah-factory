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
const store = readFileSync(ROOT + 'templates/crm-store/frontend/src/pages/ResetPasswordPage.tsx', 'utf8')
if (!/if \(api\.hasToken\) await api\.logout\(\)/.test(store)) fail('crm-store ResetPasswordPage must end the current session after saving — its sign-in is PublicOnly')

if (failed) { console.error(`\nreset link while signed in: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`reset link while signed in: ${routes} /reset-password route(s), none wrapped; the shared and store pages end the old session`)
