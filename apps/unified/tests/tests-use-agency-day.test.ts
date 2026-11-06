// Tests take "today" on the company's clock, not UTC's (owner, 2026-11-06: "why do we ever use UTC and not always wherever the user
// is?"). A day cut from now through UTC — `new Date().toISOString().slice(0, 10)` — is tomorrow every US evening, so a test that does it
// passes in the morning and fails at night: family texts, salon offers, a patch-test date and a roof report date all failed CI on
// 11/05–11/06 from clock assumptions. Instants are stored in UTC on purpose; DAYS and times of day are the company's
// (server/crm/homecare/core/agencyTime.ts).
//
// What it refuses: a test line that takes now (`new Date()`, `Date.now()`) and cuts its ISO string to a date, unless it is pinned to noon
// or midnight UTC (zone-free day arithmetic) or says `utc-on-purpose` (a test ABOUT UTC). Use tests/agencyDay.ts instead.
// What it cannot see: a test that assumes it is daytime (quiet hours) — pin the clock or the setting in such a test.
//
// WHY THERE IS A BASELINE: 33 such lines were already in 28 files when this was written; many are harmless (a date weeks ahead) and
// rewriting them all at once is its own risk. A file may not gain any, a new file may have none, and fixing one means lowering its
// count here (to 0, then removing the line).
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { agencyDay } from './agencyDay.ts'

const DIR = import.meta.dir
const TO_DAY = /\.toISOString\(\)\s*\.(slice\(0,\s*10\)|split\(['"]T['"]\)\[0\]|substring\(0,\s*10\))/
const FROM_NOW = /new Date\(\s*\)|Date\.now\(\)/
const PINNED = /T12:00:00Z|T00:00:00Z|Date\.UTC\(/
const offends = (line: string) => !/^\s*\/\//.test(line) && !line.includes('utc-on-purpose') && TO_DAY.test(line) && FROM_NOW.test(line) && !PINNED.test(line)

/** Lines already doing it when the rule arrived (2026-11-06): may only go down. */
const BASELINE: Record<string, number> = {
  'bar-event-form.test.ts': 1,
  'bar-shift-swaps.test.ts': 1,
  'bar-site.test.ts': 1,
  'bar-swap-depth.test.ts': 1,
  'bar-tip-pooling.test.ts': 1,
  'bar-website-forms.test.ts': 1,
  'contractor-retest-1022.test.ts': 1,
  'homecare-depth-import.test.ts': 1,
  'homecare-office.test.ts': 1,
  'homecare-planning.test.ts': 1,
  'inspection-checklists.test.ts': 1,
  'inspections-phone-kit.ts': 1,
  'landscaping-rain-day.test.ts': 1,
  'landscaping-route-profit.test.ts': 1,
  'landscaping-route-topup.test.ts': 1,
  'landscaping-route-visits.test.ts': 2,
  'mobile-homecare.test.ts': 1,
  'mobile-office-screens.test.ts': 1,
  'mobile-trade-tiles.test.ts': 2,
  'own-jobs-merged-1024.test.ts': 1,
  'restaurant-bar-tiles.test.ts': 1,
  'restaurant-kitchen-stock-schedule.test.ts': 2,
  'restaurant-live-1025.test.ts': 1,
  'roof-inspection-report-extras.test.ts': 1,
  'roof-permits.test.ts': 1,
  'salon-booth-rent.test.ts': 1,
  'salon-membership-autocharge.test.ts': 1,
  'texting-pictures-scheduled.test.ts': 3,
}
/** Files that quote the shapes on purpose (guards and their mutation checks). */
const SKIP = new Set(['homecare-agency-day.test.ts', 'tests-use-agency-day.test.ts'])

describe('tests take today on the company clock', () => {
  test('no test file adds a day cut from now through UTC', () => {
    const over: string[] = []
    for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.ts') && !SKIP.has(x))) {
      const hits = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').map((l, i) => ({ l, i })).filter(({ l }) => offends(l))
      if (hits.length > (BASELINE[f] ?? 0)) over.push(`${f}: ${hits.length} (allowed ${BASELINE[f] ?? 0}) — ${hits.map(({ l, i }) => `${i + 1}: ${l.trim()}`).join(' | ')}`)
    }
    expect(over).toEqual([])
  })

  test('the rule catches the shapes it names, and lets pinned arithmetic, a marked line and agencyDay through', () => {
    expect(offends('const today = () => new Date().toISOString().slice(0, 10)')).toBe(true)
    expect(offends('const f = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)')).toBe(true)
    expect(offends("const d = new Date().toISOString().split('T')[0]")).toBe(true)
    expect(offends('const d = new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)')).toBe(false)
    expect(offends('const utcDay = new Date().toISOString().slice(0, 10) // utc-on-purpose: comparing with UTC')).toBe(false)
    expect(agencyDay('America/Chicago', 0, new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-05')   // 9 PM in Chicago: still the 5th
    expect(agencyDay('America/Chicago', 1, new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-06')
  })
})
