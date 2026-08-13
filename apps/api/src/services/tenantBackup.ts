// Tenant database backup + restore.
//
// What was true before this file existed:
//   - Render exposes NO backup, snapshot, export or point-in-time endpoint for
//     the plan tenant databases run on (basic_256mb). Verified against the live
//     API: /backups, /recovery-info, /exports, /snapshots all 404
//   - the only dump that ever ran was exportTenantData(), and only when a
//     customer was OFFBOARDING — i.e. data was captured exactly once, on the
//     way out the door
//   - there was no restore path at all
//
// So: routine backups reuse the proven exporter (same envelope, same R2
// bucket, different prefix + retention), and this adds the half that was
// missing — putting the data back.
//
// Deliberately data-only. Schema comes from each tenant's own drizzle
// migrations, which run at boot; recovery is "redeploy the tenant, then load
// the data". That is also why a restore never creates tables.

import { Client as PgClient } from 'pg'
import { supabase } from '../middleware/auth'
import { exportTenantData } from './dataExport'

const BACKUP_PREFIX = 'db-backups/'
// Retention is enforced by R2 lifecycle rules keyed on these prefixes (see
// scripts/r2-lifecycle.ts), NOT by pruning code — there is no delete loop to
// get wrong. Change a prefix here and you must change the rule with it.
const DAILY_PREFIX = BACKUP_PREFIX + 'daily/'
const MONTHLY_PREFIX = BACKUP_PREFIX + 'monthly/' 

/**
 * A pg client that works from inside Render AND from an operator's machine.
 * Render refuses external connections without TLS; internal hostnames have no
 * public certificate, so verification is off for those.
 */
export function tenantPgClient(connectionString: string): PgClient {
  const external = /\.(oregon|ohio|frankfurt|singapore|virginia)[-.]postgres\.render\.com/.test(connectionString)
    || /[?&]sslmode=require/.test(connectionString)
  return new PgClient({
    connectionString,
    connectionTimeoutMillis: 20_000,
    ssl: external ? { rejectUnauthorized: false } : undefined,
  })
}

export interface BackupResult {
  success: boolean
  tenantSlug: string
  /** Render database name — a tenant can have several (crm, shop, site). */
  database?: string
  key?: string
  tableCount?: number
  rowCount?: number
  sizeBytes?: number
  uncompressedBytes?: number
  error?: string
}

export interface TenantDatabase {
  name: string
  id: string
  url: string
  /** The other connection string. Which of the two works depends on where this
   *  is running, and getting it wrong looks like a dead connection. */
  fallbackUrl?: string
}

/**
 * Every database belonging to a tenant.
 *
 * Render names them per product, not per tenant: "<slug>-db" for a plain CRM,
 * but also "<slug>-shop-db", "<slug>-care-db", "<slug>-site-db" — and a tenant
 * can have several at once (five47-eau-claire has both a care DB and a site
 * DB). Matching only "<slug>-db" finds nothing for most tenants and silently
 * misses half the data for the rest, so match the whole family.
 */
export async function resolveTenantDatabases(tenant: {
  slug: string
  database_url?: string | null
}): Promise<TenantDatabase[]> {
  const apiKey = process.env.RENDER_API_KEY
  if (!apiKey) {
    return tenant.database_url ? [{ name: tenant.slug + '-db', id: 'unknown', url: tenant.database_url }] : []
  }
  const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }

  try {
    const listRes = await fetch('https://api.render.com/v1/postgres?limit=100', { headers })
    if (!listRes.ok) return []
    const list = await listRes.json()
    const matches = (list as any[])
      .map(x => x.postgres || x)
      .filter(p => typeof p?.name === 'string' && p.name.startsWith(tenant.slug + '-') && p.name.endsWith('-db'))

    const out: TenantDatabase[] = []
    for (const db of matches) {
      const infoRes = await fetch(`https://api.render.com/v1/postgres/${db.id}/connection-info`, { headers })
      if (!infoRes.ok) continue
      const info = await infoRes.json()
      // Inside Render the external string is a trap: tenant databases have an
      // empty ipAllowList, so Render refuses external connections and the
      // client reports "Connection terminated unexpectedly". From an
      // operator's machine the opposite holds — the internal hostname does not
      // resolve at all. Prefer by environment, keep the other as a fallback.
      const insideRender = !!process.env.RENDER || !!process.env.RENDER_SERVICE_ID || !!process.env.RENDER_EXTERNAL_URL
      const url = insideRender
        ? (info.internalConnectionString || info.externalConnectionString)
        : (info.externalConnectionString || info.internalConnectionString)
      const fallbackUrl = insideRender ? info.externalConnectionString : info.internalConnectionString
      if (url) out.push({ name: db.name, id: db.id, url, fallbackUrl: fallbackUrl === url ? undefined : fallbackUrl })
    }
    if (out.length === 0 && tenant.database_url) {
      out.push({ name: tenant.slug + '-db', id: 'unknown', url: tenant.database_url })
    }
    return out
  } catch {
    return tenant.database_url ? [{ name: tenant.slug + '-db', id: 'unknown', url: tenant.database_url }] : []
  }
}

