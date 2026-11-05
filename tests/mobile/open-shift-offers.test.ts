// Twomiah Care, row 17 (care_open_shift_offers): the pure logic behind turning an open shift down, the answer-by time and a series, run under plain bun.
//
//   bun run tests/mobile/open-shift-offers.test.ts
import { declineProblem, declineBody, answerByText, takeText } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
check('a decline without a reason is refused', declineProblem(null, '') === 'Pick why you are turning this shift down.')
check('a listed reason is ready', declineProblem('busy', '') === null)
check('"another reason" needs words', declineProblem('other', '  ') === 'Write the reason.')
check('"another reason" with words is ready', declineProblem('other', 'Away') === null)
check('the body trims the note and leaves it out when blank', JSON.stringify(declineBody('busy', '  ')) === '{"reason":"busy"}' && declineBody('other', ' Away ').note === 'Away')
const day = (y: string) => `D(${y})`, tm = (h: string) => `T(${h})`
check('answer-by shows day and time', answerByText('2026-11-02T17:00:00', day, tm) === 'Answer by D(2026-11-02) at T(17:00)')
check('answer-by is nothing when there is no deadline', answerByText(null, day, tm) === null && answerByText('', day, tm) === null)
check('one visit: the usual button, no extra warning', takeText(null).button === 'Take this shift' && takeText(1).confirm === '')
check('a series says it takes every visit', takeText(3).button === 'Take all 3 visits' && takeText(3).confirm.includes('all 3'))

const screen = readFileSync(join(import.meta.dir, '../../apps/mobile/app/(care)/open-shifts.tsx'), 'utf8')
check('the screen uses no native alert', !/\bAlert\b/.test(screen))
check('taking and declining are live calls, never queued', !/enqueue|src\/offline/.test(screen))
check('decline and hide only show when the offers feature answers', /reasons\.length > 0/.test(screen))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
