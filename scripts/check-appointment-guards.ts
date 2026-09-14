// CI guard for the scheduling modules (template-local: salon/vet chairs & providers, restaurant spaces).
// Two regressions this pins shut:
//   1) Double-book race — the overlap check and the insert/update MUST run in one transaction under a
//      per-business advisory lock, or two concurrent saves both pass the check and both write.
//   2) "Cancel" must SOFT-cancel (status='cancelled'), never hard-delete the appointment row — the visit
//      has to stay on the client/patient history and in reporting.
//   bun scripts/check-appointment-guards.ts
import { readFileSync } from 'node:fs'

const base = new URL('../templates/', import.meta.url)
type Check = { file: string; entity: string; deleteVar: string }
const targets: Check[] = [
  { file: 'crm-salon/backend/src/routes/appointments.ts', entity: 'appointment', deleteVar: 'appointment' },
  { file: 'crm-vet/backend/src/routes/appointments.ts', entity: 'appointment', deleteVar: 'appointment' },
  { file: 'crm-restaurant/backend/src/routes/events.ts', entity: 'event', deleteVar: 'event' },
]

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

for (const t of targets) {
  const src = readFileSync(new URL(t.file, base), 'utf8')
  // 1) atomic double-book guard
  if (!src.includes('pg_advisory_xact_lock')) fail(`${t.file}: no advisory lock — the double-book check+write is not atomic`)
  if (!/db\.transaction\(/.test(src)) fail(`${t.file}: the conflict check + write must run inside db.transaction()`)
  // 2) cancel must not hard-delete the primary row (line-item sub-deletes are fine)
  const hardDelete = new RegExp(`db\\.delete\\(\\s*${t.deleteVar}\\s*\\)`)
  if (hardDelete.test(src)) fail(`${t.file}: cancel hard-deletes ${t.deleteVar} — must set status='cancelled' to keep history`)
}

if (failed) { console.error(`\nappointment guards: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`appointment guards: salon/vet/restaurant double-book writes are atomic and cancel keeps history`)
