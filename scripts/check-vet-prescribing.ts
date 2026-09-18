// CI guard: a prescription says who wrote it, and is checked against the chart before it is written.
//   The prescriberId column had existed all along and came back null on every script — nobody was ever
//   recorded as having prescribed anything (vet T12 M7) — and amoxicillin could be prescribed to a patient
//   whose chart records a penicillin allergy with no warning at all. The check warns rather than blocks: the
//   vet knows things the chart does not, but the override has to be deliberate and it goes into the audit log.
//   bun scripts/check-vet-prescribing.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the drug table
const drugs = read('templates/crm-vet/backend/src/config/drugClasses.ts')
if (!drugs) fail('templates/crm-vet/backend/src/config/drugClasses.ts is missing — nothing knows amoxicillin is a penicillin')
if (!/export function classOf\(/.test(drugs)) fail('a drug must resolve to its class')
if (!/export function allergyConflict\(/.test(drugs)) fail('…and a chart entry must be checkable against it')
for (const [cls, member] of [['penicillin', 'amoxicillin'], ['penicillin', 'clavamox'], ['sulfonamide', 'sulfamethoxazole'], ['NSAID', 'carprofen'], ['NSAID', 'rimadyl'], ['cephalosporin', 'cefovecin']]) {
  const block = drugs.match(new RegExp(`label: '${cls}'[\\s\\S]*?\\n  \\},`))?.[0] || ''
  if (!block.includes(`'${member}'`)) fail(`the ${cls} class must list ${member} — that pairing is the one the report was about`)
}
if (!/needle\.length < 4/.test(drugs)) fail('a short fragment must not count as a match ("pen" is not penicillin)')

// the route
const rx = read('templates/crm-vet/backend/src/routes/prescriptions.ts')
if (!/async function resolvePrescriber\(/.test(rx)) fail('a prescription must resolve its prescriber')
if (!/return \{ prescriberId: fallbackUserId \}/.test(rx)) fail('…defaulting to whoever is signed in, so a script is never written by nobody')
if (!/eq\(user\.companyId, companyId\)/.test(rx)) fail('…and never accepting a user from another clinic')
if ((rx.match(/resolvePrescriber\(currentUser\.companyId/g) || []).length < 2) fail('…on create AND on edit')
if (/resolvePrescriber\([^)]*currentUser\.id\b/.test(rx)) fail('the signed-in user is currentUser.userId — currentUser.id is undefined, which is how the column stayed null')
if (!/prescriberId: who\.prescriberId/.test(rx)) fail('the resolved prescriber must be what gets stored')
if (!/leftJoin\(user, eq\(user\.id, prescription\.prescriberId\)\)/.test(rx)) fail('the list must say who wrote each script, by name, not by id')

if (!/async function checkAllergy\(/.test(rx)) fail('a prescription must be checked against the chart')
if (!/allergyConflict\(p\.allergies, drug\)/.test(rx)) fail('…against the allergies column specifically')
if ((rx.match(/acknowledgeAllergy !== true/g) || []).length < 2) fail('the warning must be overridable, deliberately, on create and on edit')
if (!/allergyRefusal\(found, body\.drug\), 409\)/.test(rx)) fail('…and refuse with 409 until it is')
if ((rx.match(/allergyOverride: \{ documented: found\.hit\.allergy/g) || []).length < 2) fail('an override must land in the audit trail — on create AND on edit; it is a clinical decision, not a click')
if (!/'drug' in updates \|\| 'patientId' in updates/.test(rx)) fail('changing the drug, or the patient, is a new prescribing decision and must be re-checked')

// the chart
const patients = read('templates/crm-vet/backend/src/routes/patients.ts')
if (!/leftJoin\(user, eq\(user\.id, prescription\.prescriberId\)\)/.test(patients)) fail('the patient chart must name the prescriber too — it is where that question gets asked')

// the form
const page = read('templates/crm-vet/frontend/src/pages/vet/PatientDetailPage.tsx')
if (!/<Field label="Prescriber">/.test(page)) fail('the prescription form must offer a prescriber')
if (!/fetchStaff\(\)\.then\(setStaff\)/.test(page)) fail('…from /api/company/users (fetchStaff), the table prescriberId actually references')
if (!/acknowledgeWith === 'acknowledgeAllergy'/.test(page)) fail('the form must recognise the allergy refusal rather than showing a raw error')
if (!/Prescribe anyway/.test(page)) fail('…and offer to go ahead')
if (!/void save\(true\)/.test(page)) fail('…which re-sends the prescription acknowledged')
if (!/Documented allergies:/.test(page)) fail('a chart with allergies must say so before the drug is typed, not only after')
if (!/Prescribed by \{rx\.prescriber\.name\}/.test(page)) fail('a written script must show who wrote it')

if (failed) { console.error(`\nvet prescribing: ${failed} check(s) FAILED`); process.exit(1) }
console.log('vet prescribing: a script records its prescriber and is checked against the chart before it is written')
