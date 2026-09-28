// CI guard: a route a template deliberately left public must still be reachable.
//
//   bun run scripts/check-public-routes-reachable.ts
//
// Every CRM keeps provider webhooks and customer-device endpoints public by registering them ABOVE
// the router's own `app.use('*', authenticate)`. That is only half the story. Hono runs a
// MOUNT-LEVEL `.use()` from index.ts BEFORE the router's handlers, so
//
//     app.use('/api/pay-by-bank/*', authenticate, requireEnabledFeature('pay_by_bank'))
//
// authenticates the webhook too — and requireEnabledFeature answers 401 on its own, because it
// resolves the tenant from user.companyId. The endpoint is then unreachable by the only caller it
// has, silently, with no error anywhere but the provider's dashboard.
//
// That is not hypothetical. It had killed six endpoints in crm-dispensary: Plaid's ACH webhook (so
// settled and failed transfers never updated ach_transactions and ACH payments stayed pending
// forever), the marketplace partner webhook, the website-analytics beacon, a signage screen's
// heartbeat, and curbside + QR customer check-in. An authenticated route sweep cannot find this —
// with a token those endpoints answer normally. Only a call with NO token shows it, which is exactly
// how the real caller behaves.
//
// The check: for each template, find the routes registered above a router's own blanket
// authenticate, resolve each one's full path through index.ts, and fail if that path falls under a
// mount-level middleware that authenticates — unless the mount explicitly exempts it.
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const TPL = path.join(ROOT, 'templates')
const read = (p: string) => fs.readFileSync(p, 'utf8').split('\r').join('')
const noComments = (s: string) => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

/** '/api/signage/screens/*\/heartbeat' matches '/api/signage/screens/abc/heartbeat' */
function segMatch(pattern: string, pathname: string) {
  const a = pattern.split('/'), b = pathname.split('/')
  return a.length === b.length && a.every((s, i) => s === '*' || s === b[i])
}

const errors: string[] = []
let checkedTemplates = 0
let publicRoutes = 0

for (const t of fs.readdirSync(TPL).sort()) {
  const be = path.join(TPL, t, 'backend', 'src')
  const indexFile = path.join(be, 'index.ts')
  const routesDir = path.join(be, 'routes')
  if (!fs.existsSync(indexFile) || !fs.existsSync(routesDir)) continue
  checkedTemplates++

  const index = noComments(read(indexFile))

  // router identifier -> mount prefix
  const mountOf = new Map<string, string>()
  for (const m of index.matchAll(/import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]\.\/routes\/([\w.-]+?)(?:\.ts)?['"]/g)) {
    const re = new RegExp(`app\\.route\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*,\\s*${m[1]}\\b`)
    const hit = re.exec(index)
    if (hit) mountOf.set(m[2], hit[1])
  }

  // Mount-level middleware in index.ts that authenticates, with any exempt patterns it declares.
  // Exemptions are the string literals that follow the feature id(s) in a familyGate(...) call.
  type Mount = { pattern: string; exempt: string[]; line: number }
  const mounts: Mount[] = []
  {
    const lines = index.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,(.*)$/.exec(lines[i])
      if (!m) continue
      const [, pattern, rest] = m
      if (!/\bauthenticate\b|\bfamilyGate\b/.test(rest)) continue
      // literals after the first argument are exempt path patterns (familyGate('feat', '/api/x/y'))
      const exempt = [...rest.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map(x => x[1])
      mounts.push({ pattern, exempt, line: i + 1 })
    }
  }
  if (!mounts.length) continue

  for (const f of fs.readdirSync(routesDir).filter(x => x.endsWith('.ts')).sort()) {
    const src = read(path.join(routesDir, f))
    const lines = src.split('\n')
    const base = f.replace(/\.ts$/, '')
    const prefix = mountOf.get(base)
    if (!prefix) continue

    // Where does this router start authenticating everything?
    let authFrom = Infinity
    for (let i = 0; i < lines.length; i++) {
      if (/\.use\(\s*['"`]\*['"`][^)]*\bauthenticate\b/.test(lines[i])) { authFrom = i; break }
    }
    if (authFrom === Infinity) continue // no blanket authenticate: nothing is "deliberately above" it

    for (let i = 0; i < authFrom; i++) {
      const m = /\.(post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]\s*,?\s*(.*)/.exec(lines[i])
      if (!m) continue
      const [, verb, sub, decl] = m
      if (/\bauthenticate\b/.test(decl)) continue // this one opts INTO auth explicitly
      publicRoutes++

      const full = (prefix + sub).replace(/\/+$/, '') || prefix
      const probe = full.replace(/:[^/]+/g, 'x') // :id -> a concrete segment
      for (const mt of mounts) {
        const mp = mt.pattern.replace(/\/\*$/, '')
        const covers = mt.pattern.endsWith('/*') ? (probe === mp || probe.startsWith(mp + '/')) : probe === mt.pattern
        if (!covers) continue
        if (mt.exempt.some(e => segMatch(e, probe))) continue
        errors.push(
          `${t}: ${verb.toUpperCase()} ${full} is registered above ${f}'s own authenticate (public by ` +
          `design) but index.ts:${mt.line} mounts '${mt.pattern}' with authenticate, so it answers 401 ` +
          `to its caller. Exempt it at that mount.`
        )
        break
      }
    }
  }
}

for (const e of errors) console.error('ERROR', e)
console.log(`\npublic-route reachability: ${checkedTemplates} template(s), ${publicRoutes} deliberately-public write route(s), ${errors.length} unreachable`)
if (errors.length) process.exit(1)
