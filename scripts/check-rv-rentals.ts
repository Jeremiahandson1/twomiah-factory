// CI guard: RV rentals are stored per company, validated by the server and never double-booked. No in-memory list
// or made-up reservations; the server computes days/total from the dates; bookings lock the unit row and refuse an
// overlapping reservation; status changes follow reserved → out → returned (or cancelled). (RV T19 H5)
//   bun scripts/check-rv-rentals.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const T = 'templates/crm-rv/backend'

const schema = read(`${T}/db/schema.ts`)
if (!/export const rentalReservation = pgTable\('rental_reservation'/.test(schema)) fail('schema must define rental_reservation')
const migDir = `${T}/db/migrations`
const mig = readdirSync(join(ROOT, migDir)).find((f) => f.endsWith('.sql') && /CREATE TABLE IF NOT EXISTS "rental_reservation"/.test(read(`${migDir}/${f}`)))
if (!mig) fail('a migration must create rental_reservation')
else if (!read(`${migDir}/meta/_journal.json`).includes(`"tag": "${mig.replace(/\.sql$/, '')}"`)) fail(`${mig} must be in the migration journal`)

const r = read(`${T}/src/routes/rentals.ts`)
if (/const RES\s*[:=]|RES\.unshift|let seq\b|Mike Anderson/.test(r)) fail('rentals must not live in server memory or ship made-up reservations')
for (const [sig, perm] of [["app.get('/list'", 'contacts:read'], ["app.post('/create'", 'contacts:create'], ["app.post('/:id/status'", 'contacts:update']]) {
  if (!r.includes(`${sig}, requirePermission('${perm}')`)) fail(`${sig} must require ${perm}`)
}
const create = r.slice(r.indexOf("app.post('/create'"), r.indexOf("app.post('/:id/status'"))
if (!/if \(b\.end < b\.start\) return c\.json\([^)]*400\)/.test(create)) fail('create must refuse a return date before the pick-up date')
if (!/rate < 0 \|\| rate > MAX_RATE/.test(create)) fail('create must refuse a negative or absurd rate')
if (!/const days = Math\.max\(1, Math\.round\(\(Date\.parse/.test(create) || /Number\(b\.days\)/.test(create)) fail('days must be computed from the dates, never taken from the request')
if (!/eq\(unit\.companyId, user\.companyId\)\)\)\.limit\(1\)\.for\('update'\)/.test(create)) fail('create must lock the company\'s unit row before checking for overlaps')
if (!/notInArray\(rentalReservation\.status, \['returned', 'cancelled'\]\)/.test(create) || !/rentalReservation\.startDate\} < \$\{until\}/.test(create) || !/if \(clash\) return \{ status: 409 as const, error: `\$\{unitLabel\(u\)\} is already booked/.test(create)) fail('create must refuse (409) a reservation overlapping one that still holds the unit')
if (create.indexOf('.for(\'update\')') > create.indexOf('tx.insert(rentalReservation)')) fail('the lock and overlap check must come before the insert')
if (!/u\.status === 'sold'\) return \{ status: 409/.test(create)) fail('a sold unit must not be rentable')
if (!/const NEXT: Record<string, string\[\]> = \{ reserved: \['out', 'cancelled'\], out: \['returned'\], returned: \[\], cancelled: \[\] \}/.test(r)) fail('status changes must follow reserved → out/cancelled, out → returned')
if (!/filter \(where \$\{rentalReservation\.status\} <> 'cancelled'\)/.test(r)) fail('revenue must exclude cancelled reservations')

const page = read('templates/crm-rv/frontend/src/pages/rv/RentalsPage.tsx')
if (!/value=\{form\.unitId\}/.test(page) || !/api\.get\('\/api\/units'/.test(page)) fail('the page must book a real unit (picker), not free text')
if (!/catch \(e: any\) \{ setError\(e\?\.message \|\| 'Could not save the reservation'\)/.test(page)) fail('the page must show why a booking was refused')

if (failed) { console.error(`\nrv rentals: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv rentals: stored per company, validated, locked against double-booking, with a real status flow')
