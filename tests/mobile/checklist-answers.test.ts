// The phone's checklist answers (apps/mobile/src/jobflow/checklistAnswers.ts): the rule the checklist screen runs BEFORE it sends
// (so no signal is no reason to find a refusal later) and the request it builds. What it proves, for every kind of question
// (pass/fail, yes/no, write-in, dropdown, multi-select, number, date, photo, signature) and headings:
//   · what counts as answered, and what is wrong with an answer, in words for the tech;
//   · a required question of any kind is flagged until answered; a heading is never flagged;
//   · headings group the questions under them, in order, and an empty heading is not drawn;
//   · the request: a photo question's pictures are NOT in the body — only their file addresses under `$photos`, with the
//     question each is for — and a multi-select sends its choices, a signature question its picture;
//   · a checklist photographed with no signal goes through the REAL queue and photo step whole, each photo on its own
//     question, and one whose file is gone is left off without moving the others.
//
//   bun run tests/mobile/checklist-answers.test.ts
import { createEngine, type KV, type Sender } from '../../apps/mobile/src/offline/engine.ts'
import { withUploadedPhotos, type FileExists, type UploadPhoto } from '../../apps/mobile/src/offline/localPhotos.ts'
import { answerLine, answerProblem, groupBySection, isAnswered, problemsFor, submitRequest, type Question } from '../../apps/mobile/src/jobflow/checklistAnswers.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const Q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ id, label: `Q ${id}`, type, required: true, ...over })
const FIELDS: Question[] = [
  Q('h1', 'section', { label: 'Before you start', required: false }),
  Q('size', 'dropdown', { options: ['16x25', '20x25'] }),
  Q('prob', 'multi_select', { options: ['Rust', 'Leak', 'Noise'] }),
  Q('psi', 'number'),
  Q('due', 'date'),
  Q('h2', 'section', { label: 'After you finish', required: false }),
  Q('front', 'photo'),
  Q('back', 'photo', { required: false }),
  Q('ok', 'signature'),
  Q('note', 'text', { required: false }),
  Q('pf', 'pass_fail'),
]

console.log('answered')
check('a blank text is not answered, a typed one is', !isAnswered(Q('a', 'text'), { value: '  ' }) && isAnswered(Q('a', 'text'), { value: 'ok' }))
check('a multi-select needs one choice', !isAnswered(FIELDS[2], { choices: [] }) && isAnswered(FIELDS[2], { choices: ['Rust'] }))
check('a photo question needs a photo', !isAnswered(FIELDS[6], { photoUris: [] }) && isAnswered(FIELDS[6], { photoUris: ['file:///a.jpg'] }))
check('a signature question needs the picture', !isAnswered(FIELDS[8], {}) && isAnswered(FIELDS[8], { signature: 'data:image/png;base64,AAAA' }))
check('nothing entered is not answered', !isAnswered(FIELDS[1], undefined))

console.log('what is wrong with an answer')
check('a dropdown answer must be one of its choices', answerProblem(FIELDS[1], { value: '30x30' }) === 'Pick one of the choices' && answerProblem(FIELDS[1], { value: '20x25' }) === null)
check('a multi-select choice must be on the list', answerProblem(FIELDS[2], { choices: ['Rust', 'Fire'] }) === 'Pick from the choices' && answerProblem(FIELDS[2], { choices: ['Rust'] }) === null)
check('a number is a number', answerProblem(FIELDS[3], { value: 'lots' })?.startsWith('Type a number') === true && answerProblem(FIELDS[3], { value: '-3.5' }) === null && answerProblem(FIELDS[3], { value: '12' }) === null)
check('a date is a real day', answerProblem(FIELDS[4], { value: '2027-02-30' }) === 'Pick a date' && answerProblem(FIELDS[4], { value: 'tomorrow' }) === 'Pick a date' && answerProblem(FIELDS[4], { value: '2027-02-28' }) === null)
check('seven photos on one question is too many', answerProblem(FIELDS[6], { photoUris: Array.from({ length: 7 }, (_, i) => `file:///${i}.jpg`) }) === 'At most 6 photos')

