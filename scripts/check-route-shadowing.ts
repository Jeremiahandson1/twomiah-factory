// CI guard: a literal path must not be declared after a parameter route that swallows it.
//
// WHY THIS EXISTS. Hono matches in REGISTRATION ORDER, so `app.get('/tickets/:id')` declared above
// `app.get('/tickets/patterns')` answers every request for the second one as a lookup for a ticket
// whose id is the word "patterns". The endpoint is not slow or wrong — it is unreachable.
//
// Found twice before this guard:
//   · T34, bills: GET /:id had to go AFTER /summary or the AP total started looking for a bill
//     called "summary". Caught while writing it, and only because a money figure went missing.
//   · T38, support: /tickets/patterns sat below /tickets/:id in NINE of the ten templates carrying
//     it, answering {"error":"Ticket not found"} for the life of the endpoint. crm-dispensary had it
//     the right way round — fixed there in a dispensary round, never propagated. No screen calls it,
//     which is why nobody noticed.
//
// A reviewer cannot see this: both lines are correct alone, the file reads naturally, and the only
// symptom is a 404 that looks like missing data.
//
// ── two things this guard had to get right about ITSELF (T38) ───────────────────────────────────
//
// ONE FILE CAN HOLD TWO ROUTERS. jobs.ts exports createJobRoutes AND createMediaRoutes, each with
// its own `new Hono()`. Comparing across them reported the media wildcard as shadowed by the jobs
// `/:id` — two routes that never meet. Declarations are therefore grouped per app instance.
//
// AND IT MUST NAME THE REAL LINE. The first version scanned comment-stripped source, whose line
// numbers do not match the file: it reported line 547 for a route on line 617. So it reads raw lines
// and skips the comment-shaped ones instead.
//
//   bun scripts/check-route-shadowing.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/**
 * PARKED templates are not modified — the project's own convention for crm-automotive, and homecare
 * is parked too. Their faults are recorded here rather than fixed, so the guard can stay at zero for
 * everything that is actually worked on.
 */
const PARKED = /templates[\\/](crm-automotive|crm-homecare)[\\/]/

const files: string[] = []
const walk = (dir: string) => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|shared|dist|migrations/.test(e.name)) walk(p) }
    else if (e.name.endsWith('.ts')) files.push(p)
  }
}
for (const tpl of readdirSync(join(ROOT, 'templates'))) walk(join(ROOT, 'templates', tpl, 'backend', 'src', 'routes'))
walk(join(ROOT, 'packages', 'tenant-backend', 'src'))

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
let checked = 0, routes = 0

for (const file of files) {
  if (PARKED.test(file)) continue
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  if (!/app\.(get|post|put|patch|delete)\('/.test(raw)) continue
  checked++
  const lines = raw.split('\n')

  /**
   * Declarations in order, grouped by which router they belong to. A new group starts at each
   * `new Hono()` — which is one per factory, and one per module-level router.
   */
  type Decl = { method: string; path: string; line: number }
  const groups: Decl[][] = [[]]
  lines.forEach((l, i) => {
    const trimmed = l.trim()
    // Comment-shaped lines never declare a route, and a comment QUOTING one must not be read as one.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (/new Hono\(\)/.test(l)) { groups.push([]); return }
    const m = /^\s*app\.(get|post|put|patch|delete)\('([^']*)'/.exec(l)
    if (m && METHODS.includes(m[1])) groups[groups.length - 1].push({ method: m[1], path: m[2], line: i + 1 })
  })
  routes += groups.reduce((n, g) => n + g.length, 0)

  for (const decls of groups) {
    for (const method of METHODS) {
      const ofMethod = decls.filter((d) => d.method === method)
      for (let i = 0; i < ofMethod.length; i++) {
        const earlier = ofMethod[i]
        const eSegs = earlier.path.split('/').filter(Boolean)
        const eParam = eSegs.findIndex((s) => s.startsWith(':'))
        if (eParam < 0) continue   // only a parameter route can shadow

        for (let j = i + 1; j < ofMethod.length; j++) {
          const later = ofMethod[j]
          const lSegs = later.path.split('/').filter(Boolean)
          if (lSegs.length !== eSegs.length) continue
          const at = lSegs[eParam]
          if (at === undefined || at.startsWith(':')) continue
          // A wildcard is a deliberate catch-all and BELONGS last; it is not a shadowed literal.
          if (at === '*' || later.path.endsWith('/*')) continue
          if (!eSegs.slice(0, eParam).every((s, k) => s === lSegs[k])) continue
          const tailCollides = eSegs.slice(eParam + 1).every((s, k) => {
            const o = lSegs[eParam + 1 + k]
            return s === o || (s.startsWith(':') && o !== undefined)
          })
          if (!tailCollides) continue
          fail(`${relative(ROOT, file).replace(/\\/g, '/')}: ${method.toUpperCase()} '${later.path}' (line ${later.line}) is unreachable — '${earlier.path}' (line ${earlier.line}) is declared first and Hono matches in order, so it answers instead. Move the literal route above the parameter one.`)
        }
      }
    }
  }
}

if (failed) {
  console.error(`\nroute shadowing: ${failed} unreachable route(s).`)
  process.exit(1)
}
console.log(`route shadowing: ${routes} declarations across ${checked} router file(s); no literal path is shadowed by an earlier parameter route`)
