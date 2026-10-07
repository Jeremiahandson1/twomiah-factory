// CI guard: every copy of the session cap agrees, and none of them is small enough to evict a
// working browser session.
//
//   Owner: "Roofing was signed out while two copies of the app refreshed the token at the same
//   moment. That could also explain the sign-outs after deploys whenever more than one tab of a
//   tenant is open."
//
// It was not a refresh race — there is no token rotation in this product, deliberately, and
// /refresh returns the SAME refresh token. It was MAX_SESSIONS_PER_USER. storeRefreshToken keeps
// `slice(-MAX)` with newest last, so sign-in number MAX+1 drops the FIRST entry: the long-lived
// browser session somebody is working in, evicted in favour of a caller that signed in once and
// will never come back.
//
// WHY A GUARD AND NOT JUST THE FIX. The value lives in FOUR places — the shared module plus three
// template forks of auth.ts — and raising it in the shared one alone would have missed crm-roof,
// which is the exact tenant the owner reported. That is this project's most expensive recurring
// mistake: a report names one place, the fix lands there, and the siblings keep the bug.
//
// The rule is agreement, not a particular number. If a later round wants 80, it changes everywhere
// or this fails.
//
//   bun scripts/check-session-cap-agrees.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { console.error(`FAIL: ${m}`); failed++ }

// A cap below this cannot hold a person's devices AND the automation that shares these accounts.
const FLOOR = 25

const sites: Array<{ file: string; value: number }> = []
const read = (rel: string) => {
  const p = `${ROOT}${rel}`
  if (!existsSync(p)) return
  const m = /const\s+MAX_SESSIONS_PER_USER\s*=\s*(\d+)/.exec(readFileSync(p, 'utf8'))
  if (m) sites.push({ file: rel, value: Number(m[1]) })
}

read('packages/tenant-backend/src/auth/auth.ts')
for (const t of readdirSync(`${ROOT}templates`)) read(`templates/${t}/backend/src/routes/auth.ts`)

if (sites.length < 2) fail(`only ${sites.length} copy of MAX_SESSIONS_PER_USER found — the walk is not reaching the forks, so this guard is proving nothing`)

const values = [...new Set(sites.map(s => s.value))]
if (values.length > 1) {
  fail(`the session cap disagrees between copies: ${sites.map(s => `${s.file} = ${s.value}`).join(' | ')}\n`
    + `      A fork left behind keeps the bug for its own tenant. crm-roof is how this was found.`)
}
for (const s of sites) {
  if (s.value < FLOOR) {
    fail(`${s.file} caps sessions at ${s.value}. Below ${FLOOR}, ordinary use evicts a working browser\n`
      + `      session: these accounts are shared between a person's tabs, the QA agents and every\n`
      + `      verification script, and storeRefreshToken drops the OLDEST when the cap is reached.`)
  }
}

console.log(`${sites.length} cop${sites.length === 1 ? 'y' : 'ies'} of the session cap: ${sites.map(s => `${s.file.split('/').slice(-4, -3)[0] || 'shared'}=${s.value}`).join(', ')}`)
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log(`All agree at ${values[0]}, which is above the ${FLOOR} floor.`)
