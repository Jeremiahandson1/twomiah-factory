/**
 * Restore a tenant database from a backup envelope.
 *
 *   cd apps/api && bun run scripts/restore-tenant.ts <tenant-slug> <file.json> [--truncate] [--live]
 *
 * Dry run by default: it tells you exactly what it would load and changes
 * nothing. Add --live to actually write, and --truncate to replace table
 * contents rather than fill gaps.
 *
 * Never creates tables. If the schema is missing, deploy the tenant first so
 * its migrations run, then restore.
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { resolveTenantDatabases, restoreTenantData } from '../src/services/tenantBackup'

const [slug, file] = process.argv.slice(2)
const live = process.argv.includes('--live')
const truncate = process.argv.includes('--truncate')

if (!slug || !file) {
  console.error('usage: bun run scripts/restore-tenant.ts <tenant-slug> <file.json> [--truncate] [--live]')
  process.exit(1)
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: tenant } = await sb.from('tenants').select('id, slug, database_url').eq('slug', slug).single()
if (!tenant) {
  console.error('tenant not found:', slug)
  process.exit(1)
}

const databases = await resolveTenantDatabases(tenant as any)
if (databases.length === 0) {
  console.error('no database found for', slug)
  process.exit(1)
}
if (databases.length > 1) {
  // Loading a shop backup into a care database would be a very bad afternoon.
  console.error('This tenant has more than one database:')
  for (const d of databases) console.error('  -', d.name)
  console.error('Restore is refused until there is exactly one target. Restore them one at a time by')
  console.error('temporarily pointing tenants.database_url at the intended database.')
  process.exit(1)
}

const envelope = JSON.parse(readFileSync(file, 'utf8'))
console.log(`restoring into ${databases[0].name}`)
console.log(`backup taken: ${envelope.exportedAt || 'unknown'} — ${Object.keys(envelope.tables || {}).length} tables`)
console.log(live ? (truncate ? 'MODE: live, replacing table contents' : 'MODE: live, filling gaps only') : 'MODE: dry run (nothing will be written)')

const result = await restoreTenantData(databases[0].url, envelope, { truncate, dryRun: !live })
for (const t of result.tables) {
  console.log('  ' + t.status.padEnd(9) + t.table.padEnd(34) + t.rows + (t.detail ? '  — ' + t.detail : ''))
}
console.log(result.success ? '\nrestore OK' : '\nrestore finished WITH FAILURES — read the lines above')
process.exit(result.success ? 0 : 1)
