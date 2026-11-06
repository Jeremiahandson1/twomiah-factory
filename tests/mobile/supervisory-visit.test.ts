// Twomiah Care, row 24 (care_supervisory_visits): the pure rules behind "Supervisory visits" on the phone, run under plain bun —
// the same refusals the server makes (core/supervisory.ts checkVisitForm), said before a round trip — and the screen's wiring.
//
//   bun run tests/mobile/supervisory-visit.test.ts
import { emptySupervisoryForm, supervisoryBody, supervisoryProblem, type SupervisoryQuestion } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const QS: SupervisoryQuestion[] = [
  { id: 'alarm', label: 'Is the smoke alarm working?', kind: 'yes_no', required: true },
  { id: 'family', label: 'Anything the family asked for?', kind: 'text', required: false },
]
const f = (patch: any = {}) => ({ ...emptySupervisoryForm(), ...patch })

check('a required question that is not answered names itself', supervisoryProblem(f({ concerns: 'x' }), QS, false, 'home') === 'Answer "Is the smoke alarm working?".')
check('an empty visit is refused in the server\'s words', (supervisoryProblem(f(), [], false, 'home') || '').startsWith('Fill in at least one thing'))
check('an answer to the agency\'s own question counts as something from the visit', supervisoryProblem(f({ answers: { alarm: false } }), QS, false, 'home') === null)
check('required signatures: mine first', supervisoryProblem(f({ concerns: 'x' }), [], true, 'home') === 'Sign the visit before saving it.')
check('required signatures: then the client\'s or why not', supervisoryProblem(f({ concerns: 'x', supervisorSignature: 'data:image/svg+xml;base64,AA' }), [], true, 'home') === 'Have the client sign, or say why they could not.')
check('a reason stands in for the client\'s signature', supervisoryProblem(f({ concerns: 'x', supervisorSignature: 'data:', clientSignReason: 'Asleep' }), [], true, 'home') === null)
check('a phone visit needs no client signature', supervisoryProblem(f({ concerns: 'x', supervisorSignature: 'data:' }), [], true, 'phone') === null)
const body = supervisoryBody(f({ concerns: '  Rug in the hall ', carePlanFollowed: false, answers: { alarm: true, family: '   ' }, supervisorSignature: 'S', clientSignReason: 'Asleep' }), QS) as any
check('the body: from the phone, trimmed words, the yes/no answer, an empty text answer left out', body.from === 'phone' && body.concerns === 'Rug in the hall' && body.carePlanFollowed === false && JSON.stringify(body.answers) === '{"alarm":true}' && body.clientFeedback === undefined)
check('the body: the reason goes only when there is no client signature', body.clientSignReason === 'Asleep' && supervisoryBody(f({ concerns: 'x', clientSignature: 'C', clientSignReason: 'Asleep' }), []).clientSignReason === undefined)

const root = join(import.meta.dir, '../../apps/mobile')
const screen = readFileSync(join(root, 'app/(care)/supervisory.tsx'), 'utf8')
const more = readFileSync(join(root, 'app/(tabs)/more-homecare.tsx'), 'utf8')
const layout = readFileSync(join(root, 'app/(care)/_layout.tsx'), 'utf8')
check('the screen finishes a visit directly (never queued for later) through the complete route', screen.includes('carePost(`/api/supervisory-visits/visits/${open.id}/complete`') && !/offlinePunches|queue/i.test(screen.replace(/\/\*[\s\S]*?\*\//, '')))
check('no native dialogs on the screen', !/Alert\.alert/.test(screen))
check('the More menu offers it only when the agency has it (the list answered)', more.includes("'/api/supervisory-visits/mine'") && more.includes("'/(care)/supervisory'"))
check('the stack has a title for it', layout.includes("supervisory: 'Supervisory visits'"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
