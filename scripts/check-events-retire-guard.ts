// CI guard: a room or a catering package that upcoming bookings still use cannot be retired — DELETE and
// PUT {active:false} both answer 409 with the count (services/eventBooking.ts upcomingEventsUsing*).
// Retiring stays a soft flag (history keeps the name); it is the pickers that lose a retired item, which
// is why bookings must be moved first. The UI shows the server's reason. (T15 H1, #163)
//   bun scripts/check-events-retire-guard.ts
import { readFileSync } from 'node:fs'
// The ONE comment stripper (scripts/lib/stripComments.ts): string-aware, so a route pattern like
// '/file/*' or a `src/**` in a line comment cannot pair with a later `*/` and delete real code. (T57)
import { stripSource as strip } from './lib/stripComments.ts'
const read = (p: string) => strip(readFileSync(new URL(`../templates/crm-restaurant/${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const svc = read('backend/src/services/eventBooking.ts')
if (!/export async function upcomingEventsUsingSpace\(/.test(svc) || !/export async function upcomingEventsUsingPackage\(/.test(svc)) fail('eventBooking.ts must count upcoming bookings using a space / a package')
if (!/gte\(event\.eventDate, todayUtc\(\)\)/.test(svc)) fail('"upcoming" must mean dated today or later (the dashboard\'s rule)')
if (!/inArray\(event\.status, UPCOMING_HOLDS\)/.test(svc)) fail('a room is held by tentative/confirmed bookings only')
if (!/notInArray\(event\.status, EXIT_STATUSES\)/.test(svc)) fail('a package counts on every upcoming event that is not lost/cancelled')

for (const [file, counter, refusal, notFound] of [
  ['backend/src/routes/eventSpaces.ts', 'upcomingEventsUsingSpace', 'retireSpaceRefusal', "'Space not found'"],
  ['backend/src/routes/menuPackages.ts', 'upcomingEventsUsingPackage', 'retirePackageRefusal', "'Package not found'"],
] as const) {
  const src = read(file)
  if (!new RegExp(`import \\{ ${counter}, ${refusal} \\} from '\\.\\./services/eventBooking\\.ts'`).test(src)) fail(`${file} must import the counter + refusal from eventBooking.ts`)
  const del = src.slice(src.indexOf("app.delete('/:id'"))
  if (!new RegExp(`const n = await ${counter}\\(currentUser\\.companyId, existing\\.id\\)\\s*if \\(n > 0\\) return c\\.json\\(\\{ error: ${refusal}\\(existing\\.name, n\\), upcomingEvents: n \\}, 409\\)`).test(del)) fail(`${file} DELETE must refuse with 409 + count while upcoming bookings use it`)
  if (del.indexOf(notFound) > del.indexOf(`await ${counter}(`)) fail(`${file} DELETE must check existence before counting`)
  const put = src.slice(src.indexOf("app.put('/:id'"), src.indexOf("app.delete('/:id'"))
  if (!new RegExp(`if \\(updates\\.active === false && existing\\.active\\) \\{\\s*const n = await ${counter}\\(currentUser\\.companyId, existing\\.id\\)\\s*if \\(n > 0\\) return c\\.json\\(\\{ error: ${refusal}\\(existing\\.name, n\\), upcomingEvents: n \\}, 409\\)`).test(put)) fail(`${file} PUT {active:false} must apply the same refusal`)
}

/**
 * The screen must SHOW the server's reason — "The Cellar is held by 3 upcoming bookings" — and not
 * swallow it for a generic "Failed to retire".
 *
 * This used to pin the exact expression `alert((err as Error).message || 'Failed to retire space')`,
 * which made it a guard for one spelling rather than for the rule: the moment those refusals moved
 * out of a native pop-up and onto the page (T58), a strictly better screen failed the check. So it
 * now asserts what actually matters, in the retire handler's own catch block:
 *
 *   1. the caught error is read — the SERVER's sentence, not a constant the frontend invented;
 *   2. it reaches something that renders — not console alone, which is a message to nobody.
 *
 * How it is rendered (a page banner, a toast, a pop-up) is the screen's business and may change again.
 */
for (const [file, what] of [['frontend/src/pages/events/SpacesPage.tsx', 'space'], ['frontend/src/pages/events/MenusPage.tsx', 'package']] as const) {
  const src = read(file)

  // the retire handler, by balanced braces from its declaration
  const at = src.search(/const retire\s*=\s*async/)
  if (at < 0) { fail(`${file} has no retire handler to check`); continue }
  let depth = 0, end = -1
  for (let i = src.indexOf('{', at); i < src.length && i >= 0; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  const fn = src.slice(at, end > 0 ? end + 1 : undefined)

  const m = fn.match(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{([\s\S]*)$/)
  if (!m) { fail(`${file} retire must handle the 409 refusal — it has no catch block`); continue }
  const [, caught, body] = m

  // 1. the server's sentence is read
  if (!new RegExp(`(?<![\\w$])${caught}(?![\\w$])`).test(body)) {
    fail(`${file} retire discards the caught error — the owner would see a generic failure instead of "${what} is held by N upcoming bookings"`)
  }
  // 2. and it is handed to something that renders, not only to the console
  const rendering = body
    .split('\n')
    .filter((l) => !/^\s*console\./.test(l.trim()))
    .join('\n')
  if (!new RegExp(`(?<![\\w$])${caught}(?![\\w$])`).test(rendering)) {
    fail(`${file} retire only logs the refusal to the console — nothing on the screen tells the owner why the ${what} would not retire`)
  }
}

if (failed) { console.error(`\nevents retire guard: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events retire guard: rooms/packages with upcoming bookings refuse retirement (DELETE + PUT) with the count; UI shows it')
