// CI guard: the dashboard's panels agree with its own tiles, and a panel that fails says so.
//
// Salon T20 M1 — the "Appointments Today" tile read "1 — 5 in the next 7 days" while the "Upcoming
// Appointments" panel on the same screen said "Nothing scheduled". /api/dashboard/stats returned
// appointments.upcoming7 = 5; /api/dashboard/recent-activity returned upcomingAppointments: []. A
// fresh appointment two days out raised the tile from 4 to 5 and left the panel at zero rows.
//
// The cause: UPCOMING_APPT was declared inside the /stats handler and referenced from
// /recent-activity — a ReferenceError on every single request, swallowed whole by that handler's
// safe() wrapper. The panel was not empty because of the data; it never ran at all. It had been that
// way for six builds because nothing ever said a word.
//
// So: the shared predicates live at module scope where both handlers can see them, and safe() logs
// what it swallowed. A panel degrading is fine. A panel degrading in silence is how this survived.
//   bun scripts/check-dashboard-panels-load.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const src = read('templates/crm-salon/backend/src/routes/dashboard.ts')
if (!src) fail('the salon dashboard routes are missing')

// One definition, visible to every handler that needs it.
const moduleScoped = /^const LIVE_APPT = sql`/m.test(src) && /^const UPCOMING_APPT = sql`/m.test(src)
if (!moduleScoped) fail('LIVE_APPT and UPCOMING_APPT must be declared at MODULE scope — declared inside one handler and used from another, they are a ReferenceError on every request')
if (/^ {2}const UPCOMING_APPT = sql`/m.test(src)) fail('…and must not be re-declared inside a handler, which is what hid the first one')

// Every swallowed failure is reported.
if (/catch \{ return fallback \}/.test(src)) fail('safe() must not swallow a panel failure silently — that is how a ReferenceError became an empty panel nobody could explain')
if ((src.match(/catch \(err: any\) \{ console\.error\('\[dashboard\] panel failed to load:'/g) || []).length < 2) fail('…every safe() wrapper on this page must log, not just one')

// The panel names whoever is in the chair, including a stylist with no login.
if (!/leftJoin\(teamMember, eq\(appointment\.stylistMemberId, teamMember\.id\)\)/.test(src)) fail('the Upcoming Appointments panel must read a roster stylist\'s name too — they can hold a chair now (T20 H1)')
if (!/stylistFirstName: a\.stylistFirstName \?\? \(parts\[0\] \|\| null\)/.test(src)) fail('…and fall back to it, or the chair shows blank')

if (failed) { console.error(`\ndashboard panels load: ${failed} check(s) FAILED`); process.exit(1) }
console.log('dashboard panels load: the shared predicates are module-scoped, every panel failure is logged, and the upcoming panel names any stylist')
