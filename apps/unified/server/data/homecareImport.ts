// CSV import (item 1, docs/parity/homecare-import.md): the lookups that find a row's existing twin, and the guarded delete
// that undoes a batch. Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

const lower = (s: string) => s.trim().toLowerCase()

/** Every client of the company, as the facts a duplicate is judged on. */
export async function existingClients(q: Q, companyId: string): Promise<Array<{ id: string; first: string; last: string; dob: string | null }>> {
  return camelRows(await q.execute(sql`
    SELECT id, lower(trim(first_name)) AS first, lower(trim(last_name)) AS last, to_char(date_of_birth, 'YYYY-MM-DD') AS dob
      FROM clients WHERE company_id = ${companyId}`)) as any
}

/** Every login of the company by email (any role: an email is one login), with who it is. */
export async function existingEmails(q: Q, companyId: string): Promise<Set<string>> {
  const rows = camelRows(await q.execute(sql`SELECT lower(trim(email)) AS email FROM "user" WHERE company_id = ${companyId} AND email IS NOT NULL`))
  return new Set(rows.map((r: any) => String(r.email)))
}

/** The company's caregivers, to match a schedule row's caregiver by email or by name. */
export async function caregiverDirectory(q: Q, companyId: string): Promise<Array<{ id: string; first: string; last: string; email: string; isActive: boolean }>> {
  return camelRows(await q.execute(sql`
    SELECT id, lower(trim(first_name)) AS first, lower(trim(last_name)) AS last, lower(trim(COALESCE(email, ''))) AS email, is_active
      FROM "user" WHERE company_id = ${companyId} AND role IN ('caregiver', 'field')`)) as any
}

/** Active recurring shifts that already exist, as caregiver|client|weekday|start|end keys (the table's own unique rule). */
export async function existingRecurringKeys(q: Q, companyId: string): Promise<Set<string>> {
  const rows = camelRows(await q.execute(sql`
    SELECT caregiver_id, client_id, day_of_week, to_char(start_time, 'HH24:MI') AS s, to_char(end_time, 'HH24:MI') AS e
      FROM schedules WHERE company_id = ${companyId} AND is_active = true AND schedule_type = 'recurring' AND day_of_week IS NOT NULL`))
  return new Set(rows.map((r: any) => `${r.caregiverId}|${r.clientId}|${r.dayOfWeek}|${r.s}|${r.e}`))
}

const SAFE_NAME = /^[a-z_][a-z0-9_]*$/

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
export async function firstUse(q: Q, column: 'client_id' | 'caregiver_id' | 'schedule_id' | 'user_id', id: string, ignore: readonly string[]): Promise<string | null> {
  for (const table of await tablesWithColumn(q, column)) {
    if (ignore.includes(table)) continue
    const hit = camelRows(await q.execute(sql`SELECT 1 AS one FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${id} LIMIT 1`))
    if (hit.length) return table
  }
  return null
}

/** Delete one row of a table by id and company (the undo of a record the import made). */
export async function deleteOwned(q: Q, table: 'clients' | 'user' | 'schedules', companyId: string, id: string): Promise<void> {
  await q.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE id = ${id} AND company_id = ${companyId}`)
}

/** Rows the import filled in around a client / caregiver, removed before the person themself. */
export async function deleteChildren(q: Q, table: string, column: string, id: string): Promise<void> {
  if (!SAFE_NAME.test(table) || !SAFE_NAME.test(column)) throw new Error('bad name')
  await q.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${id}`)
}

export { lower }
