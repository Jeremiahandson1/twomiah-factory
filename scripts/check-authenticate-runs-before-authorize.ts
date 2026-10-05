/**
 * GUARD: a route's permission gate must never run before `authenticate`.
 *
 * `requirePermission` reads the caller off the context and answers
 *
 *     if (!userRole) return c.json({ error: 'Authentication required' }, 401)
 *
 * so a chain written gate-first refuses EVERY caller — the owner included — with a message about
 * authentication that is not the real reason. Thirteen roof routes shipped like that:
 *
 *     app.post('/purchase', requirePermission('roof-reports:purchase'), authenticate, …)
 *
 * WHY NOTHING ELSE CATCHES THIS, which is the whole reason for a guard rather than a test:
 *
 *   · a live probe says it works. All three affected routers are mounted in index.ts through the
 *     feature-gate loop — `app.use(path, skipPublic(authenticate), …)` — so authenticate had already
 *     run and the in-route order never mattered. The owner's DELETE answered 404, not 401.
 *   · the suites only catch it where a test happens to mount that router ALONE. Two assertions in
 *     tests/roof/t43-roof-write-controls.test.ts came back 401 and that is how it was found — but a
 *     module with no behaviour test stays silent.
 *   · typechecking and parsing cannot see it: both orders are valid Hono.
 *
 * So what held the fleet up was a list in a different file. Take a prefix out of that loop, or mount
 * one of these routers anywhere else, and a handful of writes start refusing everybody.
 *
 * THE RULE: within a single `app.<verb>(...)` registration, if the chain names both `authenticate`
 * and a `require*Permission(...)`, authenticate must come first. Offsets, not the presence of a line
 * — a gate below its authentication is the thing being checked.
 *
 * Deliberately NOT checked here: whether a route has a gate at all (that is the write-control
 * guards' job), and app.use-level ordering, which Hono applies in registration order and which the
 * middleware-order guard already covers for the files that use it.
 */
import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.argv[2] || process.cwd()
let failures = 0
const fail = (msg: string) => { console.log(`FAIL: ${msg}`); failures++ }

function walk(dir: string, out: string[] = []) {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    let s: ReturnType<typeof statSync>
    try { s = statSync(p) } catch { continue }
    if (s.isDirectory()) {
      if (e === 'node_modules' || e === 'dist' || e === '.git') continue
      walk(p, out)
      continue
    }
    if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

const roots = [join(ROOT, 'templates'), join(ROOT, 'packages')]
let scanned = 0
let withBoth = 0

for (const root of roots) {
  for (const abs of walk(root)) {
    const src = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
    if (!/require(?:Any)?Permission\(/.test(src)) continue
    scanned++
    const rel = abs.slice(ROOT.length + 1).replace(/\\/g, '/')
    // One registration = app.<verb>('path', ...middleware, handler) up to the end of that line.
    // The chain of interest always sits on the registration line in this codebase; a multi-line
    // chain would simply not match, and is covered by the fact that `authenticate` would then not
    // be on the same line as the gate either.
    for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2\s*,([^\n]*)/g)) {
      const chain = m[4]
      const permAt = chain.search(/require(?:Any)?Permission\(/)
      const authAt = chain.search(/\bauthenticate\b/)
      if (permAt === -1 || authAt === -1) continue
      withBoth++
      if (permAt < authAt) {
        const line = src.slice(0, m.index!).split('\n').length
        fail(
          `${rel}:${line} — ${m[1].toUpperCase()} ${m[3] || '/'} authorises before it authenticates. `
          + `requirePermission answers 401 to EVERYBODY when no user is on the context yet. `
          + `Put authenticate first: app.${m[1]}('${m[3]}', authenticate, requirePermission(…), …)`,
        )
      }
    }
  }
}

if (!withBoth) fail('found no route naming both authenticate and a permission gate — the walk is broken, not the code')

console.log(
  failures
    ? `\nauthenticate-before-authorize: ${failures} route(s) FAILED`
    : `authenticate-before-authorize: ok — ${withBoth} route(s) across ${scanned} file(s) authenticate before they authorise`,
)
process.exit(failures ? 1 : 0)
