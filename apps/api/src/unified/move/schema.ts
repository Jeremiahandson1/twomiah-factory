// The data move (a live template tenant's database → its unified database), part 1: the two layouts, read from the
// databases themselves (information_schema), and what moving one into the other means table by table. Nothing here
// writes or reads a customer's rows.
//
// `query` runs one SQL statement and answers its rows — pg's pool.query, or PGlite's query in tests.
export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>

export interface Column { name: string; type: string; nullable: boolean; hasDefault: boolean }
export interface ForeignKey { column: string; refTable: string; refColumn: string }
export interface Table { name: string; columns: Map<string, Column>; primaryKey: string[]; foreignKeys: ForeignKey[] }
export type Layout = Map<string, Table>

/** Every table in the public schema, its columns, primary key and foreign keys. */
export async function readLayout(query: Query): Promise<Layout> {
  const layout: Layout = new Map()
  const cols = await query(`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, numeric_precision, numeric_scale, character_maximum_length
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
  for (const c of cols.rows) {
    const t = layout.get(c.table_name) ?? { name: c.table_name, columns: new Map(), primaryKey: [], foreignKeys: [] }
    t.columns.set(c.column_name, {
      name: c.column_name,
      // With its size where it has one — numeric(12,2), character varying(80) — so a narrowing shows as a change.
      type: c.data_type === 'USER-DEFINED' || c.data_type === 'ARRAY' ? c.udt_name
        : c.data_type === 'numeric' && c.numeric_precision != null ? `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`
        : c.character_maximum_length != null ? `${c.data_type}(${c.character_maximum_length})` : c.data_type,
      nullable: c.is_nullable === 'YES',
      hasDefault: c.column_default != null,
    })
    layout.set(c.table_name, t)
  }
  const keys = await query(`SELECT tc.table_name, tc.constraint_type, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema AND tc.constraint_type = 'FOREIGN KEY'
    WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
    ORDER BY tc.table_name, kcu.ordinal_position`)
  for (const k of keys.rows) {
    const t = layout.get(k.table_name)
    if (!t) continue
    if (k.constraint_type === 'PRIMARY KEY') { if (!t.primaryKey.includes(k.column_name)) t.primaryKey.push(k.column_name) }
    else if (k.ref_table) t.foreignKeys.push({ column: k.column_name, refTable: k.ref_table, refColumn: k.ref_column })
  }
  for (const name of ['__drizzle_migrations']) layout.delete(name)
  return layout
}

/** What happens to one column. */
export type ColumnPlan =
  | { column: string; how: 'copy' }
  | { column: string; how: 'convert'; from: string; to: string }
  | { column: string; how: 'left behind'; type: string }

export interface TablePlan {
  table: string
  columns: ColumnPlan[]
  /** In the unified table, not filled by the copy, NOT NULL and no default: the move must supply it (a data step). */
  needs: string[]
}

export interface MovePlan {
  tables: TablePlan[]
  /** Tables only the template has: their rows go nowhere unless a data step takes them. */
  onlyInSource: string[]
  /** Tables only the unified app has: empty after the copy unless a data step fills them. */
  onlyInTarget: string[]
  /** The order to fill the tables so every row's parent is there first (self-references are filled after). */
  order: string[]
}

/** Types that move as they are, though the names differ (the unified app's json/timestamp rule, RULEBOOK §2). */
const SAME = new Set(['jsonb>json', 'timestamp with time zone>timestamp without time zone', 'character varying>text', 'integer>bigint', 'smallint>integer', 'real>double precision'])

export function planMove(source: Layout, target: Layout): MovePlan {
  const tables: TablePlan[] = []
  for (const [name, tt] of target) {
    const st = source.get(name)
    if (!st) continue
    const columns: ColumnPlan[] = []
    for (const [col, sc] of st.columns) {
      const tc = tt.columns.get(col)
      if (!tc) { columns.push({ column: col, how: 'left behind', type: sc.type }); continue }
      if (sc.type === tc.type) columns.push({ column: col, how: 'copy' })
      else columns.push({ column: col, how: 'convert', from: sc.type, to: tc.type })
    }
    const needs = [...tt.columns.values()].filter((c) => !st.columns.has(c.name) && !c.nullable && !c.hasDefault).map((c) => c.name)
    tables.push({ table: name, columns, needs })
  }
  const onlyInSource = [...source.keys()].filter((n) => !target.has(n)).sort()
  const onlyInTarget = [...target.keys()].filter((n) => !source.has(n)).sort()
  return { tables: tables.sort((a, b) => a.table.localeCompare(b.table)), onlyInSource, onlyInTarget, order: fillOrder(target, new Set(tables.map((t) => t.table))) }
}

/** Parents before children, by the unified layout's foreign keys; a cycle's tables keep their relative order. */
export function fillOrder(target: Layout, only: Set<string>): string[] {
  const out: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (n: string) => {
    if (state.get(n) === 'done' || state.get(n) === 'visiting') return
    state.set(n, 'visiting')
    for (const fk of target.get(n)?.foreignKeys ?? []) if (fk.refTable !== n && only.has(fk.refTable)) visit(fk.refTable)
    state.set(n, 'done')
    out.push(n)
  }
  for (const n of [...only].sort()) visit(n)
  return out
}

/** A conversion the copy knows how to make without losing anything: a renamed type, a wider number or text. */
export function isSafeConversion(from: string, to: string): boolean {
  if (SAME.has(`${from}>${to}`)) return true
  const n = (t: string) => /^numeric(?:\((\d+),(\d+)\))?$/.exec(t)
  const a = n(from), b = n(to)
  // numeric(p,s) into numeric(p2,s2): no digit lost when neither the integer part nor the scale shrinks; bare numeric holds anything.
  if (a && b) return !b[1] || (!!a[1] && +b[2] >= +a[2] && +b[1] - +b[2] >= +a[1] - +a[2])
  const len = (t: string) => /^(?:character varying|character)\((\d+)\)$/.exec(t)
  if (len(from) && (to === 'text' || (len(to) && +len(to)![1] >= +len(from)![1]))) return true
  return false
}
