// Prints a CRM template's db/schema.ts as the TableSpec list its boot reconcile applies — the same conversion as
// templates/<t>/backend/db/reconcile.ts (drizzle getTableConfig → packages/tenant-backend/src/schemaReconcile.ts), without
// a database. Run as a child process with NODE_PATH at this app's node_modules (the template folder has none of its
// own): templateLive.ts does that.
//
//   bun tests/templateSpecs.ts crm
import path from 'node:path'
import { is, SQL } from 'drizzle-orm'
import { getTableConfig, PgTable, PgDialect } from 'drizzle-orm/pg-core'

const template = process.argv[2]
if (!/^crm(-[a-z]+)?$/.test(template ?? '')) throw new Error('usage: bun tests/templateSpecs.ts <crm template>')
const schema = await import(path.resolve(import.meta.dir, '..', '..', '..', 'templates', template, 'backend', 'db', 'schema.ts'))
const dialect = new PgDialect()

// templates/crm/backend/db/reconcile.ts renderDefault, unchanged.
function renderDefault(col: any): string | null {
  if (col.default === undefined || col.default === null) return null
  const d = col.default
  if (is(d, SQL)) return dialect.sqlToQuery(d).sql
  const type = String(col.getSQLType())
  const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'"
  if (typeof d === 'string') return lit(d)
  if (typeof d === 'number' || typeof d === 'boolean') return String(d)
  if (typeof d === 'bigint') return d.toString()
  if (d instanceof Date) return lit(d.toISOString())
  if (Array.isArray(d) && /\[\]$/.test(type)) return lit('{' + d.map((v) => JSON.stringify(v)).join(',') + '}')
  return lit(JSON.stringify(d)) + (/^jsonb?$/.test(type) ? '::' + type : '')
}

const tables: unknown[] = []
for (const value of Object.values(schema)) {
  if (!is(value, PgTable)) continue
  const cfg = getTableConfig(value as any)
  tables.push({
    name: cfg.name,
    columns: cfg.columns.map((c: any) => ({ name: c.name, sqlType: c.getSQLType(), notNull: !!c.notNull, primary: !!c.primary, defaultSql: renderDefault(c) })),
    primaryKey: cfg.primaryKeys.flatMap((pk: any) => pk.columns.map((c: any) => c.name)),
    indexes: cfg.indexes.flatMap((i: any) => {
      const cols = (i.config.columns || []).map((c: any) => (c && typeof c.name === 'string' ? c.name : null))
      if (!i.config.name || cols.some((c: any) => !c)) return []
      return [{ name: i.config.name, unique: !!i.config.unique, columns: cols }]
    }),
  })
}
process.stdout.write(JSON.stringify(tables))
