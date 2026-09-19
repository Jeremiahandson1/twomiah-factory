// CI guard: every time this API returns says which zone it is in, and the shop's own clock buckets its hours.
//
// Dispensary T21 M3. A `timestamp` column read through a TYPED drizzle select becomes a Date and
// serialises as an instant ("2026-09-19T06:14:42.188Z"). Read through RAW SQL it comes back as the
// driver's bare text ("2026-09-19 06:14:42.188302") with no zone marker, and a browser reads that as
// LOCAL time — a drawer opened at 01:14 Chicago displayed as 6:14 AM. Orders were right and cash was
// wrong for exactly that reason, and the audit log joined them the moment it started working: it is
// raw SQL too. ~40 routes reach for db.execute, so this is stamped once at the edge.
//
// Peak Hours separately bucketed EXTRACT(HOUR FROM created_at) — UTC — so a 7pm Friday rush charted in
// the small hours of Saturday and "peak hour" named a time the shop was shut.
//   bun scripts/check-times-carry-their-zone.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
// "must not appear" checks run against CODE only: a comment explaining the old bug names it on purpose,
// and that is documentation, not a regression.
const codeOnly = (src: string) => src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-dispensary/backend/src/'

const iso = read(B + 'utils/isoTime.ts')
if (!iso) fail('utils/isoTime.ts is missing — what a time looks like leaving this API needs one definition')
// the marker is added, never a shift: the stored values are already UTC
if (!/return `\$\{m\[1\]\}T\$\{m\[2\]\}\.\$\{millis\}Z`/.test(iso)) fail('a naive timestamp must gain a Z, not be re-interpreted into another zone')
if (!/const millis = m\[3\] \? \(m\[3\] \+ '000'\)\.slice\(1, 4\) : '000'/.test(iso)) fail("Postgres microseconds must TRUNCATE to milliseconds, so a time never moves forward")
// only bare timestamps — anything already carrying a zone must be left alone
if (!/const NAIVE_TIMESTAMP = \/\^\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\[ T\]\(\\d\{2\}:\\d\{2\}:\\d\{2\}\)\(\\\.\\d\{1,6\}\)\?\$\//.test(iso)) fail('the pattern must be anchored and zone-less, or it would rewrite times that are already correct and dates that are not times')
if (!/if \(depth > 12 \|\| value == null\) return value/.test(iso)) fail('the walk must be depth-limited')

// stamped once, at the edge, over the whole API
const idx = read(B + 'index.ts')
if (!idx) fail('the dispensary index is missing')
if (!/app\.use\('\/api\/\*', async \(c, next\) => \{\n  await next\(\)\n  if \(!\(c\.res\.headers\.get\('content-type'\) \|\| ''\)\.includes\('application\/json'\)\) return/.test(idx)) fail('the normalizer must run over every /api response, not route by route — ~40 routes use raw SQL and the next one would have the bug again')
if (!/normalizeTimestamps\(body\)/.test(idx)) fail('…and must actually stamp the body')
if (!/headers\.delete\('content-length'\)/.test(idx)) fail('…dropping the stale content-length, since the body changes length')

// the shop's own clock
if (!/export function storeTimeZone\(co: any\): string/.test(iso)) fail('the store needs one answer for which clock it runs on')
if (!/if \(isValidTimeZone\(configured\)\) return configured/.test(iso)) fail('…an explicit setting wins')
if (!/const byState = STATE_TIME_ZONES\[String\(co\?\.state \|\| ''\)\.trim\(\)\.toUpperCase\(\)\]/.test(iso)) fail('…otherwise the licensed state the company already records decides it')
if (!/export const DEFAULT_TIME_ZONE = 'UTC'/.test(iso)) fail('…and with neither, UTC rather than an invented offset')
if (!/try \{ new Intl\.DateTimeFormat\('en-US', \{ timeZone: tz \}\); return true \} catch \{ return false \}/.test(iso)) fail('a zone name must be validated before it reaches AT TIME ZONE, or an unknown name takes the chart down')

const an = read(B + 'routes/analytics.ts')
if (/EXTRACT\(HOUR FROM created_at\)/.test(codeOnly(an))) fail('Peak Hours must not bucket on UTC — that charts a 7pm rush in the small hours of the next day')
if (!/EXTRACT\(HOUR FROM \(created_at AT TIME ZONE 'UTC' AT TIME ZONE \$\{tz\}\)\)::int as hour/.test(an)) fail('…it must label the stored time UTC and convert it to the store zone')
if (!/const tz = storeTimeZone\(coRow\)/.test(an)) fail('…using the shared store-zone rule')
if (!/timeZone: tz/.test(an)) fail('…and the response must name the clock it used')

if (failed) { console.error(`\ntimes carry their zone: ${failed} check(s) FAILED`); process.exit(1) }
console.log('times carry their zone: every /api time leaves as an instant, and Peak Hours buckets on the shop clock')