console.log('what is left to answer')
const none = problemsFor(FIELDS, {})
check('every required question is flagged, headings and optional ones are not', JSON.stringify(Object.keys(none).sort()) === JSON.stringify(['due', 'front', 'ok', 'pf', 'prob', 'psi', 'size']), none)
check('a heading is never flagged', !('h1' in none) && !('h2' in none))
const full = { size: { value: '20x25' }, prob: { choices: ['Rust'] }, psi: { value: '0.45' }, due: { value: '2027-03-15' }, front: { photoUris: ['file:///f.jpg'] }, ok: { signature: 'data:image/png;base64,AAAA' }, pf: { value: 'pass' } }
check('fully answered is ready to send', Object.keys(problemsFor(FIELDS, full)).length === 0)
check('a wrong answer is named as wrong, not as missing', problemsFor(FIELDS, { ...full, psi: { value: 'x' } }).psi?.startsWith('Type a number') === true)

console.log('headings')
const groups = groupBySection(FIELDS)
check('questions sit under their heading, in order', groups.length === 2 && groups[0].heading === 'Before you start' && groups[0].items.map((q) => q.id).join() === 'size,prob,psi,due' && groups[1].heading === 'After you finish' && groups[1].items.map((q) => q.id).join() === 'front,back,ok,note,pf', groups.map((g) => g.heading))
check('questions before any heading have none', groupBySection([Q('a', 'text'), Q('h', 'section', { label: 'H' }), Q('b', 'text')]).map((g) => g.heading).join('|') === '|H')
check('a heading with nothing under it is not drawn', groupBySection([Q('h', 'section', { label: 'H' }), Q('h2', 'section', { label: 'H2' }), Q('a', 'text')]).map((g) => g.heading).join() === 'H2')

console.log('the request')
const req = submitRequest({
  jobId: 'job 1', sendId: 'ck_abc12345', templateId: 'tpl1', label: 'Tune-up', questions: FIELDS, recordKey: 'job:job 1', notes: '  ran long ',
  drafts: { ...full, front: { photoUris: ['file:///f1.jpg', 'file:///f2.jpg'] }, back: { photoUris: ['file:///b.jpg'] }, note: { value: ' hi ' } },
})
check('it goes to the job’s submit route under the job’s record key', req.method === 'POST' && req.path === '/api/checklists/job/job%201/submit' && req.recordKey === 'job:job 1' && req.label === 'Tune-up')
const b: any = req.body
check('it carries the send id, the checklist and the notes', b.id === 'ck_abc12345' && b.templateId === 'tpl1' && b.overallNotes === 'ran long')
check('no heading is sent as an answer', !b.answers.some((a: any) => a.id === 'h1' || a.id === 'h2') && b.answers.length === 9)
check('a multi-select sends its choices, a number its text trimmed', JSON.stringify(b.answers.find((a: any) => a.id === 'prob')) === '{"id":"prob","choices":["Rust"]}' && b.answers.find((a: any) => a.id === 'note').value === 'hi')
check('a signature question sends its picture', b.answers.find((a: any) => a.id === 'ok').signature === 'data:image/png;base64,AAAA')
check('photo pictures are not in the body: only file addresses with the question each is for', JSON.stringify(b.$photos) === JSON.stringify({ uploadTo: '/api/checklists/job/job%201/photos', uris: ['file:///f1.jpg', 'file:///f2.jpg', 'file:///b.jpg'], keys: ['front', 'front', 'back'] }) && JSON.stringify(b.answers.find((a: any) => a.id === 'front')) === '{"id":"front"}', b.$photos)
const noPhotos = submitRequest({ jobId: 'j', sendId: 'ck_abc12345', templateId: 't', label: 'x', questions: [Q('a', 'text')], drafts: { a: { value: 'x' } }, recordKey: 'job:j' })
check('a checklist with no photos has no $photos', !('$photos' in (noPhotos.body as any)))
const signedReq = submitRequest({ jobId: 'j', sendId: 'ck_abc12345', templateId: 't', label: 'x', questions: [Q('a', 'text')], drafts: {}, recordKey: 'job:j', signature: { signature: 'data:image/png;base64,AAAA', signedBy: 'Ann', consent: true } })
check('the customer’s whole-checklist signature goes with it', (signedReq.body as any).signature.signedBy === 'Ann' && (signedReq.body as any).signature.consent === true)

