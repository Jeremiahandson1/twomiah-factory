/**
 * Back up one tenant (every database it owns) to R2, or all active tenants.
 *
 *   cd apps/api && bun run scripts/backup-tenant.ts <tenant-slug>
 *   cd apps/api && bun run scripts/backup-tenant.ts --all
 *
 * Runs from inside Render without ceremony. From a laptop, the tenant's
 * database must have your IP allow-listed first — see
 * docs/RUNBOOK-backup-restore.md.
 */
import { createClient } from '@supabase/supabase-js'
import { backupTenant, backupAllTenants } from '../src/services/tenantBackup'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: bun run scripts/backup-tenant.ts <tenant-slug> | --all')
  process.exit(1)
}

const fmt = (n?: number) => (n === undefined ? '?' : n.toLocaleString())

if (arg === '--all') {
  const result = await backupAllTenants()
  for (const r of result.results) {
    console.log(
      (r.success ? 'ok  ' : 'FAIL') + ' ' + (r.database || r.tenantSlug).padEnd(38) +
      (r.success ? `${fmt(r.tableCount)} tables, ${fmt(r.rowCount)} rows, ${fmt(r.sizeBytes)} bytes` : r.error),
    )
  }
  console.log(`\n${result.succeeded}/${result.attempted} database backups succeeded`)
  process.exit(result.failed ? 1 : 0)
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: tenant } = await sb.from('tenants').select('id, slug, database_url').eq('slug', arg).single()
if (!tenant) {
  console.error('tenant not found:', arg)
  process.exit(1)
}

const results = await backupTenant(tenant as any)
for (const r of results) {
  console.log(
    (r.success ? 'ok  ' : 'FAIL') + ' ' + (r.database || r.tenantSlug).padEnd(38) +
    (r.success ? `${fmt(r.tableCount)} tables, ${fmt(r.rowCount)} rows, ${fmt(r.sizeBytes)} bytes` : r.error),
  )
}
process.exit(results.some(r => !r.success) ? 1 : 0)
