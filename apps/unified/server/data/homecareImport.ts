// CSV import (item 1, docs/parity/homecare-import.md): the lookups that find a row's existing twin, and the guarded delete
// that undoes a batch. Raw SQL lives here (RULEBOOK). Rows 8–10 (10/31): the child kinds' duplicate keys, the parent
// directories (clients with their zip, payers), the old system's reference codes, a record's columns before an update
// and the update itself, and the record counts the assisted migration compares.
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

const lower = (s: string) => s.trim().toLowerCase()
const SAFE_NAME = /^[a-z_][a-z0-9_]*$/
const snake = (camel: string) => camel.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const ident = (name: string) => { if (!SAFE_NAME.test(name)) throw new Error('bad name'); return sql.identifier(name) }

/** Every client of the company, as the facts a duplicate is judged on (and the zip, for name + postcode matching). */
export async function existingClients(q: Q, companyId: string): Promise<Array<{ id: string; first: string; last: string; dob: string | null; zip: string | null }>> {
  return camelRows(await q.execute(sql`
    SELECT id, lower(trim(first_name)) AS first, lower(trim(last_name)) AS last, to_char(date_of_birth, 'YYYY-MM-DD') AS dob, zip
      FROM clients WHERE company_id = ${companyId}`)) as any
}

/** Every login of the company by email (any role: an email is one login), with who it is. */
export async function existingEmails(q: Q, companyId: string): Promise<Set<string>> {
  const rows = camelRows(await q.execute(sql`SELECT lower(trim(email)) AS email FROM "user" WHERE company_id = ${companyId} AND email IS NOT NULL`))
  return new Set(rows.map((r: any) => String(r.email)))
}

/** The company's caregivers, to match a schedule row's caregiver by email or by name. */
export async function caregiverDirectory(q: Q, companyId: string): Promise<Array<{ id: string; first: string; last: string; email: string; isActive: boolean; zip: string | null }>> {
  return camelRows(await q.execute(sql`
    SELECT id, lower(trim(first_name)) AS first, lower(trim(last_name)) AS last, lower(trim(COALESCE(email, ''))) AS email, is_active, zip
      FROM "user" WHERE company_id = ${companyId} AND role IN ('caregiver', 'field')`)) as any
}

/** The company's payers and referral sources by name (a child row names its payer by name, exactly). */
export async function payerDirectory(q: Q, companyId: string): Promise<Array<{ id: string; name: string; isActivePayer: boolean }>> {
  return camelRows(await q.execute(sql`SELECT id, lower(trim(name)) AS name, is_active_payer FROM referral_sources WHERE company_id = ${companyId}`)) as any
}

/** The old system's reference codes already kept for an entity: code → our record id. */
export async function externalIdMap(q: Q, companyId: string, entity: string): Promise<Map<string, string>> {
  const rows = camelRows(await q.execute(sql`SELECT lower(trim(external_id)) AS ext, record_id FROM import_external_id WHERE company_id = ${companyId} AND entity = ${entity}`))
  return new Map(rows.map((r: any) => [String(r.ext), String(r.recordId)]))
}

/** Active recurring shifts that already exist, as caregiver|client|weekday|start|end keys (the table's own unique rule). */
export async function existingRecurringKeys(q: Q, companyId: string): Promise<Set<string>> {
  const rows = camelRows(await q.execute(sql`
    SELECT caregiver_id, client_id, day_of_week, to_char(start_time, 'HH24:MI') AS s, to_char(end_time, 'HH24:MI') AS e
      FROM schedules WHERE company_id = ${companyId} AND is_active = true AND schedule_type = 'recurring' AND day_of_week IS NOT NULL`))
  return new Set(rows.map((r: any) => `${r.caregiverId}|${r.clientId}|${r.dayOfWeek}|${r.s}|${r.e}`))
}

/**
 * A child kind's existing rows as duplicate keys (row 8): each key column as text, lower-cased, joined with '|' — the same
 * shape importKinds.ts joinKey builds from a file row. A column written `created_at:day` is read as its calendar day.
 * Returns key → record id (the first id when two rows share a key).
 */
