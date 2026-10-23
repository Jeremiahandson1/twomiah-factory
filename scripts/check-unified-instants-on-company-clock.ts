// CI guard: the admin screens print a stored MOMENT on the company's clock, never the reader's (2026-10-22).
//
// `new Date(createdAt).toLocaleString()` prints in whatever zone the browser is in: an owner travelling, or a tester's
// cloud browser on UTC, read a quote approved at 8:30 PM in Chicago as "1:30 AM on the 23rd". Every screen now prints
// moments through packages/tenant-ui/src/time/companyClock.ts (whenDate / whenDateTime / whenTime / momentDate), which
// uses the company's zone from the session. This fails on any `new Date(<value>).toLocale[Date|Time]String(...)` in
// the admin screens or the shared ones that names no timeZone — except a date BUILT from a day ('T12:00:00',
// 'T00:00:00', a template string, or several numbers), which is a calendar day, not a moment.
//
// Home care has its own agency clock and guard (crm/pages/homecare/lib/agencyClock.ts); it is not walked here.
//
//   bun scripts/check-unified-instants-on-company-clock.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const DIRS = ['packages/tenant-ui/src', 'apps/unified/web/src'].map((d) => join(ROOT, d))
const SKIP = [/[\\/]homecare[\\/]/, /time[\\/]companyClock\.ts$/]

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []
})
/** Comments out: prose about the rule is not a breach of it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const CALL = /new Date\(((?:[^()]|\([^()]*\))*)\)\.toLocale(Date|Time)?String\(([^()]*(?:\([^()]*\))?[^()]*)\)/g

let found = 0
for (const dir of DIRS) {
  for (const file of walk(dir)) {
    if (SKIP.some((r) => r.test(file))) continue
    const src = code(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(CALL)) {
      const [all, arg, , opts] = m
      if (/timeZone/.test(opts)) continue
      if (!arg.trim()) continue // now
      if (/T12:00:00|T00:00:00|`/.test(arg) || /^[^(]*,/.test(arg)) continue // a day built from parts
      const line = src.slice(0, m.index).split('\n').length
      console.error(`FAIL ${relative(ROOT, file).replace(/\\/g, '/')}:${line}  ${all.slice(0, 100)}`)
      console.error('     print a stored moment with whenDateTime / momentDate / whenTime (packages/tenant-ui/src/time/companyClock.ts)')
      found++
    }
  }
}
if (found) { console.error(`\n${found} moment(s) printed on the reader's clock`); process.exit(1) }
console.log('instants on the company clock: no bare toLocale* on a stored moment in the admin or shared screens')
