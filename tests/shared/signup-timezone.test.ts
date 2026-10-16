// A signup's time zone is its state's — in the Factory's record and in the CRM, the same answer. (Run 4, 10/16)
//
//   Tester: "Signup keeps the timezone on Eastern after choosing Wisconsin (the Factory signup / tenant record);
//   the CRM's EVV page says America/Chicago."
//
// The public form's Timezone select starts on Eastern and does not follow the state; its value reached the Factory
// only as text in `notes`. The CRMs never read it: each derives the zone from the state the seed gives it. So the
// Factory now records the zone from the state too (apps/api/src/config/stateTimezone.ts), and this holds its table
// to every CRM's copy, state by state — if they ever disagree, the record and the CRM disagree again.
import { readFileSync } from 'node:fs'
const { stateTimezone, notesWithTimezone } = await import('../../apps/api/src/config/stateTimezone.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

check('Wisconsin is Central', stateTimezone('WI') === 'America/Chicago')
check('…in any case, with spaces', stateTimezone(' wi ') === 'America/Chicago')
check('New York is Eastern, Arizona is Phoenix', stateTimezone('NY') === 'America/New_York' && stateTimezone('AZ') === 'America/Phoenix')
check('no state, or not a state: no answer (the CRM decides as it always has)', stateTimezone('') === null && stateTimezone(undefined) === null && stateTimezone('Wisconsin') === null && stateTimezone(42) === null)

// The care form's notes, exactly as it builds them.
const formNotes = 'Deploy service: Twomiah hosts it | Timezone: America/New_York | Admin: Jo Test'
check('the form\'s Eastern is replaced by the state\'s zone, in place',
  notesWithTimezone(formNotes, 'America/Chicago') === 'Deploy service: Twomiah hosts it | Timezone: America/Chicago | Admin: Jo Test',
  notesWithTimezone(formNotes, 'America/Chicago'))
check('notes with no Timezone part gain one', notesWithTimezone('Admin: Jo Test', 'America/Chicago') === 'Admin: Jo Test | Timezone: America/Chicago')
check('no notes at all: the zone is still recorded', notesWithTimezone(undefined, 'America/Chicago') === 'Timezone: America/Chicago')
check('no known state: the notes are kept exactly as sent', notesWithTimezone(formNotes, null) === formNotes && notesWithTimezone('', null) === null)

// ── the same table as every CRM
function table(src: string, name: string): Record<string, string> {
  const start = src.indexOf('const ' + name)
  const body = src.slice(src.indexOf('{', start) + 1, src.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/([A-Z]{2}):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
}
const copies: Record<string, Record<string, string>> = {
  'crm-homecare services/agencyTime.ts': table(read('templates/crm-homecare/backend/src/services/agencyTime.ts'), 'STATE_ZONES'),
  'packages/tenant-backend time/businessDay.ts (the shared CRMs)': table(read('packages/tenant-backend/src/time/businessDay.ts'), 'STATE_TIME_ZONES'),
  'crm-dispensary utils/isoTime.ts': table(read('templates/crm-dispensary/backend/src/utils/isoTime.ts'), 'STATE_TIME_ZONES'),
}
for (const [where, zones] of Object.entries(copies)) {
  const states = Object.keys(zones)
  const differ = states.filter((s) => stateTimezone(s) !== zones[s])
  check(`the Factory agrees with ${where} on all ${states.length} states`, states.length >= 51 && differ.length === 0, { differ: differ.map((s) => [s, zones[s], stateTimezone(s)]) })
}

// ── the signup uses it, and the state reaches every CRM's seed
const intake = read('apps/api/src/routes/factory/intake.ts')
const signup = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
check('POST /public/signup derives the zone from the state', /const signupZone = stateTimezone\(body\.state\)/.test(signup))
check('…writes it into the tenant record\'s notes (the form\'s Eastern does not survive)', /notes: notesWithTimezone\(body\.notes, signupZone\)/.test(signup) && !/notes: body\.notes \|\| null/.test(signup))
check('…and keeps it with the signup\'s answers (intake_data.signup.timezone)', /\.\.\.\(signupZone \? \{ timezone: signupZone \} : \{\}\)/.test(signup))
check('…and hands the CRM the state it derives the same zone from', /state: body\.state \|\| undefined,/.test(signup) && /'\{\{STATE\}\}': c\.state \|\| '',/.test(read('apps/api/src/services/generator.ts')))
for (const t of ['crm', 'crm-basic', 'crm-fieldservice', 'crm-homecare', 'crm-landscaping', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-restaurant', 'crm-dispensary']) {
  check(`${t}'s seed stores the signup's state`, /state:\s*'\{\{STATE\}\}'/.test(read(`templates/${t}/backend/db/seed.template.ts`)))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
