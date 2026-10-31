// Inspections on the phone (contractor parity, item 6), held to the owner's rules from the rule file and the screen sources — nothing
// here needs a device:
//   · the card on the job and the screen behind it show only with the switch on AND a seat that may read inspections; answering and
//     signing need the crew right (or the office's); the signature box needs its own switch;
//   · a fail needs words before anything is sent; the customer cannot sign until every line has an answer; the send names the same
//     routes the server has;
//   · answers and the signature go through the offline queue under the job's record key (src/offline is used, never changed);
//   · the screen is a real route, listed in the details layout, and its words are plain.
//
//   bun run tests/mobile/inspections-phone.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { ANSWERS, answerRequest, failNeedsWords, mayAnswer, progress, readyToSign, recordKeyFor, showsInspections, showsSignature, signRequest, standing, visitLine, FEATURE_PHONE, FEATURE_SIGN } from '../../apps/mobile/src/inspections/rules.ts'
import { FEATURE_REGISTRY } from '../../packages/tenant-backend/src/featureRegistry.ts'
import { BASE_ROLE_PERMISSIONS } from '../../packages/tenant-backend/src/auth/permissions.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile')
const read = (p: string) => fs.readFileSync(path.join(app, p), 'utf8')
const server = fs.readFileSync(path.resolve(import.meta.dir, '../../apps/unified/server/crm/siteRecords/inspectionChecklists.ts'), 'utf8')
const withFeatures = (...on: string[]) => (f: string) => on.includes(f)
const holding = (...p: string[]) => (x: string) => p.includes(x)

// ── the switches ───────────────────────────────────────────────────────────────────────────────────────────────────────
check('the card and screen need the switch AND inspections:read', showsInspections(withFeatures(FEATURE_PHONE), holding('inspections:read')) === true)
check('the switch off hides them, whoever the seat is', showsInspections(withFeatures(), holding('inspections:read', 'inspections:update', 'inspections:answer')) === false)
check('a seat that may not read inspections does not see them', showsInspections(withFeatures(FEATURE_PHONE), holding('jobs:read')) === false)
check('the crew right answers', mayAnswer(holding('inspections:answer')) === true)
check('the office right answers too', mayAnswer(holding('inspections:update')) === true)
check('read alone does not answer', mayAnswer(holding('inspections:read')) === false)
check('the signature box needs its own switch and the right to answer', showsSignature(withFeatures(FEATURE_SIGN), holding('inspections:answer')) === true
  && showsSignature(withFeatures(FEATURE_PHONE), holding('inspections:answer')) === false
  && showsSignature(withFeatures(FEATURE_SIGN), holding('inspections:read')) === false)
check('the three switches are registered, hidden, for the general contractor only', ['phone_inspections', 'inspection_signature', 'inspection_auto_checklists'].every((id) => {
  const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
  return f && f.hidden === true && JSON.stringify(f.templates) === '["crm"]'
}))
check('the switch ids in the rules are the registered ones', (FEATURE_REGISTRY as any[]).some((f) => f.id === FEATURE_PHONE) && (FEATURE_REGISTRY as any[]).some((f) => f.id === FEATURE_SIGN))
check('the field seat holds the crew right; the viewer does not', BASE_ROLE_PERMISSIONS.field.includes('inspections:answer') && !BASE_ROLE_PERMISSIONS.viewer.includes('inspections:answer'))

// ── answering ──────────────────────────────────────────────────────────────────────────────────────────────────────────
check('three answers, in plain words', ANSWERS.map((a) => a.label).join('|') === 'Pass|Fail|Not applicable')
check('a fail with no words is not sent', 'problem' in answerRequest('i1', { id: 'l1' }, 'fail', '  '))
check('a fail with two letters is not sent', failNeedsWords('ok') === true)
const pass = answerRequest('i1', { id: 'l1' }, 'pass', null)
check('a pass goes to the checklist line, with no note', 'path' in pass && pass.path === '/api/inspection-checklists/i1/items/l1' && pass.body.result === 'pass' && pass.body.note === null, pass)
const fail = answerRequest('i1', { id: 'l1' }, 'fail', '  Missing hanger at the north end ')
check('a fail goes with its words, trimmed', 'path' in fail && fail.body.note === 'Missing hanger at the north end', fail)
check('the answer route is the server\'s', server.includes("app.put('/:id/items/:itemId'") && server.includes("requireAnyPermission(['inspections:update', 'inspections:answer'])"))

