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
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    console.log(`[migrate] Reconciling schema (push) attempt ${attempt}/3...`)
    execSync('bun x drizzle-kit push --force', { stdio: 'inherit' })
    console.log('[migrate] Schema reconciled')
    break
  } catch (err: any) {
    if (attempt === 3) {
      // Non-fatal: let the app boot (working modules still serve) and surface the
      // failure loudly rather than bricking the entire deploy on a push hiccup.
      console.error('[migrate] Schema reconcile (push) failed — some modules may 500 until this succeeds')
    } else {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
  }
}

// Safety net: ensure all schema columns exist even if a migration was recorded
// before its file was present. Uses IF NOT EXISTS so it's safe to re-run.
const ENSURE_COLUMNS_SQL = `
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_price" TEXT;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "in_stock" BOOLEAN DEFAULT true;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "total_sold" INTEGER DEFAULT 0;
`

try {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  await pool.query(ENSURE_COLUMNS_SQL)
  await pool.end()
  console.log('[migrate] Verified required columns exist')
} catch (err: any) {
  console.error('[migrate] Column safety check failed:', err.message)
  process.exit(1)
}

process.exit(0)
