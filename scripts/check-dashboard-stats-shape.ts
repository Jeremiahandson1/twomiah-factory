// CI guard: a screen must read the shape its endpoint actually sends.
//
// T46 found this same mistake three times in one report, in three unrelated places:
//
//   N4   /portal read `stats.revenueToday` and then `stats.revenue.today`; /api/dashboard/stats
//        sends `today.revenue`. Both lookups missed, fell through to the `?? 0` at the end of the
//        chain, and the staff hub showed "$0 / 0 orders today" beside a dashboard reading $225.75
//        and 12. Nothing errored. Nothing logged. The screen just quietly said zero.
//   N12  The Zones screen read `zone.fee`, `zone.minOrder` and `zone.isActive`; the API sends
//        `deliveryFee`, `minimumOrder` and `active`. An active $5/$50 zone rendered as "Inactive,
//        fee $0.00, min $0.00" while the till refused orders under $50 against it.
//   N23  The Referrals screen read camelCase; GET /config returned the raw snake_case row. A
//        250-point reward read back blank, and Min Purchase sat at 0 however often it was set.
//
// `?? 0`, `|| ''` and optional chaining are what make this class silent: the wrong field name is
// indistinguishable from a field that is legitimately empty, so it survives every manual pass and
// only a tester comparing two screens ever notices. TypeScript cannot help either — these responses
// are typed `any`.
//
// So this guard names the fields each of those endpoints does NOT send, and fails if a screen reads
// one. It is deliberately a list of known-wrong names rather than a general checker: a general one
// would need the response types, which do not exist yet.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** field the screen must not read → what the endpoint actually sends */
const FORBIDDEN: { field: RegExp; instead: string; why: string }[] = [
  { field: /\bstats\?\.\s*revenueToday|\bstats\.revenueToday\b/, instead: 'stats.today.revenue', why: 'T46 N4' },
  { field: /\bstats\?\.\s*ordersToday|\bstats\.ordersToday\b/, instead: 'stats.today.orderCount', why: 'T46 N4' },
  { field: /\bstats\?\.\s*cashSessionActive|\bstats\.cashSessionActive\b/, instead: 'stats.openCashSessions.length', why: 'T46 N4' },
  { field: /\bzone\.fee\b/, instead: 'zone.deliveryFee', why: 'T46 N12' },
  { field: /\bzone\.minOrder\b/, instead: 'zone.minimumOrder', why: 'T46 N12' },
  { field: /\bzone\.isActive\b/, instead: 'zone.active', why: 'T46 N12' },
]

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = join(dir, name)
    let s
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(name)) out.push(full)
  }
  return out
}

const roots = [join(ROOT, 'templates'), join(ROOT, 'packages')]
const files = roots.flatMap((r) => walk(r))

// Blank out every comment, keeping the line count so the report still points at the right line.
//
// A comment that EXPLAINS the rule — including the ones in DeliveryPage and CustomerPortal saying
// which names used to be read — is not a violation of it. Checking only for a leading slash-slash
// misses the second and third lines of a JSX comment block, which is how this guard first failed
// on the very comment describing the bug it guards against.
function withoutComments(src: string): string {
  const blankKeepingNewlines = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blankKeepingNewlines)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

const failures: string[] = []
for (const file of files) {
  if (!/[\\/]frontend[\\/]|[\\/]tenant-ui[\\/]/.test(file)) continue
  const lines = withoutComments(readFileSync(file, 'utf8')).split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const rule of FORBIDDEN) {
      if (rule.field.test(line)) {
        failures.push(`${file.replace(ROOT, '')}:${i + 1}  reads a field the API does not send — use ${rule.instead} (${rule.why})`)
      }
    }
  })
}

if (failures.length) {
  console.error('A screen is reading a response field its endpoint never sends:\n')
  for (const f of failures) console.error('  ' + f)
  console.error('\nThese fail silently — the missing field is indistinguishable from an empty one, so the')
  console.error('screen shows zero and nobody finds out until two screens are compared side by side.')
  process.exit(1)
}

console.log(`check-dashboard-stats-shape: ok (${files.length} frontend files scanned, ${FORBIDDEN.length} known-wrong field names)`)
