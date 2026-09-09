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
    if (attempt === MAX_RETRIES) {
      console.error(`[migrate] Failed after ${MAX_RETRIES} attempts`)
      process.exit(1)
    }
    console.log(`[migrate] Connection failed, retrying in ${RETRY_DELAY_MS / 1000}s...`)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }
}
