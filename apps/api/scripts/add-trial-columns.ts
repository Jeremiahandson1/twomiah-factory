/**
 * Add trial tracking columns to factory.tenants.
 * Idempotent — safe to run multiple times.
 *
 *   bun scripts/add-trial-columns.ts
 */
import pg from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envVars: Record<string, string> = {}
for (const rawLine of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim()
}

const DB_URL = envVars.DATABASE_URL || envVars.SUPABASE_DB_URL || process.env.DATABASE_URL
if (!DB_URL) {
  console.error('DATABASE_URL or SUPABASE_DB_URL is required in apps/api/.env')
  process.exit(1)
}

const url = new URL(DB_URL)
const client = new pg.Client({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.slice(1),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
})

const SQL = `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at            timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_warning_7d_sent_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_warning_3d_sent_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_warning_0d_sent_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_expired_at         timestamptz;

CREATE INDEX IF NOT EXISTS idx_tenants_trial_ends_at ON tenants(trial_ends_at) WHERE trial_ends_at IS NOT NULL;
`

async function main() {
  await client.connect()
  console.log('Connected — applying trial columns…')
  await client.query(SQL)
  console.log('✓ trial_ends_at + warning/expiry columns ensured on tenants')
  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name LIKE 'trial%'
    ORDER BY column_name
  `)
  console.log('\nCurrent trial-related columns:')
  for (const r of rows) console.log('  ' + r.column_name + ' (' + r.data_type + ')')
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
