// CI guard: the veterinary inputs that were saving nonsense.
//   An exam room holds one appointment at a time — the provider was checked, the room never was, so two vets were
//   booked into Room 7 at 11:00 and the schedule stacked them (T12 M5); a refill count is a whole, non-negative
//   number — "-6" saved without complaint (T12 M8); a lab status is one of the words the form suggests —
//   "saffron" saved as written (T12 L1); and an address can be posted — "VVVVV" and an 11-digit ZIP both saved,
//   the only contact fields with no checking at all (T12 L3, shared: every CRM).
//   bun scripts/check-vet-validation.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// M5 — the room
const appts = read('templates/crm-vet/backend/src/routes/appointments.ts')
if (!/async function findRoomConflict\(/.test(appts)) fail('an exam room must be checked for clashes, like a provider')
if (!/sql`lower\(trim\(\$\{appointment\.room\}\)\) = \$\{trimmed\.toLowerCase\(\)\}`/.test(appts)) fail('…matching the room by name, ignoring case and padding')
if (!/ne\(appointment\.status, 'cancelled'\)/.test(appts.slice(appts.indexOf('async function findRoomConflict(')))) fail('…and ignoring cancelled appointments')
if ((appts.match(/await findRoomConflict\(/g) || []).length < 2) fail('both booking and editing must check the room')
if (!/is already booked for that time\./.test(appts)) fail('…and say which room is taken')
if (!/if \(body\.room && !body\.allowConflict\)/.test(appts) || !/if \(effRoom && effStatus !== 'cancelled' && !body\.allowConflict\)/.test(appts)) fail('a deliberate double-book (allowConflict) must still be possible')

// M8 — refills
const rx = read('templates/crm-vet/backend/src/routes/prescriptions.ts')
if (!/function refillsError\(v: unknown\)/.test(rx)) fail('a refill count must be validated')
if (!/if \(!Number\.isInteger\(n\) \|\| n < 0\) return 'Refills must be a whole number, and cannot be negative'/.test(rx)) fail('…a negative or fractional refill count must be refused')
if (!/if \(n > MAX_REFILLS\)/.test(rx)) fail('…and an absurd one')
if ((rx.match(/refillsError\(/g) || []).length < 3) fail('both creating and editing a prescription must check it')

// L1 — lab status
const lab = read('templates/crm-vet/backend/src/routes/labResults.ts')
if (!/const LAB_STATUSES = \['pending', 'normal', 'abnormal', 'critical', 'final'\] as const/.test(lab)) fail('a lab result status must come from a list')
if (!/function statusError\(v: unknown\)/.test(lab)) fail('…which is enforced')
if ((lab.match(/statusError\(/g) || []).length < 3) fail('…on create and on edit')
if (!/status: String\(body\.status \|\| 'final'\)\.trim\(\)\.toLowerCase\(\)/.test(lab)) fail('…and the stored value is tidied')

// L3 — the address (shared: every CRM)
const addr = read('packages/tenant-backend/src/address.ts')
if (!addr) fail('packages/tenant-backend/src/address.ts is missing — state and ZIP go back to being free text')
if (!/export function normaliseState\(v: unknown\): string \| null/.test(addr)) fail('a state must be resolved to its code, or refused')
if (!/export function normaliseZip\(v: unknown\): string \| null/.test(addr)) fail('a ZIP must be 12345 or 12345-6789, or refused')
if (!/WI: 'Wisconsin'/.test(addr) || !/PR: 'Puerto Rico'/.test(addr) || !/AE: 'Armed Forces Europe'/.test(addr)) fail('the state list must cover the states, the territories and the military post offices')
const contacts = read('packages/tenant-backend/src/contacts/contacts.ts')
if ((contacts.match(/normaliseState\(v\) !== null, \{ message: STATE_ERROR \}/g) || []).length < 2) fail('both contact schemas must check the state')
if ((contacts.match(/normaliseZip\(v\) !== null, \{ message: ZIP_ERROR \}/g) || []).length < 2) fail('…and the ZIP')

if (failed) { console.error(`\nvet validation: ${failed} check(s) FAILED`); process.exit(1) }
console.log('vet validation: one appointment per room, real refill counts, lab statuses from a list, postable addresses')
