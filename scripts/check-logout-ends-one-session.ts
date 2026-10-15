// CI guard: Sign out ends THIS session, not every session the person has. (E2E Run 2, 10/15)
//
// The servers end one session when the client names its refresh token, and every session when it sends none
// ("no token = all sessions"). crm-store and crm-roof sent none: signing out of one window signed the person out of
// every other window and device — 15 minutes later, when each one's access token ran out and its refresh was refused.
// The tester, switching between owner, manager and staff, lost the owner's window mid-task.
//
//   · every browser API client's call to /api/auth/logout sends { refreshToken }
//   · a template with its own API client that this guard does not know about fails, so a new copy cannot slip past
//   bun scripts/check-logout-ends-one-session.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const PARKED = new Set(['crm-homecare', 'crm-automotive'])

const clients = ['packages/tenant-ui/src/api/client.ts']
for (const t of readdirSync(ROOT + 'templates').filter((d) => /^crm(-|$)/.test(d) && !PARKED.has(d))) {
  const f = `templates/${t}/frontend/src/services/api.ts`
  if (!existsSync(ROOT + f)) continue
  const src = readFileSync(ROOT + f, 'utf8')
  if (/\/api\/auth\/logout/.test(src)) clients.push(f)
  else if (!/from '\.\.\/shared'/.test(src)) fail(`${f}: an API client with no sign-out call and not the shared one — where does this template sign out?`)
}

let calls = 0
for (const f of clients) {
  const src = readFileSync(ROOT + f, 'utf8').replace(/\r\n/g, '\n')
  const at = [...src.matchAll(/\/api\/auth\/logout/g)].map((m) => m.index!)
  if (!at.length) { fail(`${f}: no call to /api/auth/logout`); continue }
  for (const i of at) {
    calls++
    // The call's own arguments: from the path to the end of that line.
    const line = src.slice(i, src.indexOf('\n', i))
    if (!/refreshToken/.test(line)) fail(`${f}: POST /api/auth/logout sends no refreshToken — the server will end EVERY session this person has`)
  }
}

if (failed) { console.error(`\nlogout ends one session: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`logout ends one session: ${calls} sign-out call(s) across ${clients.length} API client(s), each naming its own refresh token`)