export async function existingChildKeys(q: Q, companyId: string, table: string, keyColumns: string[]): Promise<Map<string, string>> {
  const parts = keyColumns.map((c) => {
    const [name, how] = c.split(':')
    const col = ident(snake(name))
    return how === 'day' ? sql`COALESCE(to_char(${col}, 'YYYY-MM-DD'), '')` : sql`COALESCE(lower(trim(${col}::text)), '')`
  })
  const expr = sql.join(parts, sql`|| '|' ||`)
  const rows = camelRows(await q.execute(sql`SELECT id, (${expr}) AS k FROM ${ident(table)} WHERE company_id = ${companyId}`))
  const out = new Map<string, string>()
  for (const r of rows) if (!out.has(String(r.k))) out.set(String(r.k), String(r.id))
  return out
}

/** Tables (other than `ignore`) that have a column of this name — straight from the catalogue, so a table added later is counted too. */
async function tablesWithColumn(q: Q, column: string): Promise<string[]> {
  const rows = camelRows(await q.execute(sql`
    SELECT DISTINCT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = current_schema() AND c.column_name = ${column}`))
  return rows.map((r: any) => String(r.tableName)).filter((n) => SAFE_NAME.test(n))
}

/**
 * Has anything been recorded against this client / caregiver / schedule since it was imported? Looks in every table that
 * points at it by `column` (client_id, caregiver_id, schedule_id) except the ones the import itself fills in. The name of
 * the first table found, or null. An undo never deletes a record that has history — deleting it would cascade into
 * visits, invoices and pay.
 */
export async function firstUse(q: Q, column: string, id: string, ignore: readonly string[]): Promise<string | null> {
  if (!SAFE_NAME.test(column)) throw new Error('bad name')
  for (const table of await tablesWithColumn(q, column)) {
    if (ignore.includes(table)) continue
    const hit = camelRows(await q.execute(sql`SELECT 1 AS one FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${id} LIMIT 1`))
    if (hit.length) return table
  }
  return null
}

/** Delete one row of a table by id and company (the undo of a record the import made). */
export async function deleteOwned(q: Q, table: string, companyId: string, id: string): Promise<void> {
  await q.execute(sql`DELETE FROM ${ident(table)} WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Rows the import filled in around a client / caregiver, removed before the person themself. */
export async function deleteChildren(q: Q, table: string, column: string, id: string): Promise<void> {
  await q.execute(sql`DELETE FROM ${ident(table)} WHERE ${ident(column)} = ${id}`)
}

/** One record's columns (camelCase) as they are now — kept before a re-import overwrites them, so undo can put them back. */
export async function recordColumns(q: Q, table: string, companyId: string, id: string, columns: string[]): Promise<Record<string, any> | null> {
  if (!columns.length) return {}
  const list = sql.join(columns.map((c) => ident(snake(c))), sql`, `)
  const [row] = camelRows(await q.execute(sql`SELECT ${list} FROM ${ident(table)} WHERE id = ${id} AND company_id = ${companyId} LIMIT 1`))
  return row ? (row as Record<string, any>) : null
}

/** Set some columns (camelCase keys) of one record of the company. */
export async function setRecordColumns(q: Q, table: string, companyId: string, id: string, values: Record<string, any>): Promise<void> {
  const keys = Object.keys(values)
  if (!keys.length) return
  const sets = sql.join(keys.map((k) => sql`${ident(snake(k))} = ${values[k] === undefined ? null : values[k]}`), sql`, `)
  await q.execute(sql`UPDATE ${ident(table)} SET ${sets} WHERE id = ${id} AND company_id = ${companyId}`)
}

/** How many rows of a table belong to the company (the assisted migration's old-vs-new comparison, row 10). */
export async function countOwned(q: Q, table: string, companyId: string, where?: { column: string; value: string }): Promise<number> {
  const extra = where ? sql` AND ${ident(where.column)} = ${where.value}` : sql``
  const [row] = camelRows(await q.execute(sql`SELECT count(*)::int AS n FROM ${ident(table)} WHERE company_id = ${companyId}${extra}`))
  return Number(row?.n ?? 0)
}

export { lower }
