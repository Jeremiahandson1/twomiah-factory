// CI guard: an event is validated and written ONE way — services/eventBooking.ts (validateEventInput +
// createEvent: lock, room-clash check, row, hire line) — by POST /events, PUT /events/:id AND the CSV
// importer. The importer once inserted straight into the table (a CSV could double-book a room and save
// impossible dates, times, negative money, made-up statuses/types — T15 B1/H4, M1–M4); the status and
// event-type vocabularies are the frontend's lists, pinned equal here. (#162)
//   bun scripts/check-events-input.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../templates/crm-restaurant/${p}`, import.meta.url), 'utf8'))
const list = (src: string, name: string) => { const m = src.match(new RegExp(`(?:export )?const ${name} = \\[([^\\]]*)\\]`)); return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null }

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const svc = read('backend/src/services/eventBooking.ts')
const fe = read('frontend/src/pages/events/EventsPage.tsx')
const detail = read('frontend/src/pages/events/EventDetailPage.tsx')
for (const [be, feName, feSrc] of [['EVENT_STATUSES', 'STATUSES', fe], ['EVENT_TYPES', 'EVENT_TYPES', fe], ['TIMELINE_DEPARTMENTS', 'DEPARTMENTS', detail]] as const) {
  const a = list(svc, be), b = list(feSrc, feName)
  if (!a || !b) fail(`${be} / ${feName} list not found`)
  else if (a.join(',') !== b.join(',')) fail(`backend ${be} [${a}] must equal frontend ${feName} [${b}] — one vocabulary`)
}
for (const need of ['export function validateEventInput(', 'export function validateTimelineInput(', 'export async function createEvent(', 'pg_advisory_xact_lock', 'export async function findClash(', 'export class SpaceClash', 'export function isCalendarDate(']) {
  if (!svc.includes(need)) fail(`eventBooking.ts must define ${need.replace(/[({]$/, '')}`)
}
// run of show: the same HH:MM + department rules on add and edit (99:99 / "banana" used to save — T16 M3)
const tl = svc.slice(svc.indexOf('export function validateTimelineInput('), svc.indexOf('export class SpaceClash'))
if (!/TIME_RE\.test\(input\.time\.trim\(\)\)/.test(tl) || !/TIMELINE_DEPARTMENTS as readonly string\[\]\)\.includes\(input\.department\)/.test(tl)) fail('validateTimelineInput must check HH:MM time and the department list')
const v = svc.slice(svc.indexOf('export function validateEventInput('), svc.indexOf('export class SpaceClash'))
for (const [re, what] of [[/isCalendarDate\(input\.eventDate\)/, 'a real calendar date'], [/EVENT_STATUSES\.includes\(input\.status\)/, 'status in the enum'], [/EVENT_TYPES\.includes\(input\.eventType\)/, 'type in the enum'], [/TIME_RE\.test\(v\)/, 'HH:MM times'], [/End time must be after the start time/, 'end after start'], [/Guest count must be between 0 and 1,000,000/, 'guest range'], [/cannot be negative/, 'non-negative money']] as const) {
  if (!re.test(v)) fail(`validateEventInput must check ${what}`)
}

const routes = read('backend/src/routes/events.ts')
if (!/import \{[^}]*\bcreateEvent\b[^}]*\} from '\.\.\/services\/eventBooking\.ts'/.test(routes)) fail('routes/events.ts must import the booking write from services/eventBooking.ts')
const post = routes.slice(routes.indexOf("app.post('/', requirePermission('contacts:create')"), routes.indexOf("app.put('/:id', requirePermission('contacts:update')"))
if (!/const vErr = validateEventInput\(body\)/.test(post) || !/db\.transaction\(\(tx: any\) => createEvent\(tx, currentUser\.companyId, body\)\)/.test(post)) fail('POST /events must validate with validateEventInput and write with createEvent')
if (/tx\.insert\(event\)/.test(post)) fail('POST /events must not carry its own insert any more')
const put = routes.slice(routes.indexOf("app.put('/:id', requirePermission('contacts:update')"), routes.indexOf("app.delete('/:id', requirePermission('contacts:update')"))
if (!/const vErr = validateEventInput\(updates, existing\)/.test(put)) fail('PUT /events/:id must validate the patch against the effective values with validateEventInput')
if (/eventValidationError\(/.test(routes) || /^\s*const HELD = /m.test(routes)) fail('routes/events.ts must not keep a second copy of the rules (eventValidationError / HELD)')
const tlPost = routes.slice(routes.indexOf("app.post('/:id/timeline'"), routes.indexOf("app.put('/:id/timeline/:lineId'"))
const tlPut = routes.slice(routes.indexOf("app.put('/:id/timeline/:lineId'"), routes.indexOf("app.delete('/:id/timeline/:lineId'"))
if (!/const vErr = validateTimelineInput\(body\)/.test(tlPost)) fail('POST /events/:id/timeline must validate with validateTimelineInput')
if (!/const vErr = validateTimelineInput\(body, existing\)/.test(tlPut)) fail('PUT /events/:id/timeline/:lineId must validate the patch with validateTimelineInput')

const imp = read('backend/src/services/import.ts')
const ie = imp.slice(imp.indexOf('export async function importEvents('), imp.indexOf('const SPACE_COLUMN_MAP'))
if (!/const vErr = validateEventInput\(eventData\)/.test(ie)) fail('importEvents must validate every row with validateEventInput')
if (!/db\.transaction\(\(tx: any\) => createEvent\(tx, companyId, eventData\)\)/.test(ie)) fail('importEvents must write each row through createEvent (lock + room-clash check)')
if (/db\.insert\(event\)/.test(ie)) fail('importEvents must not insert into event directly')
if (!/e instanceof SpaceClash/.test(ie)) fail('importEvents must report a held room as a row error')
if (!/findClash\(db, companyId, spaceId, eventDateVal\)/.test(ie)) fail('importEvents dry-run must report a held room too')
if (!/Event type must be one of/.test(ie)) fail('importEvents must refuse an unknown event type with the allowed list')
// T16 H4 / N1: no silent fix-ups — an unknown status or room is a row error; contacts are clients with a valid email
if (!/Status must be one of: \$\{EVENT_STATUSES\.join\(', '\)\}/.test(ie)) fail('importEvents must refuse an unknown status with the allowed list (not default it to enquiry)')
if (!/Space "\$\{spaceName\}" not found/.test(ie)) fail('importEvents must refuse a room the venue does not have (not import the row with no room)')
if (/type: 'customer'/.test(imp)) fail("import.ts must not create contacts with type 'customer' (not a contact type the app has)")
if (!/type: 'client', source: 'import'/.test(ie)) fail('importEvents must create the client contact as a client')
if (!/cleanEmail\(getValue\(row, \.\.\.EVENT_COLUMN_MAP\.contactEmail\)\)/.test(ie) || !/z\.string\(\)\.email\(\)/.test(imp)) fail("importEvents must hold an imported contact's email to the contact form's rule")

const errors = read('backend/src/utils/errors.ts')
if (!/case '22008':/.test(errors)) fail("errors.ts must map Postgres 22008 (date out of range) to a 400")

if (failed) { console.error(`\nevents input: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events input: form, edit and CSV import share one validator and one locked, clash-checked booking write; status/type vocabularies match the UI')
