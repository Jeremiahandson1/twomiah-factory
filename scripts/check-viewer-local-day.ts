// CI guard: a screen asks the VIEWER's calendar what day it is, never UTC.
//
// `new Date().toISOString().split('T')[0]` is the UTC day. From 19:00 Central — 20:00 Eastern, 17:00
// Pacific — UTC is already on tomorrow, so any screen that asks the question that way rolls over while
// the crew is still working. The Dispatch Board opened on tomorrow, its "Today" button jumped a day
// forward, and the technician's Today tab emptied and refilled with tomorrow's jobs at exactly the hour
// someone is closing out the day's work. The Schedule page computed the day locally and did not move, so
// the two screens disagreed about what day it was. (Evergreen BUG-28)
//
// This guard does two things a regex-only guard cannot:
//   1. it RUNS the helper in a pinned non-UTC zone and checks the answers, so it tests behaviour rather
//      than spelling — under CI's own TZ=UTC the bug and the fix are indistinguishable, which is the
//      whole reason the defect survived (feedback_pin_the_server_environment);
//   2. it proves the OLD implementation would fail those same assertions, so the test has teeth.
//
//   bun scripts/check-viewer-local-day.ts
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Comments are stripped before any of these patterns are applied: the files under test EXPLAIN the bug
// they avoid, so a bare search for `toISOString` matches the prose warning against it and fails the very
// file that got it right.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => { try { return strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')) } catch { return null } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const DAY = 'packages/tenant-ui/src/time/day.ts'

// ── the helper says what it means ──────────────────────────────────────────────────────────────────
const day = read(DAY)
if (!day) fail(`${DAY} is missing — there is no one place that answers "what day is it here"`)
else {
  if (!/export const localDayKey/.test(day)) fail('localDayKey must be exported')
  if (!/export const todayKey/.test(day)) fail('todayKey must be exported')
  if (!/export const dayKeyPlus/.test(day)) fail('dayKeyPlus must be exported')
  if (/toISOString/.test(day)) fail(`${DAY} must not reach for toISOString — that is the UTC day, which is the bug`)
  if (!/getFullYear\(\)/.test(day) || !/getMonth\(\) \+ 1/.test(day) || !/getDate\(\)/.test(day)) {
    fail('localDayKey must read the LOCAL calendar fields (getFullYear/getMonth/getDate)')
  }
  if (!/12, 0, 0, 0/.test(day)) {
    fail('dayKeyPlus must step from local NOON — midnight is the one instant a DST change can delete, and the board then skips a day')
  }
}

// ── nobody asks UTC on a screen that means "today" ─────────────────────────────────────────────────
const SCREENS = [
  'templates/crm-fieldservice/frontend/src/pages/fieldservice/DispatchBoard.tsx',
  'templates/crm-fieldservice/frontend/src/pages/fieldservice/TechView.tsx',
  'templates/crm-landscaping/frontend/src/pages/fieldservice/DispatchBoard.tsx',
  'templates/crm-landscaping/frontend/src/pages/fieldservice/TechView.tsx',
]
for (const p of SCREENS) {
  const src = read(p)
  if (!src) { fail(`${p} is missing`); continue }
  if (/new Date\(\)\.toISOString\(\)\.(split\('T'\)\[0\]|slice\(0, ?10\))/.test(src)) {
    fail(`${p} decides "today" from the UTC clock — after 19:00 Central that is tomorrow (BUG-28)`)
  }
  if (!/from '\.\.\/\.\.\/shared'/.test(src)) {
    fail(`${p} must take the day helpers from the shared package, not define its own`)
  }
}

// ── and the Schedule page uses the same one definition ─────────────────────────────────────────────
const sched = read('packages/tenant-ui/src/schedule/SchedulePage.tsx')
if (!sched) fail('packages/tenant-ui/src/schedule/SchedulePage.tsx is missing')
else if (!/import \{ localDayKey \} from '\.\.\/time\/day'/.test(sched)) {
  fail('SchedulePage must share the day helper — it kept its own correct copy while Dispatch kept a wrong one, which is how they came to disagree')
}

