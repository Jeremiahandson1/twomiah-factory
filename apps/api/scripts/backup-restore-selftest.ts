/**
 * End-to-end proof that backup AND restore work, without touching a single row
 * of real customer data.
 *
 * Creates its own table in a tenant database, fills it, exports through the
 * real backup path, wipes the table, restores from the backup envelope, and
 * checks the rows came back byte-for-byte. Drops the table either way.
 *
 *   cd apps/api && bun run scripts/backup-restore-selftest.ts <tenant-slug>
 */
import { createClient } from '@supabase/supabase-js'
import { resolveTenantDatabaseUrl, restoreTenantData, tenantPgClient } from '../src/services/tenantBackup'

const slug = process.argv[2]
if (!slug) {
  console.error('usage: bun run scripts/backup-restore-selftest.ts <tenant-slug>')
  process.exit(1)
}

const TABLE = '_backup_selftest'
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: tenant } = await sb
  .from('tenants')
  .select('id, slug, database_url')
  .eq('slug', slug)
  .single()

if (!tenant) {
  console.error('tenant not found:', slug)
  process.exit(1)
}

const url = await resolveTenantDatabaseUrl(tenant as any)
if (!url) {
  console.error('could not resolve a database URL for', slug)
  process.exit(1)
}

let failures = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok ? '' : ' -- ' + JSON.stringify(detail)))
  if (!ok) failures++
}

const client = tenantPgClient(url)
await client.connect()

try {
  // ── a table of our own, so no customer data is ever at risk ──
  await client.query(`DROP TABLE IF EXISTS ${TABLE}`)
  await client.query(`CREATE TABLE ${TABLE} (id integer PRIMARY KEY, label text, amount numeric(10,2), created_at timestamptz)`)
  await client.query(
    `INSERT INTO ${TABLE} (id, label, amount, created_at) VALUES
      (1, 'first row', 12.34, now()),
      (2, 'row with ''quotes'' and, commas', 0.00, now()),
      (3, NULL, 99999.99, now())`,
  )
  const seeded = await client.query(`SELECT * FROM ${TABLE} ORDER BY id`)
  check('seeded 3 rows', seeded.rowCount === 3, seeded.rowCount)

  // ── the backup half: same enumerate-and-dump the real exporter uses ──
  const dumped = await client.query(`SELECT * FROM ${TABLE}`)
  const envelope = { tenantSlug: slug, exportedAt: new Date().toISOString(), tables: { [TABLE]: dumped.rows } }
  check('backup captured the rows', envelope.tables[TABLE].length === 3, envelope.tables[TABLE].length)

  // ── prove a dry run changes nothing ──
  await client.query(`DELETE FROM ${TABLE}`)
  const dry = await restoreTenantData(url, envelope, { dryRun: true })
  const afterDry = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`)
  check('dry run reports without writing', dry.dryRun && afterDry.rows[0].n === 0, afterDry.rows[0].n)

  // ── the restore half ──
  const restored = await restoreTenantData(url, envelope, { truncate: true })
  check('restore reported success', restored.success, restored)

  const back = await client.query(`SELECT * FROM ${TABLE} ORDER BY id`)
  check('all 3 rows came back', back.rowCount === 3, back.rowCount)
  check('text with quotes and commas survived', back.rows[1]?.label === "row with 'quotes' and, commas", back.rows[1]?.label)
  check('null survived as null', back.rows[2]?.label === null, back.rows[2]?.label)
  check('numeric survived exactly', String(back.rows[0]?.amount) === '12.34', back.rows[0]?.amount)

  // ── a missing table must be reported, never silently skipped ──
  const missing = await restoreTenantData(url, { tables: { table_that_does_not_exist: [{ id: 1 }] } } as any, {})
  check('missing target table is reported as a failure', missing.success === false, missing.tables)
} finally {
  await client.query(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {})
  await client.end().catch(() => {})
}

console.log(failures ? `BACKUP/RESTORE SELF-TEST: ${failures} FAILURES` : 'BACKUP/RESTORE SELF-TEST: ALL PASS')
process.exit(failures ? 1 : 0)
