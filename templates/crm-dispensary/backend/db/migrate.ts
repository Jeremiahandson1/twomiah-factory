import { execSync } from 'child_process'
import pg from 'pg'

const MAX_RETRIES = 20
const RETRY_DELAY_MS = 10000

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    console.log(`[migrate] Attempt ${attempt}/${MAX_RETRIES}...`)
    execSync('bun x drizzle-kit migrate', { stdio: 'inherit' })
    console.log('[migrate] Success')
    break
  } catch (err: any) {
    if (attempt === MAX_RETRIES) {
      console.error(`[migrate] Failed after ${MAX_RETRIES} attempts`)
      process.exit(1)
    }
    console.log(`[migrate] Connection failed, retrying in ${RETRY_DELAY_MS / 1000}s...`)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }
}

// Reconcile the database to schema.ts. The hand-maintained SQL migrations drifted
// badly behind the Drizzle schema — ~50 tables (locations, batches, metrc, labels,
// kiosk, delivery, compliance, …) were never created, and existing tables like
// cash_sessions were missing newer columns (register, opening_amount, opened_by_id).
// That drift is exactly what made ~20 endpoints (and the whole POS/register path)
// return 500 "relation/column does not exist". schema.ts is a strict superset of the
// DB, so `push` is purely additive here — it creates the missing tables/columns and
// never drops anything. This also stops the drift recurring as the schema evolves.
// drizzle-kit push can stall indefinitely: it hangs on "Pulling schema from database"
// against a busy free-tier Postgres and, despite --force, can block on an interactive
// rename prompt. Plain execSync has no timeout, so a stuck push froze the ENTIRE boot —
// the &&-chained server never started and Render failed the deploy with "no open ports".
// Bound each attempt with `timeout` (the start-command push already uses this pattern):
// -k 10 60 sends SIGTERM at 60s and SIGKILL 10s later, so a hung push is killed, its DB
// connection released, and we fall through to the authoritative, idempotent ENSURE net
// below. Reconciliation is guaranteed by ENSURE + the prune-legacy-protected push in the
// start command — this step is belt-and-suspenders, so timing out is non-fatal.
// ONE tightly-bounded, non-fatal push. drizzle-kit push stalls intermittently on this
// tenant (see above), and each stalled attempt burns ~its full timeout against the
// deploy's port-bind window. Retrying it here only compounds that delay, so we make a
// single bounded attempt and let the authoritative, idempotent ENSURE net below — plus
// the start command's own bounded push — reconcile the schema. -k 10 45: SIGTERM at 45s,
// SIGKILL 10s later, so a hung push is killed and its DB connection freed.
try {
  console.log('[migrate] Reconciling schema (push, single bounded attempt)...')
  execSync('timeout -k 10 25 bun x drizzle-kit push --force', { stdio: 'inherit' })
  console.log('[migrate] Schema reconciled')
} catch (err: any) {
  console.error('[migrate] Schema reconcile (push) skipped/timed out — the idempotent ENSURE net below reconciles the known schema; boot continues')
}

// Safety net: ensure all schema columns exist even if a migration was recorded
// before its file was present. Uses IF NOT EXISTS so it's safe to re-run.
// Lives in ./ensureColumns.ts so the test harness can import and apply it too — migrate.ts ends
// with a module-level process.exit(0), so importing THIS file would kill the importer.
import { ENSURE_COLUMNS_SQL } from './ensureColumns.ts'

// Apply the safety net one statement at a time so a single failing statement can't
// discard the whole batch. Sending the entire multi-statement SQL through one
// pool.query() runs it in an implicit transaction: if ANY statement errored (e.g. a
// CREATE UNIQUE INDEX blocked by pre-existing duplicate rows, or an UPDATE on a table
// that hadn't been created yet), Postgres rolled back ALL of it — including the
// cash_sessions/loyalty_members created_at ADDs — so the drawer + loyalty routes 500'd
// with "column created_at does not exist". migrate.ts then exit(1)'d, but the deployed
// start command (… && bun db/migrate.ts && … ; for … push … ; … && bun src/index.ts)
// continues past a migrate failure, so the server still booted with the columns missing.
// Running each statement independently and non-fatally makes every IF-NOT-EXISTS column
// land regardless of an unrelated statement failing. (deep-QA root cause)
{
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  // Strip -- line comments from the WHOLE net first, THEN split on ';'. Doing it in this
  // order means comment prose can contain ';' (or anything) without corrupting the split.
  // (No -- appears inside any string literal in this SQL, so global stripping is safe.)
  const statements = ENSURE_COLUMNS_SQL
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  let failed = 0
  for (const stmt of statements) {
    try {
      await pool.query(stmt)
    } catch (err: any) {
      failed++
      console.error('[migrate] ENSURE stmt failed (continuing):', err.message, '::', stmt.replace(/\s+/g, ' ').slice(0, 90))
    }
  }
  await pool.end()
  console.log(`[migrate] Column safety net applied — ${statements.length - failed}/${statements.length} statements ok${failed ? ` (${failed} skipped, non-fatal)` : ''}`)
}

process.exit(0)
