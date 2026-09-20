// CI guard: one session token, one key, one owner — and never a cached copy of it.
//
// Roof shipped two keys for one token. AuthContext wrote `token` on login and on every 12-minute
// refresh; ApiClient read `accessToken`, which nothing kept current, and snapshotted it into
// `this.accessToken` in a constructor that runs once per page load. A tester found that copy 5.6 days
// stale and 401ing. Users do not report this as "duplicate storage keys" — they report it as being
// randomly logged out, which is why it survived four rounds.
//
// The fleet convention is `accessToken`: it is what the shared tenant-ui AuthContext uses and what the
// other eight templates read. Roof was the outlier, and several shared files still carry defensive
// `accessToken || token` fallbacks from when that was papered over.
//
// Two rules, because there were two faults:
//   1. only the token module may name a token key;
//   2. a client may not hold its own copy of the token — it reads through at the moment of use.
//   bun scripts/check-one-token-key.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const SRC = 'templates/crm-roof/frontend/src'
const OWNER = `${SRC}/lib/authToken.ts`

const owner = (() => { try { return readFileSync(ROOT + OWNER, 'utf8') } catch { return '' } })()
if (!owner) fail(`${OWNER} is missing — the token needs exactly one owner`)

// ── the module itself ─────────────────────────────────────────────────────────────────────────────
{
  if (!/const ACCESS = 'accessToken'/.test(owner))
    fail("the canonical key must be 'accessToken' — that is what shared tenant-ui and the other eight templates read")
  if (!/const LEGACY_ACCESS = 'token'/.test(owner))
    fail("…and the retired key must still be named, so a browser holding it can be migrated rather than signed out")
  if (!/if \(legacy\) \{ write\(ACCESS, legacy\); drop\(LEGACY_ACCESS\); return legacy \}/.test(owner))
    fail('reading must migrate a legacy token across and retire the old key, or shipping this logs everyone out')
  if (!/catch \{ return '' \}/.test(owner))
    fail('storage can throw in a locked-down browser; a token read must not take the app down')
}

// ── nothing else may name a token key ─────────────────────────────────────────────────────────────
{
  const offenders: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === 'dist') continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.tsx?$/.test(p) || e.startsWith('__head_')) continue
      const rel = p.slice(ROOT.length).replace(/\\/g, '/')
      if (rel === OWNER) continue
      const src = readFileSync(p, 'utf8')
      if (/localStorage\.(get|set|remove)Item\(\s*['"](token|accessToken|refreshToken)['"]/.test(src)) offenders.push(rel)
    }
  }
  walk(ROOT + SRC)
  if (offenders.length)
    fail(`${offenders.length} file(s) reach past the token module and name a key directly — that is how the two keys drifted apart:\n    ${offenders.join('\n    ')}`)
}

// ── and no client may cache the token ─────────────────────────────────────────────────────────────
{
  const api = (() => { try { return readFileSync(ROOT + `${SRC}/services/api.ts`, 'utf8') } catch { return '' } })()
  if (!api) fail(`${SRC}/services/api.ts is missing`)
  if (/constructor\(\)\s*\{[\s\S]{0,300}this\.(access|refresh)Token\s*=\s*localStorage/.test(api))
    fail('ApiClient is snapshotting the token in its constructor again — that copy never sees a refresh, which is the 5.6-day-stale token')
  if (!/get accessToken\(\)\s*\{\s*return getAccessToken\(\)/.test(api))
    fail('…it must read through to the token module at the moment of use')
}

if (failed) { console.error(`\none token key: ${failed} check(s) FAILED`); process.exit(1) }
console.log('one token key: roof has a single session token, owned by lib/authToken.ts, read through on every use')
