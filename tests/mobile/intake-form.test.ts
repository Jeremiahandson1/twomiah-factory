// Salon intake and consent forms on the phone (salon parity row 18): the rules the screen follows (apps/mobile/src/forms/intakeForm.ts), the
// client chart's Forms section, and the screen being a real, registered screen. The server's own checks are tests/salon-intake-depth.test.ts
// in apps/unified (the phone's requests are run against a real tenant there); nothing here needs a device.
//
//   bun run tests/mobile/intake-form.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { missing, needsUpload, jsonBody, uploadFields, standingWords, type Filled, type PhoneForm } from '../../apps/mobile/src/forms/intakeForm.ts'
import { specFor } from '../../apps/mobile/src/trades/specs.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const blank = (): Filled => ({ answers: {}, photos: {}, signedName: '', signature: null })
const intake: PhoneForm = { id: 'f1', name: 'Health history', kind: 'intake', intro: null, signature: 'typed', active: true, questions: [
  { id: 'a', label: 'Any allergies?', type: 'text', required: true }, { id: 'p', label: 'Photo of your hair', type: 'photo', required: true }, { id: 'n', label: 'Notes', type: 'longtext', required: false },
] }
const consent = (signature: 'typed' | 'drawn'): PhoneForm => ({ id: 'f2', name: 'Colour waiver', kind: 'consent', intro: null, signature, active: true, questions: [{ id: 'c', label: 'I agree', type: 'consent', required: true }] })

// What is missing — the server's own words, one at a time
check('a required answer is asked for first', missing(intake, blank()) === 'Please answer “Any allergies?”.')
check('then the required photo', missing(intake, { ...blank(), answers: { a: 'Latex' } }) === 'Please attach a photo for “Photo of your hair”.')
check('complete: nothing missing (the optional note may stay empty)', missing(intake, { ...blank(), answers: { a: 'Latex' }, photos: { p: 'file:///x.jpg' } }) === null)
check('an agreement must be ticked', missing(consent('typed'), blank()) === 'Please tick “I agree” to continue.')
check('a typed consent needs the full name', missing(consent('typed'), { ...blank(), answers: { c: '1' } }) === 'Please type your full name to sign.')
check('a one-letter name is not a name', missing(consent('typed'), { ...blank(), answers: { c: '1' }, signedName: 'S' }) === 'Please type your full name to sign.')
check('typed and complete', missing(consent('typed'), { ...blank(), answers: { c: '1' }, signedName: 'Sam Signer' }) === null)
check('a drawn consent needs the drawing', missing(consent('drawn'), { ...blank(), answers: { c: '1' }, signedName: 'Sam Signer' }) === 'Please sign in the box with your finger or mouse.')
check('a drawn consent still needs the name under it', missing(consent('drawn'), { ...blank(), answers: { c: '1' }, signature: 'data:image/svg+xml;base64,AAAA' }) === 'Please type your full name under your signature.')
check('drawn and complete', missing(consent('drawn'), { ...blank(), answers: { c: '1' }, signedName: 'Sam Signer', signature: 'data:image/svg+xml;base64,AAAA' }) === null)

// What is sent
const filled: Filled = { answers: { a: ' Latex ', n: '' }, photos: { p: 'file:///x.jpg' }, signedName: ' Sam ', signature: null }
check('a photo means an upload (too big for the offline list)', needsUpload(intake, filled) === true)
check('no photo: JSON the offline list can keep', needsUpload(intake, { ...filled, photos: {} }) === false)
check('the JSON body is trimmed and leaves out empty answers and pictures', JSON.stringify(jsonBody(intake, 'c1', filled)) === JSON.stringify({ contactId: 'c1', answers: { a: 'Latex' }, signedName: 'Sam' }))
check('the drawing travels only on a drawn consent', 'signature' in jsonBody(consent('drawn'), 'c1', { ...blank(), answers: { c: '1' }, signedName: 'Sam Signer', signature: 'data:image/svg+xml;base64,AAAA' }) && !('signature' in jsonBody(consent('typed'), 'c1', { ...blank(), answers: { c: '1' }, signedName: 'Sam Signer', signature: 'data:image/svg+xml;base64,AAAA' })))
check('the upload fields hold the answers as JSON', JSON.parse(uploadFields(intake, 'c1', filled).answers).a === 'Latex' && uploadFields(intake, 'c1', filled).contactId === 'c1')

// The chart's words
check('standing words: filled in, with the day it is good until', standingWords({ state: 'valid', expiresOn: '2027-01-05' }, (d) => `on ${d}`) === 'Filled in — good until on 2027-01-05')
check('standing words: run out; not filled in; link sent', standingWords({ state: 'expired' }) === 'Answers have run out' && standingWords({ state: 'missing', requested: true }) === 'Not filled in · link sent')

// The client chart: a Forms section (when the salon uses forms), a link into the screen for each form still to do
const clients = specFor('salon-clients')!
const section = clients.detail!.sections.find((s) => s.title === 'Forms')!
check('the client chart has a Forms section, only where the salon has forms on', !!section && section.feature === 'intake_forms')
check('the chart asks the server where this client stands with each form', clients.detail!.also!.forms('c9') === '/api/intake-forms/for-client?contactId=c9')
const chart = { contact: { id: 'c9', name: 'Sam Rivera' }, _also: { forms: { data: [
  { formId: 'f1', name: 'Health history', state: 'valid', expiresOn: '2027-01-05', requested: false },
  { formId: 'f2', name: 'Colour waiver', state: 'expired', expiresOn: null, requested: true },
  { formId: 'f3', name: 'Member terms', state: 'missing', expiresOn: null, requested: false },
] } } }
const rows = section.rows!(chart), links = section.links!(chart)
check('a row for each form with where they stand', rows.length === 3 && rows[0].badge === 'Done' && rows[1].badge === 'Run out' && rows[2].badge === 'To do')
check('a link to fill in only the forms still to do', links.length === 2 && links.every((l) => l.route!.startsWith('/(details)/intake-form?contactId=c9&formId=')) && links[0].label === 'Fill in “Colour waiver” with Sam Rivera')
check('a plain list (not wrapped in data) works too', section.rows!({ contact: chart.contact, _also: { forms: chart._also.forms.data } }).length === 3)
check('no forms: no rows and no links', section.rows!({ contact: chart.contact }).length === 0 && section.links!({ contact: chart.contact }).length === 0)

// The screen
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const screen = fs.readFileSync(path.join(root, 'app/(details)/intake-form.tsx'), 'utf8')
const layout = fs.readFileSync(path.join(root, 'app/(details)/_layout.tsx'), 'utf8')
check('the screen is registered without a stack header', layout.includes("'intake-form'"))
check('the screen saves through the offline list, keyed by client and form', /offline\.post\(`\/api\/intake-forms\/\$\{form\.id\}\/fill`/.test(screen) && screen.includes('recordKey: `intake:${contactId}:${form.id}`'))
check('the screen uploads a photo as a file, not through the list', screen.includes("upload(`/api/intake-forms/${form.id}/fill`") && screen.includes('needsUpload(form, v)'))
check('the screen is for seats that may update clients, with the salon\'s forms on', screen.includes("hasFeature('intake_forms') && can('contacts:update')"))
check('the screen draws a signature with the pad the care screens use', screen.includes("care/components/SignaturePad"))
check('no confirm/alert from the platform on the screen', !/\balert\(|Alert\./.test(screen))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
