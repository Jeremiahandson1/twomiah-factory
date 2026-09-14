// CI guard: the shared jobs conflict check must be ATOMIC. Rejecting a second job on the same tech/slot
// is worthless if the check runs before the write with nothing holding the slot — two concurrent New-Job
// requests then both pass the check and both insert (FS double-booking race, 14/24 double-booked). So the
// check and the write must share one transaction under the per-company job advisory lock, exactly like the
// salon/vet appointment guard (#116) and the payment/refund row-locks in the same codebase.
//   bun scripts/check-job-doublebook.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-backend/src/jobs/jobs.ts', import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// A per-company advisory lock must exist and serialise job writes.
if (!/pg_advisory_xact_lock/.test(src)) {
  fail('jobs.ts must take a pg_advisory_xact_lock so concurrent job writes serialise (jobLock)')
}
// POST and PUT must both take the lock inside their transaction.
if ((src.match(/jobLock\s*\(\s*tx\b/g) || []).length < 2) {
  fail('both the create (POST) and update (PUT) handlers must call jobLock(tx) inside their transaction')
}
// Every conflict check must run against the transaction executor, never bare `db` outside the write.
// (Passing tx as the last arg is what makes the check see concurrent inserts under the lock.)
const calls = src.match(/assigneeConflict\([^;]*?\)/g) || []
const defLike = /const\s+assigneeConflict\s*=/
for (const call of calls) {
  if (defLike.test(call)) continue
  if (!/,\s*tx\s*\)/.test(call)) {
    fail('an assigneeConflict() call does not run inside the transaction (missing the tx executor argument) — the check-then-write is racy')
  }
}
if (calls.filter(c => !defLike.test(c)).length < 2) {
  fail('expected the conflict check in both POST and PUT')
}

if (failed) { console.error(`\njob double-book: ${failed} check(s) FAILED`); process.exit(1) }
console.log('job double-book: conflict check + write are atomic under the per-company job lock (create + update)')
