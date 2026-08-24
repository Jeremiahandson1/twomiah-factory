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
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    console.log(`[migrate] Reconciling schema (push) attempt ${attempt}/3...`)
    execSync('bun x drizzle-kit push --force', { stdio: 'inherit' })
    console.log('[migrate] Schema reconciled')
    break
  } catch (err: any) {
    if (attempt === 3) {
      // Non-fatal: let the app boot and surface the failure rather than bricking
      // the whole deploy on a push hiccup.
      console.error('[migrate] Schema reconcile (push) failed — some endpoints may 500 until this succeeds')
    } else {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
  }
}

process.exit(0)
