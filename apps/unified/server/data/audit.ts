// Reading the audit log (the recording half is core/audit.ts). The CRM templates read it with raw SQL, so rows
// reached the screen as created_at / user_email with a zone-less time the browser read as local (the T58c five-hour
// shift). Here the query builder returns camelCase rows with real instants; the shared AuditLogPage reads either.
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { auditLog } from '../db/schema/index.ts'

export interface AuditQuery {
  companyId: string
  entity?: string
  entityId?: string
  action?: string
  userId?: string
  startDate?: string
  endDate?: string
  page: number
  limit: number
}

const date = (v?: string) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d }

export async function queryAudit(db: any, q: AuditQuery) {
  const conds = [eq(auditLog.companyId, q.companyId)]
  if (q.entity) conds.push(eq(auditLog.entity, q.entity))
  if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId))
  if (q.action) conds.push(eq(auditLog.action, q.action))
  if (q.userId) conds.push(eq(auditLog.userId, q.userId))
  const from = date(q.startDate), to = date(q.endDate)
  if (from) conds.push(gte(auditLog.createdAt, from))
  if (to) conds.push(lte(auditLog.createdAt, to))
  const where = and(...conds)
  const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(q.limit).offset((q.page - 1) * q.limit)
  const [{ total }] = await db.select({ total: count() }).from(auditLog).where(where)
  return { rows, total: Number(total) }
}

/**
 * What this company's log can be filtered by: the actions and record types in its own rows, most-used first, as
 * { value, count } — the shape the shared AuditLogPage reads. A filter built from the data can't offer an option that
 * matches nothing.
 */
export async function auditFilterOptions(db: any, companyId: string) {
  const rows: Array<{ action: string; entity: string; n: number }> = await db
    .select({ action: auditLog.action, entity: auditLog.entity, n: sql<number>`count(*)::int` })
    .from(auditLog).where(eq(auditLog.companyId, companyId)).groupBy(auditLog.action, auditLog.entity)
  const tally = (key: 'action' | 'entity') => {
    const counts = new Map<string, number>()
    for (const r of rows) if (r[key]) counts.set(r[key], (counts.get(r[key]) || 0) + Number(r.n || 0))
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, count: n }))
  }
  return { actions: tally('action'), entities: tally('entity') }
}
