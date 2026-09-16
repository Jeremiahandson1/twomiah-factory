// CI guard: a room or a catering package that upcoming bookings still use cannot be retired — DELETE and
// PUT {active:false} both answer 409 with the count (services/eventBooking.ts upcomingEventsUsing*).
// Retiring stays a soft flag (history keeps the name); it is the pickers that lose a retired item, which
// is why bookings must be moved first. The UI shows the server's reason. (T15 H1, #163)
//   bun scripts/check-events-retire-guard.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
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

for (const [file, what] of [['frontend/src/pages/events/SpacesPage.tsx', 'space'], ['frontend/src/pages/events/MenusPage.tsx', 'package']] as const) {
  const src = read(file)
  if (!new RegExp(`alert\\(\\(err as Error\\)\\.message \\|\\| 'Failed to retire ${what}'\\)`).test(src)) fail(`${file} retire must show the server's reason (the 409 message), not a generic failure`)
}

if (failed) { console.error(`\nevents retire guard: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events retire guard: rooms/packages with upcoming bookings refuse retirement (DELETE + PUT) with the count; UI shows it')