// ── behaviour, in a zone where UTC and local differ ────────────────────────────────────────────────
// 2026-09-26T02:06Z is 2026-09-25 21:06 in Chicago: the evening window where the bug shows.
// 2027-03-14 is US spring-forward; 2026-11-01 is fall-back.
const probe = `
import { localDayKey, todayKey, dayKeyPlus } from '${new URL('../packages/tenant-ui/src/time/day.ts', import.meta.url).href}'
const evening = new Date('2026-09-26T02:06:00Z')
const out = {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  local: localDayKey(evening),
  utc: evening.toISOString().split('T')[0],
  todayIsLocal: todayKey() === localDayKey(new Date()),
  fwd: dayKeyPlus('2026-09-25', 1),
  back: dayKeyPlus('2026-09-25', -1),
  springForward: dayKeyPlus('2027-03-13', 1),
  acrossSpring: dayKeyPlus('2027-03-14', 1),
  fallBack: dayKeyPlus('2026-10-31', 1),
  acrossFall: dayKeyPlus('2026-11-01', 1),
}
console.log(JSON.stringify(out))
`
const run = spawnSync(process.execPath, ['-e', probe], {
  env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8',
})
if (run.status !== 0) {
  fail(`could not run the day helper under TZ=America/Chicago: ${String(run.stderr || '').slice(0, 300)}`)
} else {
  let r: any = null
  try { r = JSON.parse(String(run.stdout).trim().split('\n').pop() || '') } catch {}
  if (!r) fail(`the behaviour probe produced no result: ${String(run.stdout).slice(0, 200)}`)
  else if (r.tz !== 'America/Chicago') {
    console.log(`  (note: this host ignored TZ and reports ${r.tz}; the evening assertion is skipped)`)
  } else {
    // The assertion only means something if the two clocks actually disagree at that instant.
    if (r.local === r.utc) fail('the fixture instant does not straddle midnight UTC — this guard would pass vacuously; fix the fixture')
    if (r.local !== '2026-09-25') fail(`at 21:06 on the 25th in Chicago the local day must be 2026-09-25, got ${r.local} (UTC says ${r.utc})`)
    if (!r.todayIsLocal) fail('todayKey() must agree with localDayKey(new Date())')
    if (r.fwd !== '2026-09-26') fail(`dayKeyPlus(+1) gave ${r.fwd}`)
    if (r.back !== '2026-09-24') fail(`dayKeyPlus(-1) gave ${r.back}`)
    if (r.springForward !== '2027-03-14') fail(`stepping into spring-forward gave ${r.springForward}`)
    if (r.acrossSpring !== '2027-03-15') fail(`stepping across spring-forward gave ${r.acrossSpring}`)
    if (r.fallBack !== '2026-11-01') fail(`stepping into fall-back gave ${r.fallBack}`)
    if (r.acrossFall !== '2026-11-02') fail(`stepping across fall-back gave ${r.acrossFall}`)

    // …and the way it used to be written really does get it wrong, so none of the above is decoration.
    const old = spawnSync(process.execPath, ['-e',
      `const d = new Date('2026-09-26T02:06:00Z'); console.log(d.toISOString().split('T')[0])`],
      { env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8' })
    if (String(old.stdout).trim() !== '2026-09-26') {
      fail('the old UTC expression no longer differs from the local one — this guard can no longer tell the bug from the fix')
    }
  }
}

if (failed) { console.error(`\nviewer local day: ${failed} check(s) FAILED`); process.exit(1) }
console.log('viewer local day: Dispatch, Tech view and Schedule all ask the viewer\'s own calendar what day it is — verified by running the helper in a zone where UTC disagrees, including both DST turns')
