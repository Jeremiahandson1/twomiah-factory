// Twomiah Care, row 4 (care_visit_items): the pure logic behind the phone's in-visit forms, interventions and goals, run under plain bun.
//
//   bun run tests/mobile/visit-items.test.ts
import { formMissing, GOAL_RATINGS, reasonNeeded, type FormField } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const fields: FormField[] = [
  { id: 'h', type: 'section', label: 'Heading', required: true },
  { id: 'steady', type: 'radio', label: 'Steady on feet?', options: ['yes', 'no'], required: true },
  { id: 'aids', type: 'checkbox', label: 'Aids used', options: ['Cane', 'Walker'], required: true },
  { id: 'ack', type: 'checkbox', label: 'Client agrees', required: true },
  { id: 'notes', type: 'textarea', label: 'Notes' },
]
check('every blank required field is named; a heading and an optional field never are', formMissing(fields, {}).join('|') === 'Steady on feet?|Aids used|Client agrees', formMissing(fields, {}))
check('a multi-pick needs one pick; a single box needs ticking', formMissing(fields, { steady: 'no', aids: [], ack: false }).join('|') === 'Aids used|Client agrees')
check('answered: nothing missing', formMissing(fields, { steady: 'yes', aids: ['Cane'], ack: true }).length === 0)
check('spaces are not an answer', formMissing([{ id: 'a', type: 'text', label: 'A', required: true }], { a: '   ' }).length === 1)
check('goal ratings are the three the server takes', GOAL_RATINGS.map((r) => r.value).join() === 'progress,no_change,declined')
check('a refusal always needs its reason; a skip only when the item is required', reasonNeeded('refused', false) && reasonNeeded('skipped', true) && !reasonNeeded('skipped', false))

// The visit screen shows the section and holds the clock-out when the server says a required item is open.
const screen = readFileSync(join(import.meta.dir, '../../apps/mobile/app/(tabs)/time-clock.tsx'), 'utf8')
check('the visit screen shows the in-visit items', screen.includes('<VisitItems timeEntryId={a.id} />'))
check('a clock-out held for required items says so', screen.includes("r.code === 'required_items_pending'"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
