// CI guard: a failed token refresh is not the same thing as a dead session.
//
// Every browser client asks the refresh endpoint one question and acts on the answer. When that question
// is yes/no, everything that is not "yes" becomes "your session is over": tokens cleared, redirected to
// /login. A 502 while Render rolls the service over, a 503 mid-deploy, a dropped connection — each of
// them threw every signed-in user out. That is why a deploy logged everybody out.
//
// There are THREE outcomes, and only one of them ends a session:
//   ok       the refresh worked
//   revoked  401/403 FROM THE REFRESH ENDPOINT — the server saying this token is dead
//   retry    anything else — keep the tokens, surface a retryable error
//
// So: every client that implements its own refresh must separate 401/403 from the rest, and must not
// answer the whole question with a bare boolean.
//   bun scripts/check-refresh-outcomes.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
// "must not appear" checks read CODE only — a comment naming the old shape is documentation, and this
// guard tripped over its own explanation of the defect the first time it ran.
const codeOnly = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')

// Clients that carry their own copy. The other seven verticals re-export
// packages/tenant-ui/src/api/client.ts, which is checked below as the shared one.
//
// crm-homecare is PARKED and still has this defect — it is listed here, and not checked, deliberately:
// an exemption that is written down is a known debt, whereas leaving the file out of the list is a
// silent one. crm-automotive is parked too. Neither is to be edited without being asked.
const PARKED_AND_STILL_BROKEN = ['crm-homecare', 'crm-automotive']
const OWN_CLIENT = [
  'packages/tenant-ui/src/api/client.ts',
  'templates/crm-dispensary/frontend/src/services/api.ts',
  'templates/crm-roof/frontend/src/services/api.ts',
  'templates/crm-store/frontend/src/services/api.ts',
]

for (const rel of OWN_CLIENT) {
  const src = read(rel)
  if (!src) { fail(rel + ' is missing'); continue }
  const code = codeOnly(src)
  // the refresh has to tell a rejected token apart from a server that could not answer
  if (!/status === 401 \|\| \w+\.status === 403/.test(code)) fail(rel + ': the refresh must treat 401/403 from the refresh endpoint as the ONLY revocation — everything else is the server having a bad moment')
  // …and must not collapse the answer back to yes/no
  if (/if \(!res(ponse)?\.ok\) return false/.test(code)) fail(rel + ': a bare "not ok → false" is the defect — every 5xx becomes a sign-out')
  // The single-flight field carries the refresh's answer, so it must carry all three outcomes too:
  // Promise<boolean> invites `if (await this.refreshPromise)`, and 'retry' is truthy — which is the
  // very confusion the three outcomes exist to remove.
  if (/Promise<boolean>/.test(code) && /refresh/i.test(code)) fail(rel + ': the refresh must not answer with a boolean — it has three outcomes, not two')
  // a genuinely revoked session must still end
  if (!/clearTokens\(\)/.test(code)) fail(rel + ': nothing clears the tokens — a revoked session must still end')
}

// The seven thin wrappers must stay thin: re-exporting the shared client is how they inherit this.
const WRAPPERS = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
for (const tpl of WRAPPERS) {
  const rel = 'templates/' + tpl + '/frontend/src/services/api.ts'
  const src = read(rel)
  if (!src) { fail(rel + ' is missing'); continue }
  if (!/from '\.\.\/shared'/.test(src)) fail(rel + ': must re-export the shared client, not grow its own refresh')
  if (/refreshAccessToken|tryRefresh/.test(codeOnly(src))) fail(rel + ': has grown its own refresh — that is how this defect spread in the first place')
}

if (failed) { console.error('\nrefresh outcomes: ' + failed + ' check(s) FAILED (parked, still broken: ' + PARKED_AND_STILL_BROKEN.join(', ') + ')'); process.exit(1) }
console.log('refresh outcomes: only a rejected token ends a session — a server that cannot answer does not (parked, still broken: ' + PARKED_AND_STILL_BROKEN.join(', ') + ')')