/** First database for a tenant — convenience for single-DB callers. */
export async function resolveTenantDatabaseUrl(tenant: {
  slug: string
  database_url?: string | null
}): Promise<string | null> {
  const dbs = await resolveTenantDatabases(tenant)
  return dbs[0]?.url ?? tenant.database_url ?? null
}

/**
 * Take a routine backup of one tenant. Same envelope the offboard export
 * produces, so an operator can restore from either.
 */
export async function backupTenant(tenant: {
  id: string
  slug: string
  database_url?: string | null
}, opts?: { prefix?: string }): Promise<BackupResult[]> {
  const databases = await resolveTenantDatabases(tenant)
  if (databases.length === 0) {
    return [{ success: false, tenantSlug: tenant.slug, error: 'No database found for this tenant' }]
  }

  const results: BackupResult[] = []
  for (const db of databases) {
    // One archive per database — a tenant with a CRM and a site has two, and
    // merging them would make the restore ambiguous.
    // A connection failure here is usually the wrong route, not a dead
    // database — so try the other one before calling the backup failed.
    const runExport = async (url: string) => exportTenantData({
      tenantId: tenant.id,
      // The real slug: this goes in the envelope, and a restore reads it.
      tenantSlug: tenant.slug,
      // Keyed by DATABASE name, because a tenant can have several.
      keyLabel: db.name,
      keyPrefix: opts?.prefix || DAILY_PREFIX,
      tenantDatabaseUrl: url,
      compress: true,
      signUrl: false,
    })

    let result = await runExport(db.url)
    if (!result.success && db.fallbackUrl && /connect|terminated|timeout|ENOTFOUND|ECONNREFUSED/i.test(result.error || '')) {
      console.warn('[Backup] %s: %s — retrying on the other connection route', db.name, result.error)
      result = await runExport(db.fallbackUrl)
    }
    results.push({
      success: result.success,
      tenantSlug: tenant.slug,
      database: db.name,
      key: result.key,
      tableCount: result.tableCount,
      rowCount: result.rowCount,
      sizeBytes: result.sizeBytes,
      uncompressedBytes: result.uncompressedBytes,
      error: result.error,
    })
  }
  return results
}

/** Back up every active tenant. Used by the daily cron and by the runbook. */
export async function backupAllTenants(): Promise<{
  attempted: number
  succeeded: number
  failed: number
  results: BackupResult[]
}> {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, database_url')
    .eq('status', 'active')

  const results: BackupResult[] = []
  if (error) {
    return { attempted: 0, succeeded: 0, failed: 0, results: [{ success: false, tenantSlug: '*', error: error.message }] }
  }

  // On the 1st, also write a copy under the long-retention prefix. Same
  // envelope, written twice — the goal is a file that outlives the 30-day
  // daily window, and dumping every database a second time to get it would be
  // wasteful.
  const isFirstOfMonth = new Date().getUTCDate() === 1

  for (const tenant of data || []) {
    results.push(...(await backupTenant(tenant as any)))
    if (isFirstOfMonth) {
      results.push(...(await backupTenant(tenant as any, { prefix: MONTHLY_PREFIX })))
    }
  }
  return {
    attempted: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  }
}

