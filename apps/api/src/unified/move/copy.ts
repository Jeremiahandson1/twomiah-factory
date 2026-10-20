// The data move, part 2: copy a live template tenant's rows into its new, empty unified database — every table both
// layouts have (schema.ts planMove), then the vertical's data steps — as ONE transaction on the new database, read from
// ONE read-only snapshot of the old. Nothing is written to the old database. A failure leaves the new one empty.
//
// Values travel as text and are cast to the new column's type on the way in, so nothing passes through a JavaScript
// Date or float: a timestamp with a time zone is read at UTC (the unified rule, RULEBOOK §2), numerics keep every digit,
// json stays the text it was. A foreign key that points at a table filled later (a self-reference, a cycle) is left
// empty in the first pass and set in a second, once every row exists.
import type { Layout, MovePlan, Query } from './schema.ts'

/**
 * A value the copy supplies for a column the old layout lacks (home care's company_id; a new id), by table and column;
 * `row` is the old row (its columns as text) when one is being written, absent when only asking whether it fills one.
 */
export type Fill = (table: string, column: string, row?: Record<string, string | null>) => string | undefined

export interface MoveStep {
  /** Said in the report. */
  name: string
  /** Runs inside the new database's transaction; `read` reads the old snapshot. Returns what it did, for the report. */
  run: (io: { read: Query; write: Query }) => Promise<string>
}

export interface MoveOptions {
  read: Query
  write: Query
  plan: MovePlan
  target: Layout
  fill?: Fill
  /** Before the copy (e.g. the company row other rows point at) and after it (renames, merges). */
  before?: MoveStep[]
  after?: MoveStep[]
  /** Rows per INSERT is bounded by Postgres's 65535 parameters; this caps it lower. */
  batchRows?: number
}

export interface MoveReport {
  tables: { table: string; source: number; moved: number }[]
  steps: { step: string; did: string }[]
  /** Tables whose counts differ (none on a good move). */
  mismatches: string[]
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`

export async function moveTenant(o: MoveOptions): Promise<MoveReport> {
  const batchRows = o.batchRows ?? 500
  const report: MoveReport = { tables: [], steps: [], mismatches: [] }
  await o.read(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`)
  await o.write(`BEGIN`)
  try {
    for (const s of o.before ?? []) report.steps.push({ step: s.name, did: await s.run({ read: o.read, write: o.write }) })

    const position = new Map(o.plan.order.map((t, i) => [t, i]))
    const plans = new Map(o.plan.tables.map((t) => [t.table, t]))
    const later: { table: string; column: string; key: string[] }[] = []

    for (const table of o.plan.order) {
      const tp = plans.get(table)!
      const tt = o.target.get(table)!
      const copied = tp.columns.filter((c) => c.how !== 'left behind').map((c) => c.column)
      // Columns pointing at a table not yet filled (itself, or one later in the order): set in the second pass.
      const deferred = new Set(tt.foreignKeys.filter((fk) => copied.includes(fk.column) && (position.get(fk.refTable) ?? -1) >= (position.get(table) ?? 0)).map((fk) => fk.column))
      for (const col of deferred) {
        if (!tt.columns.get(col)?.nullable) throw new Error(`${table}.${col} points at rows filled later and may not be empty; this move cannot order it`)
        later.push({ table, column: col, key: tt.primaryKey })
      }
      const extra = [...tt.columns.keys()].filter((c) => !copied.includes(c) && o.fill?.(table, c) !== undefined)
      const cols = [...copied, ...extra]
      const selectList = copied.map((c) => {
        const from = tp.columns.find((x) => x.column === c)
        const fromType = from && from.how === 'convert' ? from.from : tt.columns.get(c)?.type
        return fromType === 'timestamp with time zone' ? `to_char(${q(c)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${q(c)}` : `${q(c)}::text AS ${q(c)}`
      }).join(', ')
      // Pages in the new key's order when the old table has it; otherwise (no key, or a key the move makes — home care's
      // ai_receptionist_settings.id) in the rows' physical order, which one snapshot holds still.
      const order = tt.primaryKey.length && tt.primaryKey.every((k) => copied.includes(k)) ? tt.primaryKey.map(q).join(', ') : 'ctid'
      const types = cols.map((c) => tt.columns.get(c)!.type)
      const total = Number((await o.read(`SELECT count(*)::int AS n FROM ${q(table)}`)).rows[0].n)
      const perInsert = Math.max(1, Math.min(batchRows, Math.floor(60000 / Math.max(1, cols.length))))
      let moved = 0
      for (let offset = 0; offset < total; offset += perInsert) {
        const rows = (await o.read(`SELECT ${selectList} FROM ${q(table)} ORDER BY ${order} LIMIT ${perInsert} OFFSET ${offset}`)).rows
        if (!rows.length) break
        const params: unknown[] = []
        const tuples = rows.map((r) => `(${cols.map((c, i) => {
          const v = i < copied.length ? (deferred.has(c) ? null : r[c]) : o.fill!(table, c, r)
          params.push(v)
          return `$${params.length}::text::${castType(types[i])}`
        }).join(', ')})`)
        await o.write(`INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES ${tuples.join(', ')}`, params)
        moved += rows.length
      }
      report.tables.push({ table, source: total, moved })
      if (moved !== total) report.mismatches.push(`${table}: ${total} read, ${moved} moved`)
    }

    // Second pass: the links to rows that did not exist yet.
    for (const l of later) {
      if (!l.key.length) throw new Error(`${l.table} has no primary key to set ${l.column} by`)
      const rows = (await o.read(`SELECT ${l.key.map((k) => `${q(k)}::text AS ${q(k)}`).join(', ')}, ${q(l.column)}::text AS v FROM ${q(l.table)} WHERE ${q(l.column)} IS NOT NULL`)).rows
      for (const r of rows) {
        const params = [r.v, ...l.key.map((k) => r[k])]
        await o.write(`UPDATE ${q(l.table)} SET ${q(l.column)} = $1 WHERE ${l.key.map((k, i) => `${q(k)}::text = $${i + 2}`).join(' AND ')}`, params)
      }
    }

    for (const s of o.after ?? []) report.steps.push({ step: s.name, did: await s.run({ read: o.read, write: o.write }) })

    // The counts, read back from the new database inside the same transaction.
    for (const t of report.tables) {
      const n = Number((await o.write(`SELECT count(*)::int AS n FROM ${q(t.table)}`)).rows[0].n)
      if (n !== t.source && !report.mismatches.some((m) => m.startsWith(t.table + ':'))) report.mismatches.push(`${t.table}: ${t.source} in the old, ${n} in the new`)
    }
    if (report.mismatches.length) throw Object.assign(new Error(`The move did not match: ${report.mismatches.join('; ')}`), { report })
    await o.write(`COMMIT`)
    return report
  } catch (e) {
    await o.write(`ROLLBACK`).catch(() => {})
    throw e
  } finally {
    await o.read(`ROLLBACK`).catch(() => {})
  }
}

/** The cast for a column's information_schema type (arrays as their element type's array). */
function castType(t: string): string {
  if (t.startsWith('_')) return `${t.slice(1)}[]`
  return t
}
