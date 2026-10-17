// Boot-time schema reconcile: bring this tenant's database up to db/schema.ts — additively.
//
// Runs from the start command after migrate + prune-legacy and BEFORE the best-effort drizzle-kit
// push. It is the step that actually guarantees every table/column the code reads exists: push
// introspects the whole DB first and was being killed by the boot timeout on every Render boot, which
// left new columns (booking_settings.timezone, review_request.job_id, …) missing and whole modules
// 500ing. This script issues only CREATE TABLE / ADD COLUMN / CREATE INDEX ... IF NOT EXISTS, decided
// from one information_schema query, so it finishes in seconds and can never prompt or drop data.
//
//   DRY_RUN=1 bun db/reconcile.ts   → prints the DDL it would run
import { db, schema } from './index.ts'
import { sql, is, SQL } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { reconcileSchema, type TableSpec, type ColumnSpec } from '../src/shared/schemaReconcile.ts'

function renderDefault(col: any): string | null {
  if (col.default === undefined || col.default === null) return null
  const d = col.default
  if (is(d, SQL)) return (db as any).dialect.sqlToQuery(d).sql
  const type = String(col.getSQLType())
  const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'"
  if (typeof d === 'string') return lit(d)
  if (typeof d === 'number' || typeof d === 'boolean') return String(d)
  if (typeof d === 'bigint') return d.toString()
  if (d instanceof Date) return lit(d.toISOString())
  if (Array.isArray(d) && /\[\]$/.test(type)) return lit('{' + d.map(v => JSON.stringify(v)).join(',') + '}')
  return lit(JSON.stringify(d)) + (/^jsonb?$/.test(type) ? '::' + type : '')
}

const tables: TableSpec[] = []
for (const value of Object.values(schema)) {
  if (!is(value, PgTable)) continue
  const cfg = getTableConfig(value as any)
  const columns: ColumnSpec[] = cfg.columns.map((c: any) => ({
    name: c.name, sqlType: c.getSQLType(), notNull: !!c.notNull, primary: !!c.primary, defaultSql: renderDefault(c),
  }))
  const primaryKey = cfg.primaryKeys.flatMap((pk: any) => pk.columns.map((c: any) => c.name))
  const indexes = cfg.indexes.flatMap((i: any) => {
    const cols = (i.config.columns || []).map((c: any) => (c && typeof c.name === 'string' ? c.name : null))
    if (!i.config.name || cols.some((c: any) => !c)) return []  // expression / unnamed indexes are left to push
    return [{ name: i.config.name, unique: !!i.config.unique, columns: cols as string[] }]
  })
  tables.push({ name: cfg.name, columns, primaryKey, indexes })
}

const exec = { execute: async (statement: string) => { const r: any = await db.execute(sql.raw(statement)); return r?.rows ?? r ?? [] } }
const result = await reconcileSchema(exec, tables, { dryRun: !!process.env.DRY_RUN })
process.exit(0)
