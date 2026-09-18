// CI guard: the veterinary feature copy is what a prospect is sold, so it must not describe things the app
// does not do. Three descriptions did (vet T12 L6): a patient photo (the column exists, no screen sets or
// shows one), an appointment "calendar by provider" (the schedule is a day list that names each
// appointment's provider), and "Non-controlled prescription records", which read as if a controlled drug
// could not be recorded at all — next to a form carrying exactly that checkbox. Both catalogues — the
// registry and the Factory build wizard — are checked, because a claim dropped from one used to survive in
// the other.
//   bun scripts/check-vet-feature-copy.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const registry = read('packages/tenant-backend/src/featureRegistry.ts')
const wizard = read('apps/platform/src/components/factory/StepFeatures.tsx')
if (!registry) fail('packages/tenant-backend/src/featureRegistry.ts is missing')
if (!wizard) fail('apps/platform/src/components/factory/StepFeatures.tsx is missing')

const descOf = (id: string, src: string) => src.match(new RegExp(`id: '${id}'[^\\n]*?description: '((?:[^'\\\\]|\\\\.)*)'`))?.[1] || ''

// A patient photo is not a thing the product does.
for (const [where, src] of [['the registry', registry], ['the build wizard', wizard]] as const) {
  if (/photo/i.test(descOf('patient_records', src))) fail(`${where} still sells a patient photo — no screen sets or shows one`)
  if (/calendar/i.test(descOf('appointment_scheduling', src))) fail(`${where} still calls the appointments screen a calendar — it is a day list`)
  if (/Non-controlled prescription records/.test(descOf('prescriptions', src))) fail(`${where} still reads as if a controlled drug cannot be recorded — the form has that checkbox`)
}

// …and what they say instead must still be true of the app.
const patients = descOf('patient_records', registry)
if (!/signalment/.test(patients) || !/weight history/.test(patients)) fail('patient_records must still describe what it does hold — signalment, weight history')
const appts = descOf('appointment_scheduling', registry)
if (!/provider/.test(appts) || !/type/.test(appts) || !/check-in/.test(appts)) fail('the appointments description must still name the provider, the type and check-in')
const rx = descOf('prescriptions', registry)
if (!/prescriber/.test(rx)) fail('the prescriptions description must mention the prescriber, which #233 added')
if (!/dispensing/.test(rx) || !/EPCS/.test(rx)) fail('…and must name what is genuinely absent: dispensing, EPCS')

// the socket finding is a measurement, not an opinion — it belongs in the doc testers read
const doc = read('docs/INTENDED_BEHAVIOUR.md')
if (!/opens once per page LOAD, not per navigation/.test(doc)) fail('the "new socket per navigation" finding must be written up — it was measured and is not true')
if (!/cdp-socket-count2\.ts/.test(doc)) fail('…naming the probe that reproduces the measurement, so the next report can be checked rather than argued')

if (failed) { console.error(`\nvet feature copy: ${failed} check(s) FAILED`); process.exit(1) }
console.log('vet feature copy: every veterinary description matches what the app actually does')
