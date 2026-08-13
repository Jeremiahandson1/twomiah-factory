/**
 * Restore a tenant database from a backup envelope.
 *
 *   cd apps/api && bun run scripts/restore-tenant.ts <tenant-slug> <file.json> [--truncate] [--live]
 *
 * Or restore into a database you name yourself, skipping tenant lookup:
 *
 *   bun run scripts/restore-tenant.ts --into <connection-string> <file.json> [--truncate] [--live]
 *
 * --into is how a restore gets rehearsed: pointed at a scratch database, there
 * is no code path that can reach a customer\'s. It is also what you want when
 * restoring into a rebuilt database, or checking an archive against a staging
 * copy before touching production.
 *
 * Dry run by default: it tells you exactly what it would load and changes
 * nothing. Add --live to actually write, and --truncate to replace table
 * contents rather than fill gaps.
 *
 * Never creates tables. If the schema is missing, deploy the tenant first so
 * its migrations run, then restore.
 */
import { readFileSync } from 'fs'
import { gunzipSync } from 'zlib'
import { createClient } from '@supabase/supabase-js'
import { resolveTenantDatabases, restoreTenantData } from '../src/services/tenantBackup'

const argv = process.argv.slice(2)
const live = argv.includes('--live')
const truncate = argv.includes('--truncate')

const intoIdx = argv.indexOf('--into')
const intoUrl = intoIdx >= 0 ? argv[intoIdx + 1] : undefined
// Everything that is not a flag or the value of --into.
const positional = argv.filter((a, i) => !a.startsWith('--') && i !== intoIdx + 1)
const [slug, fileArg] = intoUrl ? [undefined, positional[0]] : positional
const file = fileArg

if (!file || (!slug && !intoUrl)) {
  console.error('usage: bun run scripts/restore-tenant.ts <tenant-slug> <file.json> [--truncate] [--live]')
  console.error('   or: bun run scripts/restore-tenant.ts --into <connection-string> <file.json> [--truncate] [--live]')
  process.exit(1)
}

let target: { name: string; url: string }

if (intoUrl) {
  // Explicit target: no Supabase lookup, no Render lookup, no way to arrive at
  // a customer database by accident.
  target = { name: 'explicit target (--into)', url: intoUrl }
} else {
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
    console.error('temporarily pointing tenants.database_url at the intended database, or name the target')
    console.error('directly with --into <connection-string>.')
    process.exit(1)
  }
  target = { name: databases[0].name, url: databases[0].url }
}

// Scheduled backups are gzipped. Detected by magic bytes rather than by the
// file extension, so an operator who renamed the file can still restore it.
const fileBuf = readFileSync(file)
const isGzip = fileBuf.length > 2 && fileBuf[0] === 0x1f && fileBuf[1] === 0x8b
const envelope = JSON.parse((isGzip ? gunzipSync(fileBuf) : fileBuf).toString('utf8'))
console.log(`restoring into ${target.name}`)
console.log(`backup taken: ${envelope.exportedAt || 'unknown'} — ${Object.keys(envelope.tables || {}).length} tables`)
console.log(live ? (truncate ? 'MODE: live, replacing table contents' : 'MODE: live, filling gaps only') : 'MODE: dry run (nothing will be written)')

const result = await restoreTenantData(target.url, envelope, { truncate, dryRun: !live })
for (const t of result.tables) {
  console.log('  ' + t.status.padEnd(9) + t.table.padEnd(34) + t.rows + (t.detail ? '  — ' + t.detail : ''))
}
console.log(result.success ? '\nrestore OK' : '\nrestore finished WITH FAILURES — read the lines above')
process.exit(result.success ? 0 : 1)
