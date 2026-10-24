// What a login still holds, so deleting it never silently takes work off a person (live re-test 2026-10-23: deleting the
// landscaper's "Test Crew" login and adding it again emptied JOB-00001's Assigned To through job.assigned_to_id's
// ON DELETE SET NULL, and left the contractor's $165 commission pointing at nobody — "Former team member").
//
// Every column the database itself says points at a login (each foreign key to "user", whatever its ON DELETE), and the
// person columns that carry a login id without a foreign key. Read inside the delete's transaction, the user row locked:
// a row that references a login takes a key-share lock on it, so nothing can start pointing at it between this count
// and the delete.
import { sql } from 'drizzle-orm'
import { rowsOf } from '@twomiah/tenant-backend'

/** Person columns with no foreign key to "user" (a login id all the same). Missing tables are skipped. */
export const UNLINKED_PERSON_COLUMNS: Array<[table: string, column: string]> = [
  ['commission', 'user_id'],
  ['location', 'manager_user_id'],
  ['expense', 'repaid_by_id'],
  ['schedules', 'caregiver_id'],
  ['evv_visits', 'caregiver_id'],
  ['invoice_line_items', 'caregiver_id'],
  ['claims', 'caregiver_id'],
]

const WORDS: Record<string, [string, string]> = {
  job: ['job', 'jobs'], commission: ['commission', 'commissions'], commission_plan: ['commission plan', 'commission plans'],
  task: ['task', 'tasks'], schedules: ['shift', 'shifts'], time_entry: ['time entry', 'time entries'],
}
const say = (table: string, n: number) => {
  const w = WORDS[table] || [`${table.replace(/_/g, ' ')} record`, `${table.replace(/_/g, ' ')} records`]
  return `${n} ${n === 1 ? w[0] : w[1]}`
}
const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"'

/** e.g. ['1 job', '1 commission'] — empty when nothing points at this login. Run it on the delete's transaction. */
export async function userHolds(tx: any, userId: string): Promise<string[]> {
  const fks = rowsOf(await tx.execute(sql`
    SELECT cl.relname AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = to_regclass('"user"') AND c.conrelid <> c.confrelid
  `)) as Array<{ tbl: string; col: string }>
  const present = new Set((rowsOf(await tx.execute(sql`SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = to_regnamespace(current_schema())`)) as Array<{ relname: string }>).map((r) => r.relname))
  const pairs = [...fks.map((f) => [f.tbl, f.col] as [string, string]), ...UNLINKED_PERSON_COLUMNS.filter(([tb]) => present.has(tb))]
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const [tbl, col] of pairs) {
    if (seen.has(`${tbl}.${col}`)) continue
    seen.add(`${tbl}.${col}`)
    const [row] = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(ident(tbl))} WHERE ${sql.raw(ident(col))} = ${userId}`)) as Array<{ n: number }>
    if (row?.n) counts.set(tbl, (counts.get(tbl) || 0) + Number(row.n))
  }
  // A plan that names its people (commission_plan.user_ids, a json list).
  if (present.has('commission_plan')) {
    const [row] = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM commission_plan WHERE user_ids::jsonb ? ${userId}`)) as Array<{ n: number }>
    if (row?.n) counts.set('commission_plan', (counts.get('commission_plan') || 0) + Number(row.n))
  }
  return [...counts.entries()].map(([tbl, n]) => say(tbl, n))
}
