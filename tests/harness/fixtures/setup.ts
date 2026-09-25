// Apply the tenant's real migrations (journal order), then the boot reconcile — the same schema path a
// Render boot takes — onto the in-process PGlite database.
import { readFileSync } from 'node:fs'
import { db, pglite, schema } from './db/index.ts'
import { sql, is, SQL } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { reconcileSchema, type TableSpec, type ColumnSpec } from './src/shared/schemaReconcile.ts'

export async function setupSchema() {
  const journal = JSON.parse(readFileSync(new URL('./db/migrations/meta/_journal.json', import.meta.url), 'utf8'))
  for (const entry of journal.entries) {
    const text = readFileSync(new URL(`./db/migrations/${entry.tag}.sql`, import.meta.url), 'utf8')
    for (const stmt of text.split('--> statement-breakpoint').map((s: string) => s.trim()).filter(Boolean)) {
      try { await pglite.exec(stmt) } catch (e: any) { console.log(`[setup] ${entry.tag}: ${e.message.split('\n')[0]}`) }
    }
  }
  // db/reconcile.ts body (it ends with process.exit, so it is inlined here)
  const renderDefault = (col: any): string | null => {
    if (col.default === undefined || col.default === null) return null
    const d = col.default
    if (is(d, SQL)) return (db as any).dialect.sqlToQuery(d).sql
    const type = String(col.getSQLType())
    const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'"
    if (typeof d === 'string') return lit(d)
    if (typeof d === 'number' || typeof d === 'boolean') return String(d)
    if (d instanceof Date) return lit(d.toISOString())
    if (Array.isArray(d) && /\[\]$/.test(type)) return lit('{' + d.map(v => JSON.stringify(v)).join(',') + '}')
    return lit(JSON.stringify(d)) + (/^jsonb?$/.test(type) ? '::' + type : '')
  }
  const tables: TableSpec[] = []
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue
    const cfg = getTableConfig(value as any)
    const columns: ColumnSpec[] = cfg.columns.map((c: any) => ({ name: c.name, sqlType: c.getSQLType(), notNull: !!c.notNull, primary: !!c.primary, defaultSql: renderDefault(c) }))
    const primaryKey = cfg.primaryKeys.flatMap((pk: any) => pk.columns.map((c: any) => c.name))
    const indexes = cfg.indexes.flatMap((i: any) => {
      const cols = (i.config.columns || []).map((c: any) => (c && typeof c.name === 'string' ? c.name : null))
      if (!i.config.name || cols.some((c: any) => !c)) return []
      return [{ name: i.config.name, unique: !!i.config.unique, columns: cols as string[] }]
    })
    tables.push({ name: cfg.name, columns, primaryKey, indexes })
  }
  const exec = { execute: async (statement: string) => { const r: any = await db.execute(sql.raw(statement)); return r?.rows ?? r ?? [] } }
  await reconcileSchema(exec, tables, { dryRun: false })
}
