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
      /**
       * A MIGRATION THAT FAILS HERE FAILS THE SUITE. (T58d)
       *
       * This used to be `catch (e) { console.log(...) }`, and that one line is why 11,702 assertions
       * were green while the vet tenant could not migrate at all. 0029 quoted the statement
       * separator inside a comment, so the split produced a fragment beginning with a backtick.
       * Postgres said `syntax error at or near "\`"`.
       *
       * On Render that is fatal: drizzle applies a run inside ONE transaction, so the error rolled
       * back 0029 through 0034 — the bill-once indexes, warranty_claim.job_id and the
       * duplicate-invoice heal — on every boot for four days. Here it printed a line into a stream
       * nobody reads and the loop carried on to the NEXT fragment, which was the CREATE UNIQUE INDEX
       * and which succeeded against clean sandbox data. So the sandbox ended up with the schema the
       * migration intended and the live tenant did not, and every test agreed with the sandbox.
       *
       * A sandbox that cannot reproduce a failed migration cannot be trusted about migrations. It
       * does not have to mirror the single transaction to be useful — it only has to stop pretending
       * the statement worked.
       */
      try {
        await pglite.exec(stmt)
      } catch (e: any) {
        const first = String(e?.message ?? e).split('\n')[0]
        throw new Error(
          `migration ${entry.tag} failed to apply: ${first}\n`
          + `  statement: ${stmt.replace(/\s+/g, ' ').slice(0, 200)}\n`
          + `  On a real tenant the whole run is one transaction, so this would roll back ${entry.tag} and\n`
          + `  every migration after it — silently, because db/migrate.ts reports any failure as a\n`
          + `  connection problem. Fix the migration; do not relax this.`,
        )
      }
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
    /**
     * UNIQUE CONSTRAINTS, which this spec used to drop on the floor.
     *
     * A schema can declare uniqueness three ways: a uniqueIndex() (above), a table-level unique()
     * constraint, and `.unique()` on the column itself. Only the first appears in cfg.indexes, so
     * the sandbox built `soc2_compliance_status` without the uniqueness that
     * `companyId: text('company_id')…unique()` declares — and `ON CONFLICT (company_id)` has nothing
     * to infer, so the SOC 2 dashboard answered 500 here and 200 on a live tenant, where the
     * migration's CREATE TABLE carries the constraint.
     *
     * Expressed as unique INDEXES because Postgres infers an ON CONFLICT target from either, and
     * because that is the one shape reconcileSchema already understands.
     */
    for (const u of (cfg.uniqueConstraints || [])) {
      const cols = (u.columns || []).map((c: any) => c?.name).filter(Boolean)
      if (!cols.length) continue
      const name = u.name || `${cfg.name}_${cols.join('_')}_unique`
      if (!indexes.some((i: any) => i.name === name)) indexes.push({ name, unique: true, columns: cols })
    }
    for (const c of cfg.columns as any[]) {
      if (!c.isUnique) continue
      const name = c.uniqueName || `${cfg.name}_${c.name}_unique`
      if (!indexes.some((i: any) => i.name === name)) indexes.push({ name, unique: true, columns: [c.name] })
    }
    tables.push({ name: cfg.name, columns, primaryKey, indexes })
  }
  const exec = { execute: async (statement: string) => { const r: any = await db.execute(sql.raw(statement)); return r?.rows ?? r ?? [] } }
  await reconcileSchema(exec, tables, { dryRun: false })

  /**
   * …and then the ENSURE net, which a real boot runs and this harness did not.
   *
   * migrate.ts applies an idempotent block of `ALTER TABLE … IF NOT EXISTS` and
   * `CREATE UNIQUE INDEX IF NOT EXISTS` after the migrations. Some of those indexes exist ONLY
   * there — no migration creates them — and an `ON CONFLICT` needs them. Replaying the journal
   * alone therefore builds a schema no real tenant has ever run, and eleven dispensary routes
   * answered 500 in the sandbox ("no unique or exclusion constraint matching the ON CONFLICT
   * specification") while answering 200, 201, 400 and 404 correctly on the live tenant. The suite
   * was reporting defects in its own fixture.
   *
   * It cannot be imported from migrate.ts — that file ends with a module-level process.exit(0), so
   * importing it kills the importer — so the block now lives in db/ensureColumns.ts and both the
   * boot path and this one read the same copy. Templates without that file simply skip this.
   *
   * Failures are logged and skipped, exactly as migrate.ts does: the net is a net, and a statement
   * that cannot apply to this database must not stop a suite from running.
   */
  try {
    const mod: any = await import('./db/ensureColumns.ts')
    const statements = String(mod.ENSURE_COLUMNS_SQL || '').split(';').map((s: string) => s.trim()).filter(Boolean)
    let failed = 0
    for (const stmt of statements) {
      try { await pglite.exec(stmt) } catch { failed++ }
    }
    if (statements.length) {
      console.log(`[setup] ENSURE net: ${statements.length - failed}/${statements.length} statements applied${failed ? ` (${failed} skipped)` : ''}`)
    }
  } catch (e: any) {
    // A template without an ENSURE net is the normal case and says nothing. Any OTHER reason the
    // import failed must be printed: a silent catch here is what let the net not run at all while
    // the suite looked like it was applying it.
    const why = String(e?.message || e)
    if (!/Cannot find module|ENOENT|Failed to resolve/i.test(why)) {
      console.log(`[setup] ENSURE net could NOT be applied: ${why.split('\n')[0]}`)
    }
  }
}
