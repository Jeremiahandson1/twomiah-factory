// CI guard: a pet booked online gets a species the chart actually recognises.
//
// The widget's species box is free text on a public page — it has to be, since refusing a booking because somebody
// typed "Kitty" loses the customer — while /api/patients enforces an enum. Unreconciled, whatever was typed went
// straight onto the chart: "Cat", "CAT", "Kitty", "unicorn" all became species nothing else in the product knows,
// which is how a capitalised "Dog" ends up in its own bucket on the dashboard. One vocabulary, one normaliser.
// (Vet T12 H5 remainder / L9)
//   bun scripts/check-booking-species.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const cal = read('packages/tenant-backend/src/booking/calendars.ts')
if (!/export function normaliseSpecies\(typed: string, vocab\?: \{ allowed: readonly string\[\]; fallback: string \}\): string/.test(cal)) fail('the booking calendar must normalise a typed species')
if (!/const key = raw\.toLowerCase\(\)\.replace\(\/\[\\s-\]\+\/g, '_'\)/.test(cal)) fail('matching must ignore case, spaces and hyphens ("Guinea Pig" is a guinea pig)')
if (!/if \(!raw\) return vocab\.fallback/.test(cal)) fail('an unanswered species must fall back, not leave the column to its default')
if (!/const mapped = SPECIES_SYNONYMS\[key\]/.test(cal) || !/return vocab\.fallback/.test(cal)) fail('everyday words must map, and anything else must land in the catch-all')
for (const [word, species] of [['kitty', 'cat'], ['bird', 'avian'], ['snake', 'reptile'], ['horse', 'equine'], ['rabbit', 'exotic'], ['puppy', 'dog']] as const) {
  if (!new RegExp(`${word}: '${species}'`).test(cal)) fail(`the synonyms must map ${word} → ${species}`)
}
if (!/pv\[p\.speciesColumn\] = placed/.test(cal)) fail('the normalised species must be what the chart is created with')
if (/pv\[p\.speciesColumn\] = String\(i\.petSpecies\)\.trim\(\)\s*$/m.test(cal.split('else if')[0])) fail('the raw typed species must no longer be written when a vocabulary is configured')
if (!/pv\[p\.notesColumn\] = `Species as booked: "\$\{typed\}"`/.test(cal)) fail('an answer we could not place must be kept verbatim on the chart')

// the vet wires its own vocabulary in, and the chart endpoint enforces the SAME list
const cfg = read('templates/crm-vet/backend/src/config/species.ts')
if (!/export const SPECIES = \['dog', 'cat', 'avian', 'reptile', 'equine', 'exotic', 'other'\] as const/.test(cfg)) fail('crm-vet must declare its species vocabulary in one place')
if (!/export const SPECIES_FALLBACK: Species = 'other'/.test(cfg)) fail('…and what an unrecognised answer becomes')
const booking = read('templates/crm-vet/backend/src/routes/booking.ts')
if (!/import \{ SPECIES, SPECIES_FALLBACK \} from '\.\.\/config\/species\.ts'/.test(booking)) fail('crm-vet booking must use that vocabulary')
if (!/species: \{ allowed: SPECIES, fallback: SPECIES_FALLBACK \}/.test(booking) || !/notesColumn: 'notes'/.test(booking)) fail('crm-vet booking must pass the vocabulary and the notes column to the calendar')
const patients = read('templates/crm-vet/backend/src/routes/patients.ts')
if (!/import \{ SPECIES \} from '\.\.\/config\/species\.ts'/.test(patients)) fail('crm-vet /api/patients must enforce the SAME vocabulary, not its own copy')
if (/const SPECIES = \['dog'/.test(patients)) fail('crm-vet /api/patients must not keep a second copy of the species list')

if (failed) { console.error(`\nbooking species: ${failed} check(s) FAILED`); process.exit(1) }
console.log('booking species: one vocabulary, typed answers normalised into it, an unplaceable answer kept on the chart')
