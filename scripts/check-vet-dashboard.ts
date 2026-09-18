// CI guard: the veterinary dashboard tells the truth.
//   "Appointments Today" is work still to do — it counted cancelled and no-show slots too, so a day with two
//   cancellations read 9 when 7 were coming (T12 M3); a recent visit shows what it was worth — the total was never
//   selected, so every line read $0 (T12 M4); and the species chips bucket case-insensitively, so one legacy
//   capitalised "Dog" does not sit in its own bucket and drop out of the headline (T12 L9).
//   bun scripts/check-vet-dashboard.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const dash = read('templates/crm-vet/backend/src/routes/dashboard.ts')
if (!dash) fail('templates/crm-vet/backend/src/routes/dashboard.ts is missing')
if (!/const INACTIVE_APPT = \['cancelled', 'no_show'\]/.test(dash)) fail('the dashboard must name the statuses that are not work still to do')
{
  const todayQuery = (dash.split('\n').find((l) => l.includes('lt(appointment.startTime, tomorrow)')) || '')
  if (!/notInArray\(appointment\.status, INACTIVE_APPT\)/.test(todayQuery)) fail('"Appointments Today" must leave out cancelled and no-show slots')
}
if (!/total: visit\.total,/.test(dash)) fail('a recent visit must carry its total (every line read $0)')
if (!/species: sql<string>`lower\(\$\{patient\.species\}\)`/.test(dash) || !/groupBy\(sql`lower\(\$\{patient\.species\}\)`\)/.test(dash)) fail('the species chips must bucket case-insensitively, so "Dog" and "dog" are one species')

if (failed) { console.error(`\nvet dashboard: ${failed} check(s) FAILED`); process.exit(1) }
console.log("vet dashboard: today's count is work still to do, a visit shows its total, species bucket case-insensitively")
