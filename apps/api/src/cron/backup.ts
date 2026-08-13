/**
 * Cron job: back up the tenant databases in THIS runner's region.
 *
 * Runs the backup in-process rather than calling the factory API, because the
 * connection has to originate in the same Render region as the database: an
 * internal hostname does not resolve across regions, and the external one is
 * refused (tenant databases have an empty ipAllowList). Calling an endpoint in
 * Oregon would connect from Oregon, which is the problem, not the fix.
 *
 * BACKUP_REGION says which databases are this runner's responsibility.
 * Databases in other regions are skipped, not failed — see tenantBackup.ts.
 */
import { backupAllTenants, backupRegion } from '../services/tenantBackup'
import { notifyProvisionFailure } from '../services/email'

async function run() {
  const region = backupRegion()
  if (!region) {
    console.error('[Backup] BACKUP_REGION is not set — refusing to run rather than silently backing up nothing')
    process.exit(1)
  }

  console.log('[Backup] Sweep for region', region, 'at', new Date().toISOString())
  const result = await backupAllTenants()

  const stored = result.results.reduce((n, r) => n + (r.sizeBytes || 0), 0)
  const raw = result.results.reduce((n, r) => n + (r.uncompressedBytes || r.sizeBytes || 0), 0)
  for (const r of result.results) {
    console.log('[Backup]  %s %s %s', r.success ? 'ok  ' : 'FAIL', r.database || r.tenantSlug, r.success ? (r.rowCount + ' rows, ' + r.sizeBytes + ' bytes') : r.error)
  }
  console.log('[Backup] %d/%d ok, %d bytes stored (%d raw)', result.succeeded, result.attempted, stored, raw)

  const failures = result.results.filter(r => !r.success)
  if (failures.length > 0) {
    await notifyProvisionFailure(
      { slug: failures.map(f => f.tenantSlug).join(', ') },
      'Nightly database backup (' + region + ')',
      failures.map(f => (f.database || f.tenantSlug) + ': ' + (f.error || 'unknown error')).join('\n'),
    ).catch((e: any) => console.warn('[Backup] Staff alert failed:', e?.message))
    process.exit(1)
  }

  // Nothing to back up at all is not success — it means this runner found no
  // databases it owns, which is either a misconfigured region or a lookup that
  // failed, and both are worth knowing about.
  if (result.attempted === 0) {
    console.error('[Backup] No databases matched region', region)
    process.exit(1)
  }

  console.log('[Backup] Sweep complete')
}

run()
