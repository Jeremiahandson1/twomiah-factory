// Applies the is_test_tenant column + index. Idempotent (uses IF NOT EXISTS).
// Run: cd apps/api && bun run scripts/apply-test-tenant-migration.ts
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  process.exit(1)
}

const migrationPath = path.join(__dirname, '..', 'migrations', '2026-06-04_tenants_is_test_tenant.sql')
const sql = fs.readFileSync(migrationPath, 'utf8')

// Supabase REST doesn't expose raw SQL — use pg directly via DATABASE_URL,
// or fall back to instructing the user. Try pg path first.
const PG_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
if (PG_URL) {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: PG_URL })
  await client.connect()
  console.log('Applying migration via direct Postgres connection…')
  await client.query(sql)
  await client.end()
  console.log('OK — column + index in place.')
} else {
  console.log('No SUPABASE_DB_URL / DATABASE_URL set. Run this SQL in the Supabase SQL Editor:')
  console.log('─'.repeat(60))
  console.log(sql)
  console.log('─'.repeat(60))
  process.exit(2)
}
