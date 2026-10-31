// Twomiah Care, row 3 (care_visit_questions): the pure logic the phone's clock-in / clock-out questions stand on, run under plain bun.
//   · which required questions are still blank, and the answers as the server takes them;
//   · a punch saved on the phone without signal keeps the answers and sends them with its tap time.
//
//   bun run tests/mobile/visit-questions.test.ts
import { createPunchQueue, type KV } from '../../apps/mobile/src/care/offlinePunches.ts'
import { answersBody, unansweredRequired, type VisitQuestion } from '../../apps/mobile/src/care/rules.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const memKV = (): KV => { const data = new Map<string, string>(); return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } } }

const qs: VisitQuestion[] = [
  { id: 'a', prompt: 'Was the home safe?', kind: 'yes_no', required: true },
  { id: 'b', prompt: 'How was Pat?', kind: 'choice', options: ['Good', 'Poor'], required: true },
  { id: 'c', prompt: 'Anything to add?', kind: 'text' },
]

check('required questions left blank are named, in order', unansweredRequired(qs, {}).map((q) => q.id).join() === 'a,b')
check('a blank or spaces-only answer is still blank', unansweredRequired(qs, { a: '  ', b: 'Good' }).map((q) => q.id).join() === 'a')
check('optional questions never block', unansweredRequired(qs, { a: 'yes', b: 'Poor' }).length === 0)
check('the body carries only what was answered, tidied', JSON.stringify(answersBody(qs, { a: ' yes ', c: '' })) === '[{"questionId":"a","answer":"yes"}]', answersBody(qs, { a: ' yes ', c: '' }))

{
  const q = createPunchQueue(memKV())
  const answers = [{ questionId: 'a', answer: 'yes' }]
  await q.save({ localId: 'in1', userId: 'u1', kind: 'in', at: '2026-10-15T14:10:00.000Z', clientId: 'c1', answers })
  await q.save({ localId: 'out1', userId: 'u1', kind: 'out', at: '2026-10-15T16:00:00.000Z', inLocalId: 'in1', notes: 'ok', answers: [{ questionId: 'b', answer: 'Good' }] })
  await q.save({ localId: 'in2', userId: 'u1', kind: 'in', at: '2026-10-15T18:00:00.000Z', clientId: 'c2' }) // no questions asked: nothing extra is sent
  const calls: { path: string; body: any }[] = []
  const send = async (path: string, body: any) => { calls.push({ path, body }); return path.endsWith('/clock-in') ? { status: 201, data: { id: `te_${calls.length}`, clientId: body.clientId } } : { status: 200, data: {} } }
  const r = await q.flush({ userId: 'u1', send })
  check('all three punches sent', r.sent === 3 && r.rejected.length === 0, r)
  check('the saved clock-in sends its answers with the tap time', JSON.stringify(calls[0].body.answers) === JSON.stringify(answers) && calls[0].body.offlineAt === '2026-10-15T14:10:00.000Z', calls[0])
  check('the saved clock-out sends its answers too', JSON.stringify(calls[1].body.answers) === '[{"questionId":"b","answer":"Good"}]', calls[1])
  check('a punch with no answers sends no answers key', !('answers' in calls[2].body), calls[2])
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