export interface RestoreOptions {
  /** Wipe each table before loading it. Without this, restore only fills gaps. */
  truncate?: boolean
  /** Report what would happen and change nothing. */
  dryRun?: boolean
  /** Restore only these tables. */
  onlyTables?: string[]
}

export interface RestoreResult {
  success: boolean
  dryRun: boolean
  tables: Array<{ table: string; rows: number; status: 'restored' | 'skipped' | 'failed'; detail?: string }>
  error?: string
}

/**
 * Load a backup envelope back into a tenant database.
 *
 * Rules that matter:
 *  - never creates tables. If the schema is not there, the tenant has not been
 *    deployed yet and loading rows would be meaningless
 *  - a table missing from the target is REPORTED, not silently skipped
 *  - each table loads inside its own transaction, so one bad table cannot
 *    leave another half-loaded
 *  - session-ish tables are not in the envelope to begin with (see dataExport)
 */
export async function restoreTenantData(
  databaseUrl: string,
  envelope: { tenantSlug?: string; exportedAt?: string; tables: Record<string, any[]> },
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const { truncate = false, dryRun = false, onlyTables } = options
  const out: RestoreResult = { success: true, dryRun, tables: [] }

  if (!envelope || typeof envelope !== 'object' || !envelope.tables) {
    return { success: false, dryRun, tables: [], error: 'That file is not a Twomiah backup envelope' }
  }

  const client = tenantPgClient(databaseUrl)
  try {
    await client.connect()

    const existing = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    )
    const present = new Set(existing.rows.map(r => r.table_name))

    for (const [table, rows] of Object.entries(envelope.tables)) {
      if (onlyTables && !onlyTables.includes(table)) continue
      if (!Array.isArray(rows) || rows.length === 0) {
        out.tables.push({ table, rows: 0, status: 'skipped', detail: 'nothing to load' })
        continue
      }
      if (rows.some((r: any) => r && r.__exportError)) {
        out.tables.push({ table, rows: 0, status: 'skipped', detail: 'table failed to export — nothing to restore' })
        continue
      }
      if (!present.has(table)) {
        // Loud, not silent: the schema is older/newer than the backup.
        out.tables.push({ table, rows: rows.length, status: 'failed', detail: 'table does not exist in the target database' })
        out.success = false
        continue
      }
      if (dryRun) {
        out.tables.push({ table, rows: rows.length, status: 'skipped', detail: 'dry run' })
        continue
      }

      const quoted = '"' + table.replace(/"/g, '""') + '"'
      const columns = Object.keys(rows[0])
      const colList = columns.map(c => '"' + c.replace(/"/g, '""') + '"').join(', ')

      try {
        await client.query('BEGIN')
        if (truncate) await client.query('TRUNCATE ' + quoted + ' CASCADE')

        // Batched multi-row inserts; ON CONFLICT DO NOTHING so a partial
        // restore can be re-run without exploding on primary keys.
        const BATCH = 200
        for (let i = 0; i < rows.length; i += BATCH) {
          const slice = rows.slice(i, i + BATCH)
          const values: any[] = []
          const tuples = slice.map((row: any, rowIdx: number) => {
            const placeholders = columns.map((col, colIdx) => {
              values.push(row[col] === undefined ? null : row[col])
              return '$' + (rowIdx * columns.length + colIdx + 1)
            })
            return '(' + placeholders.join(', ') + ')'
          })
          await client.query(
            'INSERT INTO ' + quoted + ' (' + colList + ') VALUES ' + tuples.join(', ') + ' ON CONFLICT DO NOTHING',
            values,
          )
        }
        await client.query('COMMIT')
        out.tables.push({ table, rows: rows.length, status: 'restored' })
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {})
        out.tables.push({ table, rows: rows.length, status: 'failed', detail: err?.message })
        out.success = false
      }
    }

    return out
  } catch (err: any) {
    return { success: false, dryRun, tables: out.tables, error: err?.message }
  } finally {
    try { await client.end() } catch { /* ignore */ }
  }
}
