// CI guard: "today" belongs to the BUSINESS, not to the server.
//
// Render runs UTC, so `new Date(); setHours(0,0,0,0)` is UTC midnight. A crew in Ohio saw their Today
// board roll over at 8pm and "completed today" count only what was finished after 7pm; a dispensary
// filed the last hours of every evening's trade under tomorrow, which is how this was first raised
// (T24 N1). The shared modules carry the same fault for every other vertical.
//
// Two rules, and the second is what makes it safe on seven verticals at once:
//
//   an INSTANT (completed_at, created_at) belongs to the store's day containing it — convert it;
//   a DATE MARKER does not. job.scheduled_date holds both: the jobs API, agreements and bulk reschedule
//   store new Date('2026-09-19') — midnight UTC standing in for a calendar day — while a booking stores
//   the real instant. Converting a marker shifts it a day BACKWARDS in every zone behind UTC, which is
//   the opposite bug. They are told apart by source = 'online_booking', which only the booking sets.
//
// The fallback is UTC everywhere, so a company with no state and no configured zone behaves exactly as
// it did before. This can correct a day or leave it alone; it must never move one the wrong way.
//   bun scripts/check-business-day.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const B = 'packages/tenant-backend/src/'

// ── one definition of the business day ────────────────────────────────────────────────────────────
const day = read(B + 'time/businessDay.ts')
if (!day) fail('the business day must have one home (packages/tenant-backend/src/time/businessDay.ts)')
if (!/export const DEFAULT_BUSINESS_ZONE = 'UTC'/.test(day)) fail("the fallback must be UTC — that is what the old code did, and it is what keeps an unconfigured company unchanged")
if (!/export async function companyTimeZone\(/.test(day)) fail('…with one resolver for a company\'s zone')
if (!/isValidTimeZone\(s\?\.timezone\)/.test(day)) fail('…preferring what the company configured')
if (!/STATE_TIME_ZONES\[String\(row\.state \|\| ''\)/.test(day)) fail('…then what its state implies')
if (!/} catch \{[\s\S]{0,200}return DEFAULT_BUSINESS_ZONE/.test(day)) fail('…and never throwing: an unreadable company row must behave as before, not 500 the dashboard')
if (!/export function storeDayRange\(/.test(day)) fail('…and one definition of the day itself')
if (/const end = new Date\(start\.getTime\(\) \+ 86400000\)/.test(day)) fail('a business day is not always 24 hours — the day the clocks change is 23 or 25, so the end must come from the zone')

// the marker-versus-instant rule, which is the part that could silently lose a day's work
if (!/export const jobLocalDay = /.test(day)) fail('a job\'s own day must be worked out in one place')
if (!/CASE WHEN \$\{source\} = 'online_booking' THEN/.test(day)) fail("…converting ONLY the rows that hold a real instant — a booking — and leaving calendar-day markers alone")
if (!/ELSE \(\$\{scheduledDate\}\)::date END/.test(day)) fail('…so a job made in the CRM keeps the day it was written for, rather than sliding back a day')

// ── the surfaces that decide what "today" means ───────────────────────────────────────────────────
for (const [file, what] of [
  [B + 'reporting/jobsDashboard.ts', "the dashboard's Today board"],
  [B + 'jobs/jobs.ts', "the crew's today list"],
] as Array<[string, string]>) {
  const src = read(file)
  if (!src) { fail(`${file} is missing`); continue }
  if (/const today = new Date\(\); today\.setHours\(0, 0, 0, 0\)/.test(src)) fail(`${what} still uses the SERVER's midnight — that is UTC on Render, and it rolls over mid-shift`)
  if (!/companyTimeZone\(db, /.test(src)) fail(`${what} must resolve the company's zone`)
  if (!/jobLocalDay\(t\.job\.scheduledDate, t\.job\.source, tz\)/.test(src)) fail(`${what} must take each job's day per row, because scheduled_date holds markers AND instants`)
}
// "completed today" reads a real instant, so it takes the day range rather than the per-row rule
{
  const dash = read(B + 'reporting/jobsDashboard.ts')
  if (!/gte\(t\.job\.completedAt, today\), lt\(t\.job\.completedAt, tomorrow\)/.test(dash)) fail('"completed today" must use the store day\'s range — completed_at is an instant, never a marker')
  if (!/storeDayRange\(tz\)/.test(dash)) fail('…and that range must come from the shared definition')
}

// ── things that are deliberately NOT business days ────────────────────────────────────────────────
// A plan's monthly quota and a trial expiry are billing windows. Moving them would change when a
// tenant's allowance resets, which is not what any of this is about.
for (const t of ['crm-salon', 'crm-rv', 'crm-restaurant']) {
  const gate = read(`templates/${t}/backend/src/middleware/featureGate.ts`)
  if (gate && /companyTimeZone|storeDayRange/.test(gate)) fail(`${t} featureGate.ts has been moved onto the business day — a plan quota window is billing, and must not follow the shop's clock`)
}

if (failed) { console.error(`\nbusiness day: ${failed} check(s) FAILED`); process.exit(1) }
console.log("business day: today belongs to the business — instants convert, calendar markers do not, and a company with no zone behaves exactly as before")
