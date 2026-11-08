// Home care's Audit Logs page (crm/homecare/office/auditLogs.ts): its own clinical trail (audit_logs — care plans, tasks,
// medicines, documents) and the app's trail (audit_log — every other write: clients, users, payers, invoices, payroll,
// expenses, settings, sign-ins; the write floor records each one, app.ts) read as ONE list, newest first.
// Home care live test 11/08: the page read only audit_logs, so clients, users, payers, invoices, payroll approvals, expenses
// and settings never showed. A request written to audit_logs is marked recorded (core/careAudit.ts), so the floor adds no copy.
import { sql } from 'drizzle-orm'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** `withApp`: the app's trail too — only for a seat with audit:read (it is the app's own audit log, read there behind that). */
export interface TrailFilter { start?: Date; end?: Date; userId?: string; tableName?: string; withApp?: boolean }

function trail(companyId: string, f: TrailFilter) {
  const care = sql`
    SELECT a.id, a.user_id, a.action, a.table_name, a.record_id, a.old_data, a.new_data, a.ip_address, a.reason_code, a.timestamp
      FROM audit_logs a
     WHERE a.company_id = ${companyId}
       ${f.start ? sql`AND a.timestamp >= ${f.start}` : sql``} ${f.end ? sql`AND a.timestamp <= ${f.end}` : sql``}
       ${f.userId ? sql`AND a.user_id = ${f.userId}` : sql``} ${f.tableName ? sql`AND a.table_name = ${f.tableName}` : sql``}`
  // The app's trail in the same shape: the entity is the "table", what changed (or the floor's sentence) is the new data.
  const app = sql`
    SELECT l.id, l.user_id, l.action, l.entity AS table_name, l.entity_id AS record_id, NULL::json AS old_data,
           COALESCE(l.changes, json_build_object('record', l.entity_name, 'details', l.metadata)) AS new_data,
           l.ip_address, NULL::text AS reason_code, l.created_at AS timestamp
      FROM audit_log l
     WHERE l.company_id = ${companyId}
       ${f.start ? sql`AND l.created_at >= ${f.start}` : sql``} ${f.end ? sql`AND l.created_at <= ${f.end}` : sql``}
       ${f.userId ? sql`AND l.user_id = ${f.userId}` : sql``} ${f.tableName ? sql`AND l.entity = ${f.tableName}` : sql``}`
  return f.withApp ? sql`(${care}) UNION ALL (${app})` : care
}

/** A page of the merged trail (or every row: limit null), with each person's name, newest first. */
export async function auditTrailPage(q: Q, companyId: string, f: TrailFilter, page: { limit: number | null; offset: number }) {
  const rows = camelRows(await q.execute(sql`
    SELECT t.*, u.first_name AS user_first_name, u.last_name AS user_last_name
      FROM (${trail(companyId, f)}) t LEFT JOIN "user" u ON u.id = t.user_id
     ORDER BY t.timestamp DESC, t.id
     ${page.limit === null ? sql`` : sql`LIMIT ${page.limit} OFFSET ${page.offset}`}`))
  const total = page.limit === null ? rows.length : Number(rowsOf(await q.execute(sql`SELECT COUNT(*)::int AS n FROM (${trail(companyId, f)}) t`))[0]?.n ?? 0)
  return { rows, total }
}

/** Counts by action over the merged trail. */
export async function auditTrailCounts(q: Q, companyId: string, f: TrailFilter) {
  return camelRows(await q.execute(sql`
    SELECT t.action, COUNT(*)::int AS count FROM (${trail(companyId, f)}) t GROUP BY t.action ORDER BY COUNT(*) DESC`))
}
