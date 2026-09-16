// CI guard for the scheduling modules (template-local: salon/vet chairs & providers, restaurant spaces).
// Two regressions this pins shut:
//   1) Double-book race — the overlap check and the insert/update MUST run in one transaction under a
//      per-business advisory lock, or two concurrent saves both pass the check and both write.
//   2) "Cancel" must SOFT-cancel (status='cancelled'), never hard-delete the appointment row — the visit
//      has to stay on the client/patient history and in reporting.
//   bun scripts/check-appointment-guards.ts
import { readFileSync } from 'node:fs'

const base = new URL('../templates/', import.meta.url)
type Check = { file: string; entity: string; deleteVar: string; lock?: { file: string; call: RegExp } }
const targets: Check[] = [
  { file: 'crm-salon/backend/src/routes/appointments.ts', entity: 'appointment', deleteVar: 'appointment' },
  { file: 'crm-vet/backend/src/routes/appointments.ts', entity: 'appointment', deleteVar: 'appointment' },
  // restaurant: the lock + clash check live in services/eventBooking.ts (shared with the CSV importer, #162);
  // the route must take that lock inside its transaction on every write path.
  { file: 'crm-restaurant/backend/src/routes/events.ts', entity: 'event', deleteVar: 'event', lock: { file: 'crm-restaurant/backend/src/services/eventBooking.ts', call: /eventLock\(tx, currentUser\.companyId\)|createEvent\(tx, currentUser\.companyId/ } },
]

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

for (const t of targets) {
  const src = readFileSync(new URL(t.file, base), 'utf8')
  // 1) atomic double-book guard
  if (t.lock) {
    const lockSrc = readFileSync(new URL(t.lock.file, base), 'utf8')
    if (!lockSrc.includes('pg_advisory_xact_lock')) fail(`${t.lock.file}: no advisory lock — the double-book check+write is not atomic`)
    if (!t.lock.call.test(src)) fail(`${t.file}: writes must take the booking lock (eventLock / createEvent) inside the transaction`)
  } else if (!src.includes('pg_advisory_xact_lock')) fail(`${t.file}: no advisory lock — the double-book check+write is not atomic`)
  if (!/db\.transaction\(/.test(src)) fail(`${t.file}: the conflict check + write must run inside db.transaction()`)
  // 2) cancel must not hard-delete the primary row (line-item sub-deletes are fine)
  const hardDelete = new RegExp(`db\\.delete\\(\\s*${t.deleteVar}\\s*\\)`)
  if (hardDelete.test(src)) fail(`${t.file}: cancel hard-deletes ${t.deleteVar} — must set status='cancelled' to keep history`)
}

// RV calendar appointments (schedule-events): "Cancel" must soft-cancel (status='cancelled'), never a
// hard delete — the row stays on the calendar greyed and in history. (RV has no double-book guard yet,
// so only the hard-delete rule is asserted here.)
const rvSched = readFileSync(new URL('crm-rv/backend/src/routes/scheduleEvents.ts', base), 'utf8')
if (/db\.delete\(\s*scheduleEvent\s*\)/.test(rvSched)) fail(`crm-rv/backend/src/routes/scheduleEvents.ts: cancel hard-deletes scheduleEvent — must set status='cancelled' to keep history`)

if (failed) { console.error(`\nappointment guards: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`appointment guards: salon/vet/restaurant/rv cancels keep history; salon/vet/restaurant writes are atomic`)
