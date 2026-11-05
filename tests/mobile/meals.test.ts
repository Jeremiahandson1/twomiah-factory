// Twomiah Care, row 6 (care_family_content): the pure logic behind recording a meal on the phone, run under plain bun.
//
//   bun run tests/mobile/meals.test.ts
import { mealBody, mealProblem } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

check('nothing picked: it asks for the meal first', mealProblem(null, 'Soup', 'all') === 'Pick the meal: breakfast, lunch, dinner or a snack.')
check('a meal with nothing written is refused', mealProblem('lunch', '   ', 'all') === 'Write what was served.')
check('a meal with no amount is refused', mealProblem('lunch', 'Soup', null) === 'Say how much was eaten.')
check('a complete meal is ready', mealProblem('lunch', 'Soup', 'half') === null)
const b = mealBody({ description: '  Soup and toast ', amountEaten: 'most', note: '  ' }, '2026-10-31T17:00:00.000Z')
check('the body is trimmed, an empty note is left out, and the serving time rides along', JSON.stringify(b) === JSON.stringify({ description: 'Soup and toast', amountEaten: 'most', savedAt: '2026-10-31T17:00:00.000Z' }), b)
check('a note is kept', mealBody({ description: 'Toast', amountEaten: 'all', note: ' liked it ' }, 'x').note === 'liked it')

// The screen is on the visit screen and goes through the offline queue (no separate send path).
const screen = readFileSync(join(import.meta.dir, '../../apps/mobile/app/(tabs)/time-clock.tsx'), 'utf8')
const part = readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/components/VisitMeals.tsx'), 'utf8')
check('the visit screen shows the meals section', screen.includes('<VisitMeals visitId={a.id} />'))
check('a meal is saved through the offline queue with a record key', part.includes('queue.put(') && part.includes('recordKey: `meal:'))
check('an agency without the feature shows nothing', part.includes('if (!opts) return null'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
