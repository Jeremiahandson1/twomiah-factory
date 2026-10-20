// A CRM template's database as a live tenant has it, for the data-move tests: not its migrations alone, but what every
// boot does after them (apps/api/src/services/deploy.ts dbReconcileStep) — db/prune-legacy.ts (drops the legacy tables,
// adds the raw-SQL columns) and db/reconcile.ts (schema.ts's tables and columns, additively). drizzle-kit push, the
// boot's best-effort last step, is not run: on Render it is killed before it finishes (deploy.ts), so a tenant may or
// may not have had it; without it is the case with the most left for the move to do.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { readLayout, type Layout, type Query } from '../../api/src/unified/move/schema.ts'
import { reconcileSchema, type TableSpec } from '../../../packages/tenant-backend/src/schemaReconcile.ts'

export const ROOT = path.resolve(import.meta.dir, '..', '..', '..')

export interface Db { db: PGlite; query: Query; layout: Layout }

async function migrated(folder: string): Promise<PGlite> {
  const db = new PGlite()
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'))
  for (const e of journal.entries) await db.exec(fs.readFileSync(path.join(folder, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint').join('\n'))
  return db
}

const wrap = async (db: PGlite): Promise<Db> => {
  const query: Query = (text, params) => db.query(text, params as any[]) as any
  return { db, query, layout: await readLayout(query) }
}

/** The unified app's database, from its own migrations. */
export const unifiedDb = async () => wrap(await migrated(path.join(ROOT, 'apps/unified/server/db/migrations')))

/**
 * A live template tenant's database. `keepLegacy`: a tenant whose prune never ran (its quickbooks_connection survives).
 */
export async function liveTemplate(template: 'crm' | 'crm-bar', opts: { keepLegacy?: boolean } = {}): Promise<Db> {
  const backend = path.join(ROOT, 'templates', template, 'backend')
  const db = await migrated(path.join(backend, 'db/migrations'))
  // db/prune-legacy.ts: its LEGACY_TABLES and ENSURE lists, read from the file so the test follows the template.
  const prune = fs.readFileSync(path.join(backend, 'db/prune-legacy.ts'), 'utf8')
  const legacy = new Function('return ' + /const LEGACY_TABLES = (\[[^\]]*\])/.exec(prune)![1])() as string[]
  if (!opts.keepLegacy) for (const t of legacy) await db.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
  const ensure = new Function('return ' + /const ENSURE = (\[[\s\S]*?\n\])/.exec(prune)![1])() as string[]
  for (const s of ensure) { try { await db.exec(s) } catch { /* prune-legacy.ts logs and goes on */ } }
  // db/reconcile.ts: schema.ts as specs (a child process: the template's schema resolves drizzle through NODE_PATH).
  const run = spawnSync(process.execPath, [path.join(import.meta.dir, 'templateSpecs.ts'), template], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_PATH: path.join(ROOT, 'apps/unified/node_modules') },
  })
  if (run.status !== 0) throw new Error(`templateSpecs ${template}: ${run.stderr || run.stdout}`)
  const specs = JSON.parse(run.stdout) as TableSpec[]
  const result = await reconcileSchema({ execute: async (s) => (await db.query(s)).rows as any[] }, specs, { log: () => {} })
  if (result.errors.length) throw new Error(`reconcile ${template}: ${result.errors.map((e) => e.error).join('; ')}`)
  return wrap(db)
}

/** Inserts a row with the given values (only the columns the table has); every other required column gets a plain value. */
export function putter(d: Db) {
  return async (table: string, values: Record<string, unknown>) => {
    const t = d.layout.get(table)
    if (!t) throw new Error(`${table}: not in this layout`)
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([k]) => t.columns.has(k)))
    for (const c of t.columns.values()) {
      if (c.name in row || c.nullable || c.hasDefault) continue
      row[c.name] = c.type.includes('timestamp') ? '2026-10-01T12:00:00Z' : c.type === 'boolean' ? false : /int|numeric|double|real/.test(c.type) ? 1 : c.type.startsWith('json') ? '{}' : c.type.startsWith('_') ? '{}' : c.type === 'date' ? '2026-10-01' : `${table}-${c.name}`
    }
    const cols = Object.keys(row)
    await d.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]))
  }
}