// ── where the checklist stands ─────────────────────────────────────────────────────────────────────────────────────────
const L = (...r: string[]) => r.map((result, i) => ({ id: `l${i}`, label: `Line ${i}`, result: result as any, note: null }))
check('progress counts answered and failed', JSON.stringify(progress(L('pass', 'fail', 'pending', 'na'))) === '{"total":4,"answered":3,"failed":1,"left":1}')
check('the customer cannot sign with a line open, or with no checklist', readyToSign(L('pass', 'pending')) === false && readyToSign([]) === false)
check('the customer can sign when every line has an answer (a fail counts: it is an answer)', readyToSign(L('pass', 'fail', 'na')) === true)
check('standing says it in words', standing([], false) === 'No checklist yet' && standing(L('pass', 'pending'), false) === '1 of 2 answered'
  && standing(L('pass', 'pass'), false) === 'All answered' && standing(L('pass', 'fail'), false) === 'All answered — 1 failed' && standing(L('pass'), true) === 'Signed')
check('a visit line on the job says what it is and how far along', JSON.stringify(visitLine({ type: 'Framing', number: 'INS-0001', checklist: { total: 3, answered: 1, failed: 0 } })) === '{"title":"Framing · INS-0001","detail":"1 of 3 answered"}')
check('a signed visit line says by whom', visitLine({ type: 'Framing', signedBy: 'Rosa Ruiz' }).detail === 'Signed by Rosa Ruiz')

// ── signing ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const INK = 'data:image/svg+xml;base64,AAAA'
check('no name, no agreement or no signature is not sent', 'problem' in signRequest('i1', { signature: INK, signedBy: ' ', consent: true })
  && 'problem' in signRequest('i1', { signature: INK, signedBy: 'Rosa', consent: false }) && 'problem' in signRequest('i1', { signature: null, signedBy: 'Rosa', consent: true }))
const sent = signRequest('i1', { signature: INK, signedBy: ' Rosa Ruiz ', consent: true })
check('a signature goes to the sign route with the name, the picture and the agreement', 'path' in sent && sent.path === '/api/inspection-checklists/i1/sign' && sent.body.signedBy === 'Rosa Ruiz' && sent.body.consent === true && sent.body.signature === INK, sent)
check('the sign route is the server\'s', server.includes("app.post('/:id/sign'") && server.includes("'inspection_signature'"))
check('photos go to the server\'s photo route', read('app/(details)/inspection/[id].tsx').includes('/api/inspection-checklists/${id}/photos') && server.includes("add: 'inspections:answer'"))
check('saves are kept under the job\'s record key', recordKeyFor('j9') === 'job:j9')

// ── the screens ────────────────────────────────────────────────────────────────────────────────────────────────────────
const screen = read('app/(details)/inspection/[id].tsx')
check('the screen exists and uses the rules, not its own copy', screen.includes("from '../../../src/inspections/rules'") && screen.includes('answerRequest(') && screen.includes('signRequest(') && screen.includes('readyToSign('))
check('answers and the signature go through the offline queue', screen.includes('useOfflineApi') && /put\(req\.path, req\.body, \{ recordKey: key/.test(screen) && /post\(req\.path, req\.body, \{ recordKey: key/.test(screen))
check('the screen is gated on the same switch and permission as the card', screen.includes('showsInspections(hasFeature, can)') && screen.includes('showsSignature(hasFeature, can)') && screen.includes('mayAnswer(can)'))
check('the signature pad is the one the app already has, and scrolling stops while a finger draws', screen.includes("care/components/SignaturePad") && screen.includes('onDrawing={setDrawing}') && screen.includes('scrollEnabled={!drawing}'))
check('signed or resulted visits cannot be changed from the screen', /editable = canAnswer && !signed && !resulted/.test(screen) && /mayShowSignature = showsSignature\(hasFeature, can\) && !signed && !resulted/.test(screen))
check('the screen is listed in the details layout', read('app/(details)/_layout.tsx').includes("'inspection/[id]'"))
const jobScreen = read('app/(details)/job/[id].tsx')
check('the job screen shows the card only with the switch and the right', jobScreen.includes('JobInspections') && /job\.projectId && showsInspections\(hasFeature, can\)/.test(jobScreen))
check('the card opens the screen with the job it came from', read('src/inspections/JobInspections.tsx').includes('/(details)/inspection/${v.id}?job='))
const words = JSON.stringify([...screen.matchAll(/label="([^"]+)"|title="([^"]+)"|body="([^"]+)"/g)].map((m) => m[1] || m[2] || m[3]))
check('the words on the screen are plain: no developer words', !/\b(api|json|endpoint|payload|queue|token)\b/i.test(words), words)
check('the words on the screen carry no medical talk (this is a building inspection)', !/\b(patient|clinical|diagnos|medical|resident|caregiver)\b/i.test(screen + read('src/inspections/rules.ts')))
check('design Screen only gained the scroll switch (additive)', read('src/design/components/Screen.tsx').includes('scrollEnabled = true'))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
