// Twomiah Care, row 5 (care_required_tasks, care_visit_signature): the pure logic behind the greyed-out Clock out button, the client's
// signature and the reason list on the phone, run under plain bun.
//
//   bun run tests/mobile/required-tasks.test.ts
import { openRequiredTasks, openRequiredItems, reasonProblem, signatureBody, taskAppliesHere } from '../../apps/mobile/src/care/rules.ts'
import { clearOpen, currentOpen, reportOpen, resetOpen } from '../../apps/mobile/src/care/openRequired.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const tasks = [
  { taskId: '1', taskName: 'Bathing', isRequired: true, status: 'pending', appliesToVisit: true },
  { taskId: '2', taskName: 'Laundry', isRequired: true, status: 'completed', appliesToVisit: true },
  { taskId: '3', taskName: 'Tuesday walk', isRequired: true, status: 'pending', appliesToVisit: false },
  { taskId: '4', taskName: 'Skipped with reason', isRequired: true, status: 'skipped', notes: 'Client asleep', appliesToVisit: true },
  { taskId: '5', taskName: 'Skipped no reason', isRequired: true, status: 'skipped', notes: '  ', appliesToVisit: true },
  { taskId: '6', taskName: 'Optional', isRequired: false, status: 'pending', appliesToVisit: true },
  { taskId: '7', taskName: 'Weekly done', isRequired: true, status: 'pending', cadence: 'weekly', doneThisWeek: true, appliesToVisit: true },
  { taskId: '8', taskName: 'Old server', isRequired: true, status: 'pending' }, // an older server does not say whether it belongs: it does
]
check('the open required tasks are exactly the ones the server holds the clock-out by', openRequiredTasks(tasks).join('|') === 'Bathing|Skipped no reason|Old server', openRequiredTasks(tasks))
check('a task for another day is not open on this visit', !openRequiredTasks(tasks).includes('Tuesday walk') && !taskAppliesHere({ appliesToVisit: false }) && taskAppliesHere({}))
check('required items with nothing recorded are open; recorded ones and optional ones are not',
  openRequiredItems([{ name: 'A', required: true, status: null }, { name: 'B', required: true, status: 'done' }, { name: 'C', required: false, status: null }]).join() === 'A')

check('a reason is needed; "another reason" needs it written', reasonProblem(null, '') !== null && reasonProblem('other', ' ') !== null && reasonProblem('other', 'Went to the shops') === null && reasonProblem('asleep', '') === null)
check('the signature goes to the server as the drawing, or the reason with its note — never both',
  JSON.stringify(signatureBody({ signature: 'data:image/svg+xml;base64,AA', reasonCode: 'asleep', savedAt: 'T' })) === JSON.stringify({ signature: 'data:image/svg+xml;base64,AA', savedAt: 'T' })
  && JSON.stringify(signatureBody({ reasonCode: 'other', note: ' out ', savedAt: 'T' })) === JSON.stringify({ reasonCode: 'other', note: 'out', savedAt: 'T' })
  && !('note' in signatureBody({ reasonCode: 'asleep', savedAt: 'T' })))

// What the Clock out button waits for: each part reports under its own key, and clears itself when it goes away.
resetOpen()
reportOpen('tasks', ['Bathing'])
reportOpen('signature', ['the client\'s signature (or why they could not sign)'])
check('the button waits for everything the parts report', currentOpen().length === 2, currentOpen())
clearOpen('tasks')
check('a part clears itself when its work is done', currentOpen().length === 1 && currentOpen()[0].includes('signature'), currentOpen())
reportOpen('signature', [])
check('nothing open: the button is live', currentOpen().length === 0)
reportOpen('tasks', ['A']); resetOpen()
check('a finished visit leaves nothing behind', currentOpen().length === 0)

const screen = readFileSync(join(import.meta.dir, '../../apps/mobile/app/(tabs)/time-clock.tsx'), 'utf8')
check('Clock out is greyed while anything is open, and says what', screen.includes('disabled={stillOpen.length > 0}') && screen.includes('Clock out turns on when these are done'))
check('the visit screen shows the client signature and sends it with the clock-out', screen.includes('<ClientSignature visitId={a.id}') && screen.includes('signatureBody(signed)'))
const ctx = readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/CareContext.tsx'), 'utf8')
const punches = readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/offlinePunches.ts'), 'utf8')
check('a clock-out saved offline keeps the signature and replays it', ctx.includes('signature: signature ?? undefined') && punches.includes('...(cur.signature ? { signature: cur.signature } : {})'))
const parts = readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/components/VisitParts.tsx'), 'utf8')
check('the task list shows only the tasks that belong to this visit and reports what is open', parts.includes('items.filter(taskAppliesHere)') && parts.includes("reportOpen('tasks'"))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
