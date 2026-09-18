// CI guard: the clinic CRM does not speak like a contractor CRM. "Owners" in the sidebar opened a page
// headed "Contacts" offering Leads, Clients, Subcontractors and Vendors; the Task form carried a Project
// selector in a practice that has no projects; and appointment types printed as raw lowercase enum values,
// so the hardest appointment a practice books appeared as the bare word "euthanasia". (Vet T12 M11)
//   bun scripts/check-vet-vocabulary.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the Owners page
const cfg = read('templates/crm-vet/frontend/src/contactsConfig.ts')
if (!cfg) fail('templates/crm-vet/frontend/src/contactsConfig.ts is missing')
if (!/title: 'Owners'/.test(cfg)) fail("the clinic's contacts page must be headed Owners, not Contacts")
if (!/\{ value: 'client', label: 'Owner' \}/.test(cfg)) fail('…calling a client an Owner')
if (!/\{ value: 'vendor', label: 'Supplier' \}/.test(cfg)) fail('…and a vendor a Supplier')
// the offered types only — the comment above them explains what was removed and why
const offered = cfg.match(/types: \[[\s\S]*?\]/)?.[0] || ''
if (/subcontractor/i.test(offered)) fail('a veterinary practice has no subcontractors — that type must not be offered')
if (!/convertLabel: 'Owner'/.test(cfg)) fail('converting an enquiry must make them an Owner')

// the appointment vocabulary
const vocab = read('templates/crm-vet/frontend/src/lib/appointmentTypes.ts')
if (!vocab) fail('templates/crm-vet/frontend/src/lib/appointmentTypes.ts is missing — the types go back to raw enum values')
if (!/export function appointmentTypeLabel/.test(vocab)) fail('a stored type must resolve to something a person reads')
for (const [value, label] of [['wellness', 'Wellness exam'], ['sick', 'Sick visit'], ['euthanasia', 'Euthanasia']]) {
  if (!new RegExp(`\\{ value: '${value}', label: '${label}' \\}`).test(vocab)) fail(`"${value}" must read as "${label}"`)
}
if (!/BY_VALUE\[v\.toLowerCase\(\)\] \|\| v\.replace/.test(vocab)) fail('a type nobody planned for must still read as a word, not as nothing')

const appts = read('templates/crm-vet/frontend/src/pages/vet/AppointmentsPage.tsx')
if (/const TYPES = \['wellness'/.test(appts)) fail('the appointment types must not be duplicated in the page — the form and the schedule would drift')
if (!/APPOINTMENT_TYPES\.map\(\(t\) => <option key=\{t\.value\} value=\{t\.value\}>\{t\.label\}<\/option>\)/.test(appts)) fail('the booking form must offer the labels')
if (!/\{appointmentTypeLabel\(a\.type\)\}/.test(appts)) fail('the schedule must print the label, not the stored value')
const dash = read('templates/crm-vet/frontend/src/pages/vet/DashboardPage.tsx')
if (!/\{appointmentTypeLabel\(a\.type\)\}/.test(dash)) fail("the dashboard's today list must print the label too")
// a raw {a.type} anywhere is the defect; status and species chips legitimately capitalise their own values
for (const [name, src] of [['AppointmentsPage', appts], ['DashboardPage', dash]] as const) {
  if (/\{a\.type\}/.test(src)) fail(`${name} still prints the stored appointment type instead of naming it`)
}

// the task form
const tasks = read('packages/tenant-ui/src/tasks/TasksPage.tsx')
if (!/\{\(projects\.length > 0 \|\| !!form\.projectId\) && \(/.test(tasks)) {
  fail('the Project selector must only appear where there are projects — or where the task already has one')
}

if (failed) { console.error(`\nvet vocabulary: ${failed} check(s) FAILED`); process.exit(1) }
console.log('vet vocabulary: owners, appointments and tasks read like a clinic rather than a building site')
