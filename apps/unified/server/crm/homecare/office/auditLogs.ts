// /api/audit-logs — the clinical audit trail (audit_logs: who changed a client record, with the old and new data),
// its export and the compliance report. Moved from templates/crm-homecare/backend/src/routes/auditLogs.ts.
//
// The template's requireAdmin becomes care-compliance:read ("the clinical audit trail" is that area's). Every read is
// the signed-in person's company's.
//
// Also serves what templates/crm-homecare/backend/src/routes/audit.ts served at /api/audit (the same table, filtered by
// table name and person): /api/audit is the app's own audit log (modules/company.ts) and one path is one router, so
// that list is GET /api/audit-logs?tableName=&userId= here. Replies are { data, pagination } (RULEBOOK §3): the
// template's { data, pagination: { totalPages } } becomes `pages`, and /api/audit's { logs, total } is the same list.
import { Hono } from 'hono'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { auditLogs, user } from '../../../db/schema/index.ts'
import { fail, list, listAll } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'

const ROW = {
  id: auditLogs.id,
  userId: auditLogs.userId,
  action: auditLogs.action,
  tableName: auditLogs.tableName,
  recordId: auditLogs.recordId,
  oldData: auditLogs.oldData,
  newData: auditLogs.newData,
  ipAddress: auditLogs.ipAddress,
  reasonCode: auditLogs.reasonCode,
  timestamp: auditLogs.timestamp,
  userFirstName: user.firstName,
  userLastName: user.lastName,
}

/** A date filter as the screen sends it, or undefined; a value that is not a date is refused, never read as "no filter". */
const dateOf = (v: unknown): Date | null | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

export function createAuditLogRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-compliance:read')

  function filters(companyId: string, f: { startDate?: unknown; endDate?: unknown; userId?: unknown; tableName?: unknown }) {
    const start = dateOf(f.startDate), end = dateOf(f.endDate)
    if (start === null || end === null) return null
    const conditions: any[] = [eq(auditLogs.companyId, companyId)]
    if (start) conditions.push(gte(auditLogs.timestamp, start))
    if (end) conditions.push(lte(auditLogs.timestamp, end))
    if (f.userId) conditions.push(eq(auditLogs.userId, String(f.userId)))
    if (f.tableName) conditions.push(eq(auditLogs.tableName, String(f.tableName)))
    return and(...conditions)
  }

  // GET / — a page of the trail, newest first, filtered by dates, person and table.
  app.get('/', read, async (c) => {
    const where = filters(c.get('user').companyId, c.req.query())
    if (!where) return fail(c, 400, 'Dates must be valid dates')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50))
    const [rows, [{ total }]] = await Promise.all([
      d.db.select(ROW).from(auditLogs).leftJoin(user, eq(auditLogs.userId, user.id)).where(where)
        .orderBy(desc(auditLogs.timestamp)).limit(limit).offset((page - 1) * limit),
      d.db.select({ total: count() }).from(auditLogs).where(where),
    ])
    return list(c, rows, { page, limit, total: Number(total) })
  })

  // POST /export — the same query, every matching row.
  app.post('/export', read, async (c) => {
    const where = filters(c.get('user').companyId, await c.req.json().catch(() => ({})))
    if (!where) return fail(c, 400, 'Dates must be valid dates')
    const rows = await d.db.select(ROW).from(auditLogs).leftJoin(user, eq(auditLogs.userId, user.id)).where(where)
      .orderBy(desc(auditLogs.timestamp))
    return listAll(c, rows)
  })

  // POST /compliance-report — counts by action.
  app.post('/compliance-report', read, async (c) => {
    const b: any = await c.req.json().catch(() => ({}))
    const where = filters(c.get('user').companyId, { startDate: b?.startDate, endDate: b?.endDate })
    if (!where) return fail(c, 400, 'Dates must be valid dates')
    const rows = await d.db.select({ action: auditLogs.action, count: count() }).from(auditLogs).where(where)
      .groupBy(auditLogs.action).orderBy(desc(count()))
    return listAll(c, rows)
  })

  return app
}
