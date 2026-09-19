// CI guard: an audience type we don't know is refused instead of quietly meaning "everyone", quote stats carry one
// refused bucket under the word the vertical uses, a refused lead source names the ones we connect to, and clocking
// straight back out discards the clock-in instead of saving a 0.00-hour row. (Landscaping T21 M4, L5, L6, L7)
//   bun scripts/check-audience-quotes-leads-time.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// M4 — /audience/preview must refuse an audience it doesn't know (it answered with the whole list)
const marketing = read('packages/tenant-backend/src/marketing/marketing.ts')
const preview = marketing.split('\n').find((l) => l.includes("app.post('/audience/preview'")) || ''
if (!/!AUDIENCE_TYPES\.includes\(b\.audienceType\)\) return c\.json\(\{ error: /.test(preview)) fail('an unknown audienceType must be refused, not treated as "all"')
if (!/Audience must be one of: \$\{AUDIENCE_TYPES\.join\(', '\)\}/.test(preview)) fail('the refusal must name the audiences we support')
if (/AUDIENCE_TYPES\.includes\(b\.audienceType\) \? b\.audienceType : 'all'/.test(preview)) fail('the silent fallback to "all" must be gone')

// L5 — one "customer said no" bucket in quote stats, under this vertical's word
const quotes = read('packages/tenant-backend/src/invoicing/quotes.ts')
const stats = quotes.slice(quotes.indexOf("app.get('/stats'"), quotes.indexOf("app.get('/:id'"))
if (!/const refused = o\.hasDeclinedAt \? 'declined' : 'rejected'/.test(stats)) fail("quote stats must name the refused bucket the way the vertical does (Decline vs Reject)")
if (!/\{ total: quotes\.length, draft: 0, sent: 0, approved: 0, \[refused\]: 0, expired: 0, totalValue: 0, approvedValue: 0 \}/.test(stats)) fail('quote stats must not carry both a rejected and a declined figure')
if (!/const k = q\.status === 'rejected' \|\| q\.status === 'declined' \? refused : q\.status/.test(stats)) fail('a quote in either refused status must be counted in that one bucket')

// L6 — a lead source we don't connect to says which ones we do
const leads = read('packages/tenant-backend/src/leads/leads.ts')
if (!/is not a lead source we connect to\. Choose one of: \$\{platforms\.join\(', '\)\}/.test(leads)) fail('an unknown lead source must list the platforms this vertical connects to')
if (/error: `Unknown lead source "\$\{platform\}"`/.test(leads)) fail('the bare "Unknown lead source" message must be gone')

// L7 — clocking straight back out is a mis-click, not a 0.00-hour shift
const time = read('packages/tenant-backend/src/time/time.ts')
if (!/const MIN_CLOCK_MINUTES = 1/.test(time)) fail('there must be a minimum clock-in length')
if (!/if \(elapsedMinutes < MIN_CLOCK_MINUTES\) \{/.test(time)) fail('a clock-out under that minimum must be handled separately')
if (!/await db\.delete\(t\.timeEntry\)\.where\(and\(eq\(t\.timeEntry\.id, open\.id\), eq\(t\.timeEntry\.companyId, currentUser\.companyId\)\)\)/.test(time)) fail('the discarded clock-in must be removed, not saved as 0.00 hours')
if (!/discarded: true, message: 'That clock-in lasted less than a minute/.test(time)) fail('the answer must say nothing was recorded')
if (!/if \(worked <= 0\) return c\.json\(\{ error: 'Break is longer than the time worked' \}, 400\)/.test(time)) fail('a break longer than the shift must be refused on clock-out, as it is on a manual entry')
const timePage = read('packages/tenant-ui/src/people/TimePage.tsx')
if (!/r\?\.discarded \? \(r\.message \|\| 'That clock-in was too short to record'\)/.test(timePage)) fail('the Time page must not report a discarded clock-in as "Clocked out — 0.00 h"')

// T29 L1 — hours are worked before they are logged. A mistyped year was accepted and then fell outside every dated
// window, so the hours did not read wrong in Reports, they disappeared: 22.5 worked, 18.5 reported.
if (!/const DATE_SLACK_MS = 24 \* 60 \* 60 \* 1000/.test(time)) fail('the slack a date-only string needs (UTC midnight vs a caller already on tomorrow) must be stated, not buried in a literal')
if (!/const notFuture = \(v: unknown\) =>/.test(time)) fail('a time entry date must be bounded — an unbounded one goes missing rather than reading wrong')
// anchored on the end of the expression: a bound multiplied back out to a century reads the same up to here
if (!/ms <= Date\.now\(\) \+ DATE_SLACK_MS \}/.test(time)) fail('…bounded at one day out, and no further')
if (!/\.refine\(notFuture, \{ message: 'Time can only be logged for a date that has happened' \}\)/.test(time)) fail('…on the shared entry schema, so the bound covers the edit as well as the entry')
if (!/d\.getTime\(\) - d\.getTimezoneOffset\(\) \* 60000/.test(timePage)) fail("the Time page must date an entry by the person's own day — toISOString() rolls over at UTC midnight and pre-filled tomorrow all evening")
if (!/<input type="date" max=\{today\(\)\}/.test(timePage)) fail('the date box must stop at today, so the typo is caught at the picker and not only by the API')

if (failed) { console.error(`\naudience, quote stats, lead sources and the clock: ${failed} check(s) FAILED`); process.exit(1) }
console.log('audience, quote stats, lead sources and the clock: an unknown audience is refused, one refused bucket, lead sources are named, a mis-clicked clock-in is discarded')
