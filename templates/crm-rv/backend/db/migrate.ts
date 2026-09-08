import { execSync } from 'child_process'

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

// Reconcile the database to db/schema.ts. The recorded migrations had drifted
// behind the schema — whole tables (ads_experiment*) and columns on existing
// tables (e.g. review_request.job_id/channel/rating/review_link) were missing, so
// GET /api/reviews and the ads-experiment endpoints 500'd with "column/relation
// does not exist". schema.ts is a strict superset of the DB, so push is purely
// additive here (creates missing tables/columns, drops nothing) and keeps the
// schema and DB from drifting again.
// ONE tightly-bounded, non-fatal push. drizzle-kit push can stall indefinitely — it hangs
// on "Pulling schema from database" against a busy free-tier Postgres, or blocks on a
// rename prompt despite --force. Plain execSync has no timeout, so a stuck push froze the
// whole boot: the &&-chained server never started and Render failed the deploy with "no
// open ports". Bound it with `timeout -k 10 25` (SIGTERM at 25s, SIGKILL 10s later, freeing
// the DB connection) and continue non-fatally — the start command runs its own bounded
// push (dbReconcileStep) which reconciles the schema.
try {
  console.log('[migrate] Reconciling schema (push, single bounded attempt)...')
  execSync('timeout -k 10 25 bun x drizzle-kit push --force', { stdio: 'inherit' })
  console.log('[migrate] Schema reconciled')
} catch (err: any) {
  console.error('[migrate] Schema reconcile (push) skipped/timed out — the start command runs its own bounded push; boot continues')
}

process.exit(0)
