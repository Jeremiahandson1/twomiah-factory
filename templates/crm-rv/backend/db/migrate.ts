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
    // WHAT FAILED, not "the connection". (T58d)
    //
    // This loop exists because Render starts the service before Postgres accepts connections, so a
    // refused connection is worth waiting for. Everything else is not: a syntax error in a
    // migration fails exactly the same way twenty times, and calling it a connection problem is how
    // crm-vet spent four days unable to apply migrations 0029 to 0034 while its log blamed the
    // database. The start command swallows the exit code and `drizzle-kit push --force` papers over
    // the schema afterwards, so this message is the only warning anyone ever gets.
    const text = [err?.message, err?.cause?.message, String(err)].filter(Boolean).join(' | ')
    const isConnection = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|starting up|not yet accepting|terminating connection|Connection terminated|socket hang up|password authentication failed/i.test(text)

    if (!isConnection) {
      console.error('')
      console.error('[migrate] A MIGRATION FAILED. This is not a connection problem and retrying will not fix it.')
      console.error(`[migrate] ${text.split('\n')[0]}`)
      console.error('[migrate] Every migration in this run was rolled back — drizzle applies a run in ONE')
      console.error('[migrate] transaction — so this migration AND EVERY MIGRATION AFTER IT is unapplied.')
      console.error('[migrate] The service will still start, because the start command continues past this and')
      console.error('[migrate] drizzle-kit push reconciles what it can from schema.ts. Anything a migration does')
      console.error('[migrate] that push cannot — a data fix, a partial index not declared in schema.ts — has not')
      console.error('[migrate] happened. Fix the migration and redeploy.')
      console.error('')
      process.exit(1)
    }

    if (attempt === MAX_RETRIES) {
      console.error(`[migrate] Could not reach the database after ${MAX_RETRIES} attempts: ${text.split('\n')[0]}`)
      process.exit(1)
    }
    console.log(`[migrate] Database not reachable yet, retrying in ${RETRY_DELAY_MS / 1000}s...`)
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
