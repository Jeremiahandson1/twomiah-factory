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
