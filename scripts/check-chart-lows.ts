// CI guard: four small things the clinic CRM knew but did not say.
//   L2 — opening a patient handed the owner picker an ID and nothing else, so the field read "Selected
//        owner": it knew who it was and would not say.
//   L4 — /crm/dashboard is a URL people type and bookmark; every CRM answered it with the 404 page, because
//        the dashboard is only the index route.
//   L5 — Add Vaccine's Rabies Tag started blank, so the number was retyped from the collar next to a record
//        that already had it — which is how a certificate ends up disagreeing with the chart.
//   L11 — a booking under a household's shared email discarded the name actually typed: the appointment
//        showed the account holder and nothing said who was bringing the animal in.
//   bun scripts/check-chart-lows.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// L2 — the owner picker
const picker = read('templates/crm-vet/frontend/src/components/vet/OwnerPicker.tsx')
if (!picker) fail('templates/crm-vet/frontend/src/components/vet/OwnerPicker.tsx is missing')
if (!/api\.get\(`\/api\/contacts\/\$\{value\}`\)/.test(picker)) fail('the picker must look up the owner it was handed, or it cannot name them')
if (!/if \(selectedLabel\) return/.test(picker)) fail('…and must not re-fetch one it already knows')
if (/'Selected owner'/.test(picker)) fail('"Selected owner" is the placeholder the report was about — it must be gone')

// L4 — the dashboard URL, in every CRM
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv', 'crm-salon', 'crm-restaurant', 'crm-vet', 'crm-dispensary']
for (const t of TEMPLATES) {
  const app = read(`templates/${t}/frontend/src/App.tsx`)
  if (!app) { fail(`templates/${t}/frontend/src/App.tsx is missing`); continue }
  if (!/<Route path="dashboard" element=\{<Navigate to="\/crm" replace \/>\} \/>/.test(app)) {
    fail(`${t} still answers /crm/dashboard with the 404 page`)
  }
}

// L5 — the rabies tag
const chart = read('templates/crm-vet/frontend/src/pages/vet/PatientDetailPage.tsx')
if (!/function VaccineModal\(\{ patientId, rabiesTag,/.test(chart)) fail('the vaccine form must be told the tag on the record')
if (!/rabiesTag: rabiesTag \|\| '',/.test(chart)) fail('…and start from it')
if (!/<VaccineModal patientId=\{p\.id\} rabiesTag=\{p\.rabiesTag\}/.test(chart)) fail('…which means passing it in')
if (!/value=\{form\.rabiesTag\} onChange=/.test(chart)) fail('…while staying editable, because an animal can be re-tagged')

// L11 — the booker's name
const booking = read('packages/tenant-backend/src/booking/service.ts')
if (!/const existingName = String\(theContact\?\.name \|\| ''\)\.trim\(\)/.test(booking)) fail('a booking must compare the typed name with the name on file')
if (!/fullName\.toLowerCase\(\) !== existingName\.toLowerCase\(\)/.test(booking)) fail('…case-insensitively, or "john" looks like somebody else')
if (!/`Booked by \$\{fullName\} \(account: \$\{existingName\}\)`/.test(booking)) fail('…and say who booked it, and whose account it is on')
if (!/customerNotes: \[bookedByNote, data\.notes\?\.trim\(\)\]\.filter\(Boolean\)\.join\(' — '\) \|\| null/.test(booking)) fail("…on the appointment, without losing the customer's own note")
if (!/if \(!theContact\) \{/.test(booking)) fail('…while still never overwriting the contact on file')

if (failed) { console.error(`\nchart lows: ${failed} check(s) FAILED`); process.exit(1) }
console.log('chart lows: the picker names the owner, /crm/dashboard resolves, the rabies tag carries over, the booker is recorded')
