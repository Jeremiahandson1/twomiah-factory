import { execSync } from 'child_process'
import { Pool } from 'pg'

const MAX_RETRIES = 20
const RETRY_DELAY_MS = 10000

// Self-heal: guarantee tables that live only in schema.ts (not in the committed
// drizzle migrations) exist. The boot reconcile push is bounded/best-effort and
// does NOT reliably create new tables, so create them here explicitly. Idempotent.
async function ensureExtraTables() {
  if (!process.env.DATABASE_URL) return
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS vehicle_trip (
      id text PRIMARY KEY,
      status text NOT NULL DEFAULT 'active',
      start_time timestamp NOT NULL DEFAULT now(),
      end_time timestamp,
      start_lat real, start_lng real, end_lat real, end_lng real,
      distance_miles real,
      purpose text,
      vehicle_id text NOT NULL,
      user_id text,
      company_id text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS vehicle_trip_company_id_status_idx ON vehicle_trip (company_id, status)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS vehicle_trip_vehicle_id_idx ON vehicle_trip (vehicle_id)`)
    console.log('[migrate] ensured vehicle_trip table')
  } catch (e: any) {
    console.error('[migrate] ensureExtraTables error:', e.message)
  } finally {
    await pool.end().catch(() => {})
  }
}

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    console.log(`[migrate] Attempt ${attempt}/${MAX_RETRIES}...`)
    execSync('bun x drizzle-kit migrate', { stdio: 'inherit' })
    console.log('[migrate] Success')
    await ensureExtraTables()
    process.exit(0)
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
