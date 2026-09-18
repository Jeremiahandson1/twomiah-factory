// CI guard: two places where the clinic's own information was on screen but not where it mattered.
//   L7 — every recall said "your pet is due for care", to every owner, while the due list already knew the
//        pet, the vaccine and the date. The message is written once and personalised per recipient.
//   L8 — an allergy rendered as a detail row at the same weight as Colour, while only the free-text Medical
//        Alerts field produced a banner — so the one field the prescribing check reads (#233) was the
//        quietest thing on the chart.
//   bun scripts/check-recall-message.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// L7 — the merge
const r = read('templates/crm-vet/backend/src/routes/reminders.ts')
if (!r) fail('templates/crm-vet/backend/src/routes/reminders.ts is missing')
if (!/export function mergeReminder\(template: string/.test(r)) fail('a recall must be personalised per recipient')
if (!/export function listPhrase\(items: string\[\]\)/.test(r)) fail('…naming more than one pet in a way a person would say out loud')
if (!/const MERGE_FALLBACKS: Record<string, string> = \{[^}]*pet_name: 'your pet'/.test(r)) fail('a field with nothing behind it must fall back to wording that still reads as a sentence')
if (!/return k in MERGE_FALLBACKS \? MERGE_FALLBACKS\[k\] : whole/.test(r)) fail('…and a field nobody defined must be left alone, not blanked')
if (!r.includes(String.raw`/\{\{\s*([a-z_]+)\s*\}\}/gi`)) fail('the merge must tolerate spacing and casing inside the braces')
const send = r.match(/app\.post\('\/send'[\s\S]*?\n\}\)/)?.[0] || ''
if (!send) fail('the send route is missing')
if (!/const perOwner = new Map<string, \{ pets: string\[\]; vaccines: string\[\]; due: string\[\] \}>\(\)/.test(send)) fail("each owner's message must be built from THEIR due shots")
if (!/if \(!r\.ownerId\) continue/.test(send)) fail('…and a shot with no owner must not leak into somebody else\'s message')
if (!/const personalised = mergeReminder\(message, \{/.test(send)) fail('the personalised text must be what is sent')
if (!/message: personalised/.test(send)) fail('…actually passed to sendSMS, not the raw template')
for (const field of ['owner_name', 'pet_name', 'vaccine', 'due_date', 'clinic_name']) {
  if (!new RegExp(`${field}:`).test(send)) fail(`the recall must be able to name the ${field.replace('_', ' ')}`)
}

// L7 — the page
const page = read('templates/crm-vet/frontend/src/pages/vet/RemindersPage.tsx')
if (/your pet is due for care/.test(page)) fail('the generic template must be gone — that is the message the report was about')
if (!/\{\{pet_name\}\} is due for \{\{vaccine\}\} on \{\{due_date\}\}/.test(page)) fail('the default recall must name the pet, the vaccine and the date')
if (!/vaccinationIds\.length$/m.test(page) && !/vaccinationIds\.length\s*$/m.test(page)) fail('the win-back tab needs its own wording — it knows no vaccine')
if (!/Filled in for each owner:/.test(page)) fail('the form must say which fields get filled in, or nobody will use them')

// L8 — the allergy banner
const chart = read('templates/crm-vet/frontend/src/pages/vet/PatientDetailPage.tsx')
if (!/\{p\.allergies && \(\n\s*<div role="alert"/.test(chart)) fail('an allergy must render as an alert banner, like a medical alert')
if (!/<p className="font-semibold">Allergies<\/p>/.test(chart)) fail('…labelled Allergies')
if (/<dt className="text-gray-400">Allergies<\/dt>/.test(chart)) fail('…and must not ALSO sit in the details list, which is what said it was ordinary')
const alertsIdx = chart.indexOf('Medical Alert')
const allergyIdx = chart.indexOf('<p className="font-semibold">Allergies</p>')
if (alertsIdx < 0 || allergyIdx < 0 || allergyIdx < alertsIdx) fail('the allergy banner belongs beside the medical alert, above the details')

if (failed) { console.error(`\nrecall message: ${failed} check(s) FAILED`); process.exit(1) }
console.log('recall message: a recall names the pet, the vaccine and the date; an allergy reads as an alert')