console.log('a checklist photographed with no signal, through the real queue')
function world() {
  let t = Date.parse('2026-10-31T15:00:00Z')
  const data = new Map<string, string>()
  const kv: KV = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
  const files = new Set<string>()
  const uploads: Array<{ path: string; name: string; uri: string }> = []
  const sent: Array<{ path: string; body: any }> = []
  let online = false
  const exists: FileExists = async (uri) => files.has(uri)
  const upload: UploadPhoto = async (path, name, uri) => {
    if (!online) return { status: 0 }
    uploads.push({ path, name, uri })
    return { status: 201, data: { url: `/media/photos/co/checklist/job1/${name}.jpg` } }
  }
  const send: Sender = async ({ id, path, body }) => {
    if (!online) return { status: 0 }
    const prepared = await withUploadedPhotos(id, body, exists, upload)
    if ('status' in prepared) return prepared
    sent.push({ path, body: prepared.body })
    return { status: 201, data: { ok: true } }
  }
  let n = 0
  const engine = createEngine({ kv, send, now: () => t, random: () => 0.5, newId: () => `save${++n}`, setTimer: () => () => {} })
  return { engine, files, uploads, sent, goOnline: () => { online = true; engine.setOnline(true) } }
}
async function main() {
{
  const w = world()
  await w.engine.load('rep1'); w.engine.setOnline(false)
  w.files.add('file:///f1.jpg'); w.files.add('file:///f2.jpg'); w.files.add('file:///b.jpg')
  const r = submitRequest({ jobId: 'job1', sendId: 'ck_abc12345', templateId: 'tpl1', label: 'Tune-up', questions: FIELDS, recordKey: 'job:job1', drafts: { ...full, front: { photoUris: ['file:///f1.jpg', 'file:///f2.jpg'] }, back: { photoUris: ['file:///b.jpg'] } } })
  const queued = await w.engine.submit(r)
  check('with no signal nothing is uploaded or sent, the save waits on the phone', queued.queued === true && w.uploads.length === 0 && w.sent.length === 0 && w.engine.status().items.length === 1)
  w.goOnline(); await w.engine.sendNow()
  check('with signal the photos go first, each from its file, then the checklist', w.uploads.length === 3 && w.uploads.every((u) => u.path === '/api/checklists/job/job1/photos') && w.sent.length === 1 && w.engine.status().items.length === 0, { uploads: w.uploads.length, sent: w.sent.length })
  const body = w.sent[0].body
  check('the checklist goes with each photo’s address and the question it is for', JSON.stringify(body.photoKeys) === '["front","front","back"]' && body.photos.length === 3 && !('$photos' in body), body.photoKeys)
}
{
  const w = world()
  await w.engine.load('rep1'); w.engine.setOnline(false)
  w.files.add('file:///f1.jpg'); w.files.add('file:///b.jpg')   // f2.jpg is gone from the phone
  const r = submitRequest({ jobId: 'job1', sendId: 'ck_abc12345', templateId: 'tpl1', label: 'Tune-up', questions: FIELDS, recordKey: 'job:job1', drafts: { ...full, front: { photoUris: ['file:///f1.jpg', 'file:///f2.jpg'] }, back: { photoUris: ['file:///b.jpg'] } } })
  await w.engine.submit(r)
  w.goOnline(); await w.engine.sendNow()
  const body = w.sent[0]?.body
  check('a photo whose file is gone is left off WITHOUT moving the others onto the wrong question', JSON.stringify(body?.photoKeys) === '["front","back"]' && body?.photos.length === 2, body?.photoKeys)
  check('and the checklist’s notes say so', String(body?.notes).includes('1 photo could not be sent'), body?.notes)
}

}
await main()

console.log('how an answer reads')
check('a heading reads in capitals', answerLine({ label: 'After you finish', type: 'section' }) === 'AFTER YOU FINISH')
check('a photo reads as its count, a signature as signed', answerLine({ label: 'Front', type: 'photo', photos: ['a', 'b'] }) === 'Front: 2 photos' && answerLine({ label: 'Front', type: 'photo', photos: ['a'] }) === 'Front: 1 photo' && answerLine({ label: 'OK', type: 'signature', signed: true }) === 'OK: signed' && answerLine({ label: 'OK', type: 'signature' }) === 'OK: —')
check('a multi-select reads as its choices, an empty answer as a dash', answerLine({ label: 'P', type: 'multi_select', choices: ['Rust', 'Noise'] }) === 'P: Rust, Noise' && answerLine({ label: 'N', type: 'text', value: '' }) === 'N: —')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
