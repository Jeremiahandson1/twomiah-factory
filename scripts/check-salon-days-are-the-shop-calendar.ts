// A salon date is a day on the shop's calendar, never UTC's.
//
// `new Date().toISOString().slice(0, 10)` reads as "today" and is not: it is today in UTC. Anywhere
// west of UTC it flips early — at 7pm in Chicago it is already tomorrow — and evening is exactly when
// a salon is still checking people out. Salon T25 N2 found it in five places at once:
//
//   * The Book opened on TOMORROW, with the heading above the empty day still reading "Today";
//   * the enrol form pre-filled tomorrow's start date and SENT it;
//   * a membership sold at 7pm was recorded as starting tomorrow, its first invoice line was labelled
//     with tomorrow's period, and nextRenewal() carried that extra day into every anniversary after;
//   * a visit logged in the evening came back into the date box dated the next day;
//   * the future-visit guard refused a patch test done THIS MORNING east of UTC, and accepted a
//     genuinely future one west of it.
//
// The answer is one helper on each side — `utils/salonDate.ts` on the server (the zone the shop set for
// its booking calendar) and `utils/date.ts`'s `todayStr`/`toDayString` in the browser (the zone the
// person at the desk is in) — so the five places cannot drift apart again.
//
// Every exception below is a place where the UTC day is the RIGHT answer and says why. A new
// `.toISOString().slice(0, 10)` anywhere else in crm-salon fails this check.
//
//   bun run scripts/check-salon-days-are-the-shop-calendar.ts
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SALON = join(ROOT, 'templates', 'crm-salon')

// The UTC day, spelled any of the ways it is spelled in this repo.
const UTC_DAY = /\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/

/**
 * Lines where the UTC day is deliberate. Keyed by repo-relative path; the value is the substring that
 * must appear on the offending line, so the entry cannot silently cover a NEW use added to that file.
 */
const ALLOWED: Record<string, Array<[needle: string, why: string]>> = {
  'templates/crm-salon/backend/src/utils/salonDate.ts': [
    ['return d.toISOString().slice(0, 10)', 'the fallback when the shop names a zone Intl does not know'],
  ],
  'templates/crm-salon/backend/src/services/membershipBilling.ts': [
    ['const iso = (d: Date) => d.toISOString().slice(0, 10)', 'feeds utcToday() only — the WIDE end of the "has this period arrived?" prefilter, never a written date'],
  ],
  'templates/crm-salon/backend/src/routes/reminders.ts': [
    ['const todayStr = () => new Date().toISOString().slice(0, 10)', 'a rebooking call list is a rolling window, not a stored day'],
    ['const dayStr = (d: Date) => d.toISOString().slice(0, 10)', 'same window — formats the ends of it'],
  ],
  'templates/crm-salon/backend/src/routes/clients.ts': [
    ['calendarDateIn(new Date(withInterval.performedAt), tz)', 'due-back is already anchored on the shop day; this only turns the anchored value back into a string'],
  ],
  'templates/crm-salon/backend/db/seed.template.ts': [
    ['const isoDate = (deltaDays: number)', 'demo seed data, not a tenant decision'],
  ],
}

/** The call sites that have to keep going through the helpers — a fix reverted by deletion is still a fix reverted. */
const MUST_USE: Array<[file: string, needle: string, what: string]> = [
  ['templates/crm-salon/backend/src/routes/memberships.ts', 'salonToday(currentUser.companyId)', 'the enrolment start date'],
  ['templates/crm-salon/backend/src/routes/clients.ts', 'salonToday(currentUser.companyId)', 'the future-visit guard'],
  ['templates/crm-salon/backend/src/services/membershipBilling.ts', 'salonToday', 'the billing period'],
  ['templates/crm-salon/frontend/src/pages/salon/AppointmentsPage.tsx', 'todayStr', "The Book's default day"],
  ['templates/crm-salon/frontend/src/pages/salon/MembershipsPage.tsx', 'todayStr', "the enrol form's start date"],
  ['templates/crm-salon/frontend/src/components/salon/ServiceRecordEditorModal.tsx', 'toDayString', "the visit's date box"],
]

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // `shared` is vendored from packages/* and answers to its own guards.
    if (name === 'shared' || name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

if (!existsSync(SALON)) { console.log('crm-salon not present — nothing to check'); process.exit(0) }

const files = [
  ...walk(join(SALON, 'backend', 'src')),
  ...walk(join(SALON, 'frontend', 'src')),
  ...(existsSync(join(SALON, 'backend', 'db')) ? walk(join(SALON, 'backend', 'db')) : []),
]

for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  const allowed = ALLOWED[rel] || []
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!UTC_DAY.test(line)) return
    // A line that only TALKS about it (a comment explaining the bug) is not the bug.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (allowed.some(([needle]) => line.includes(needle))) return
    fail(`${rel}:${i + 1} builds a day from the UTC clock — ${line.trim().slice(0, 100)}`)
  })
}

// An allowlist entry that no longer matches anything is a lie about the code; drop it or fix the line.
for (const [rel, entries] of Object.entries(ALLOWED)) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) { fail(`allowlist names ${rel}, which does not exist`); continue }
  const text = readFileSync(abs, 'utf8')
  for (const [needle, why] of entries) {
    if (!text.includes(needle)) fail(`allowlist entry for ${rel} ("${why}") no longer matches: ${needle}`)
  }
}

for (const [rel, needle, what] of MUST_USE) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) { fail(`${rel} is gone — ${what} has nowhere to come from`); continue }
  if (!readFileSync(abs, 'utf8').includes(needle)) fail(`${rel} no longer calls ${needle} — ${what} is back on the wrong calendar`)
}

console.log(failures ? `\n${failures} problem(s).` : `crm-salon: every day comes from the shop's calendar (${files.length} files checked)`)
process.exit(failures ? 1 : 0)
