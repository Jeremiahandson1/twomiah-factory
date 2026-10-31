// Twomiah Care, row 18 (care_pickup_rewards): the pure logic behind hours wanted, time off and rewards on the phone, run under plain bun.
//
//   bun run tests/mobile/rewards-availability.test.ts
import { availabilityProblem, availabilityBody, timeOffProblem, timeOffBody, rewardAffordText, DAYS, type DayChoice } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const days = (over: Record<string, Partial<DayChoice>> = {}): Record<string, DayChoice> =>
  Object.fromEntries(DAYS.map((d) => [d.key, { available: d.key === 'monday', start: '08:00', end: '16:00', ...(over[d.key] ?? {}) }]))

check('a good week is ready', availabilityProblem('24', '32', days()) === null)
check('hours wanted may be left blank (clears it)', availabilityProblem('', '', days()) === null)
check('hours wanted must be whole hours', availabilityProblem('2.5', '', days()) === 'Hours you want a week must be a whole number from 0 to 168.')
check('the most hours must be whole hours too', availabilityProblem('', 'lots', days()) === 'The most hours a week must be a whole number from 0 to 168.')
check('wanting more than the most is refused', availabilityProblem('40', '32', days()) === 'You cannot want more hours than the most you will work.')
check('a day with bad times names the day', availabilityProblem('', '', days({ monday: { start: '8am' } })) === 'Monday: enter the times as HH:MM, like 08:00 and 16:00.')
check('a day that ends before it starts is refused', availabilityProblem('', '', days({ monday: { start: '16:00', end: '08:00' } })) === 'Monday: the end must be after the start.')
check('a day that is off is not checked', availabilityProblem('', '', days({ tuesday: { available: false, start: 'x', end: 'y' } })) === null)

const body = availabilityBody(' 24 ', '32', days({ tuesday: { available: false } }))
check('the body carries the hours as numbers', body.hoursWanted === 24 && body.maxHoursPerWeek === 32, body)
check('a day that is on carries its times; one that is off carries only that it is off', body.mondayStartTime === '08:00' && body.tuesdayAvailable === false && !('tuesdayStartTime' in body), body)
check('blank hours wanted is sent as null so it clears', availabilityBody('', '', days()).hoursWanted === null)

check('time off needs a kind', timeOffProblem('2026-11-02', '2026-11-03', null, '2026-10-31') === 'Pick what kind of time off it is.')
check('time off needs both days', timeOffProblem('', '2026-11-03', 'sick', '2026-10-31') === 'Pick the first and last day.')
check('the last day cannot be first', timeOffProblem('2026-11-04', '2026-11-03', 'sick', '2026-10-31') === 'The last day cannot be before the first.')
check('time off already over is sent to the office instead', timeOffProblem('2026-10-01', '2026-10-02', 'sick', '2026-10-31') === 'That is already in the past — tell the office instead.')
check('a good request is ready', timeOffProblem('2026-11-02', '2026-11-03', 'vacation', '2026-10-31') === null)
check('the request body leaves an empty reason out', JSON.stringify(timeOffBody('2026-11-02', '2026-11-03', 'vacation', '  ')) === JSON.stringify({ startDate: '2026-11-02', endDate: '2026-11-03', type: 'vacation' }))
check('a reason is trimmed and kept', timeOffBody('a', 'b', 'sick', ' flu ').reason === 'flu')
check('a reward you can afford says its cost; one you cannot says how far', rewardAffordText(30, 20) === '20 points' && rewardAffordText(12, 20) === '20 points — 8 more to go')

// The screens go through the offline queue where the write is safe to keep, and never for spending points.
const root = join(import.meta.dir, '../../apps/mobile')
const avail = readFileSync(join(root, 'app/(care)/availability.tsx'), 'utf8')
const rewards = readFileSync(join(root, 'app/(care)/rewards.tsx'), 'utf8')
const more = readFileSync(join(root, 'app/(tabs)/more-homecare.tsx'), 'utf8')
check('hours are saved through the offline queue with a record key', avail.includes('queue.put(') && avail.includes('recordKey: `availability:'))
check('a time-off request is queued with a record key so a retry is one request', avail.includes('queue.post(\'/api/pto\'') && avail.includes('recordKey: `timeoff:'))
check('spending points needs signal: it is a direct call, never queued', rewards.includes("carePost('/api/care-rewards/redeem'") && !rewards.includes('queue.'))
check('no native dialogs on the new screens', !/Alert\.alert|window\.confirm/.test(avail + rewards))
check('the menu shows the two entries only when the points page answers', more.includes('points !== null') && more.includes("'/(care)/availability'") && more.includes("'/(care)/rewards'"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
