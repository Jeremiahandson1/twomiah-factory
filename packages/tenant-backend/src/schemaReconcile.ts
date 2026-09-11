// Boot-time schema reconcile — ADDITIVE ONLY, deterministic, no prompts, no introspection tool.
//
// Why this exists: every tenant DB is supposed to be brought up to `db/schema.ts` on boot. That used to
// rely on `drizzle-kit push`, which (a) introspects the whole database first — on Render's Postgres a
// 300-table CRM schema takes longer than the boot window, so push was killed on every boot and the
// schema silently stayed behind (booking_settings.timezone missing → the whole online-booking module
// 500'd), and (b) when it does finish it stops on interactive "created or renamed?" / data-loss prompts.
//
// This module does the one thing a tenant actually needs at boot: for every table in the Drizzle
// schema, CREATE TABLE IF NOT EXISTS; for every column, ADD COLUMN IF NOT EXISTS; for every plain
// index, CREATE INDEX IF NOT EXISTS. One information_schema query, then only the DDL that is missing.
// It never drops or alters anything — removing columns stays a deliberate, reviewed migration.
//
// It is schema-agnostic: the template's `db/reconcile.ts` turns its Drizzle tables into the plain
// `TableSpec` shape below (via drizzle's getTableConfig) so this file has no drizzle dependency and
// vendors cleanly into every CRM.

export interface ColumnSpec {
  name: string
  /** SQL type as drizzle renders it, e.g. "text", "numeric(12, 2)", "timestamp", "json", "text[]" */
  sqlType: string
  notNull: boolean
  primary: boolean
  /** Rendered SQL default expression (already quoted/escaped), or null when there is no DB default */
  defaultSql: string | null
}

export interface IndexSpec {
  name: string
  unique: boolean
  columns: string[]
}

export interface TableSpec {
  name: string
  columns: ColumnSpec[]
  /** Composite primary key columns (empty when a single column carries `primary`) */
  primaryKey: string[]
  indexes: IndexSpec[]
}

export interface ReconcileExecutor {
  /** Run a statement; must resolve to the rows for SELECTs. */
  execute(sql: string): Promise<any[]>
}

export interface ReconcileResult {
  createdTables: string[]
  addedColumns: string[]
  createdIndexes: string[]
  skipped: string[]
  errors: { statement: string; error: string }[]
}

const q = (ident: string) => '"' + ident.replace(/"/g, '""') + '"'

function columnDdl(col: ColumnSpec, forCreate: boolean): string {
  let ddl = q(col.name) + ' ' + col.sqlType
  if (col.primary && forCreate) ddl += ' PRIMARY KEY'
  if (col.defaultSql != null) ddl += ' DEFAULT ' + col.defaultSql
  // An existing table with rows cannot take a NOT NULL column without a default. Adding it nullable
  // keeps the app working (inserts always supply the value); the constraint remains in schema.ts for
  // fresh databases, which CREATE TABLE honours.
  if (col.notNull && !col.primary && (forCreate || col.defaultSql != null)) ddl += ' NOT NULL'
  return ddl
}

export function buildCreateTable(t: TableSpec): string {
  const parts = t.columns.map(c => columnDdl(c, true))
  if (t.primaryKey.length) parts.push('PRIMARY KEY (' + t.primaryKey.map(q).join(', ') + ')')
  return 'CREATE TABLE IF NOT EXISTS ' + q(t.name) + ' (\n  ' + parts.join(',\n  ') + '\n)'
}

export function buildAddColumn(table: string, col: ColumnSpec): string {
  return 'ALTER TABLE ' + q(table) + ' ADD COLUMN IF NOT EXISTS ' + columnDdl(col, false)
}

export function buildCreateIndex(table: string, idx: IndexSpec): string {
  return 'CREATE ' + (idx.unique ? 'UNIQUE ' : '') + 'INDEX IF NOT EXISTS ' + q(idx.name) + ' ON ' + q(table) + ' (' + idx.columns.map(q).join(', ') + ')'
}

/**
 * Bring the database up to `tables`. Additive only. Returns what it did; never throws for a single
 * failed statement (logged + collected) so one odd table cannot block the rest of the boot.
 */
export async function reconcileSchema(exec: ReconcileExecutor, tables: TableSpec[], opts: { dryRun?: boolean; log?: (line: string) => void } = {}): Promise<ReconcileResult> {
  const log = opts.log || ((l: string) => console.log(l))
  const result: ReconcileResult = { createdTables: [], addedColumns: [], createdIndexes: [], skipped: [], errors: [] }

  const rows = await exec.execute(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
  )
  const existing = new Map<string, Set<string>>()
  for (const r of rows) {
    const t = String(r.table_name), c = String(r.column_name)
    if (!existing.has(t)) existing.set(t, new Set())
    existing.get(t)!.add(c)
  }
  const idxRows = await exec.execute("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()")
  const existingIdx = new Set(idxRows.map((r: any) => String(r.indexname)))

  const run = async (statement: string, onOk: () => void) => {
    if (opts.dryRun) { log('[reconcile] DRY ' + statement.replace(/\s+/g, ' ')); onOk(); return }
    try { await exec.execute(statement); onOk() }
    catch (e: any) {
      const error = e?.message || String(e)
      result.errors.push({ statement, error })
      log('[reconcile] FAILED ' + statement.replace(/\s+/g, ' ').slice(0, 160) + ' → ' + error)
    }
  }

  for (const t of tables) {
    const cols = existing.get(t.name)
    if (!cols) {
      await run(buildCreateTable(t), () => result.createdTables.push(t.name))
      for (const idx of t.indexes) await run(buildCreateIndex(t.name, idx), () => result.createdIndexes.push(idx.name))
      continue
    }
    for (const c of t.columns) {
      if (cols.has(c.name)) continue
      await run(buildAddColumn(t.name, c), () => result.addedColumns.push(t.name + '.' + c.name))
    }
    for (const idx of t.indexes) {
      if (existingIdx.has(idx.name)) continue
      if (!idx.columns.every(c => cols.has(c) || t.columns.some(tc => tc.name === c))) { result.skipped.push('index ' + idx.name); continue }
      await run(buildCreateIndex(t.name, idx), () => result.createdIndexes.push(idx.name))
    }
  }

  log(`[reconcile] ${opts.dryRun ? 'would create' : 'created'} ${result.createdTables.length} tables, added ${result.addedColumns.length} columns, ${result.createdIndexes.length} indexes` +
    (result.errors.length ? `, ${result.errors.length} FAILED` : '') + (result.skipped.length ? `, ${result.skipped.length} skipped` : ''))
  if (result.createdTables.length) log('[reconcile] tables: ' + result.createdTables.join(', '))
  if (result.addedColumns.length) log('[reconcile] columns: ' + result.addedColumns.join(', '))
  return result
}
