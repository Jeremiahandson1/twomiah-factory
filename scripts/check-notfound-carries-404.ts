// CI guard: a service must not throw a bare "not found" Error.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// A service that does `throw new Error('Quote not found')` turns a missing row into
// `{"error":"Internal server error"}` with status 500. The caller is told the server broke when the
// truth is that a record is not there — and on a 500 in production the real message is suppressed, so
// nobody downstream can even see which record it was.
//
// 104 of these were sitting in 11 templates. None of them was reachable by any test until the shared
// contract test started probing writes: DELETE a comment, approve a selection, update a takeoff item,
// export a sheet to a purchase order — every one answered 500 for a ghost id.
//
// Every template's error handler maps `err.status`, so the fix is a thrown error that names its own:
// `utils/errors.ts` exports `notFound()`. crm-roof needed its handler taught to honour a 4xx first —
// it ended at a hard 500 — which is exactly the kind of thing a per-template sweep misses and a rule
// does not.
//
// ── the rule ────────────────────────────────────────────────────────────────────────────────────
//
// In a template's backend/src, no `throw new Error('… not found …')`. Use notFound(), or return the
// 404 from the route. A route that already checks and returns c.json(…, 404) is untouched by this.
//
//   bun scripts/check-notfound-carries-404.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/**
 * templates/pricing is a RATCHET elsewhere too (check-selected-columns-exist.ts): it is a standalone
 * product with no tenant whose backend cannot serve a request at all, so its two remaining bare
 * throws are counted, not fixed. The count may not grow.
 */
const RATCHET: Record<string, number> = { pricing: 3 }

const SKIP = new Set(['node_modules', 'dist', 'build', '.git'])
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith('.ts')) out.push(p)
  }
  return out
}
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const BARE = /throw new Error\(\s*['"`][^'"`]*not found[^'"`]*['"`]/gi

let templates = 0, scanned = 0
const counts = new Map<string, string[]>()
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const dir = join(ROOT, 'templates', t, 'backend/src')
  if (!existsSync(dir)) continue
  templates++
  for (const f of walk(dir)) {
    scanned++
    const src = strip(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(BARE)) {
      const line = src.slice(0, m.index).split('\n').length
      const where = `${f.slice(f.indexOf('templates'))}:${line}`
      if (t in RATCHET) { counts.set(t, [...(counts.get(t) || []), where]); continue }
      fail(`${where} throws a bare not-found Error, so it reaches the client as 500 "Internal server error". Use notFound() from utils/errors.ts, or return c.json({...}, 404) in the route.`)
    }
  }
}

for (const [t, expected] of Object.entries(RATCHET)) {
  const found = counts.get(t)?.length ?? 0
  if (found > expected) fail(`${t}: ${found} bare not-found throws, up from the pinned ${expected} — ${(counts.get(t) || []).join(', ')}`)
  else if (found < expected) fail(`${t}: ${found} bare not-found throws, down from the pinned ${expected} — lower RATCHET to ${found} to lock it in`)
  else if (found) console.log(`note: ${t} carries ${found} known bare not-found throw(s) and is not getting worse (undeployed standalone product)`)
}

if (templates === 0) fail('no template backend/src was found — this guard has stopped looking at anything')
console.log(failed === 0
  ? `OK: ${templates} template(s), ${scanned} files — every not-found carries its own 404`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)
