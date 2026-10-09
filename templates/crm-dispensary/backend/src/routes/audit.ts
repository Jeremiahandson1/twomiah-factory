import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit, { dateConditions, searchCondition } from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Owners and admins only — audit:read, which admin's list carries and manager's does not. It carries
// everybody's sign-ins and two-factor changes. (Owner's decision, 2026-10-09; it was requireRole('manager').)
app.use('*', requirePermission('audit:read'))

// Filtered audit log
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  // ?entityType= is accepted as well as ?entity=. The screen sends `entity`, the audit rows carry
  // `entityType` in their own payload, and both spellings are in circulation — so asking with the
  // wrong one silently returned EVERYTHING. A filter that is ignored rather than refused looks
  // exactly like an answer, which is the worst way for a filter to fail. (T47 P21)
  const entity = c.req.query('entity') || c.req.query('entityType')
  const entityId = c.req.query('entityId')
  const action = c.req.query('action')
  const userId = c.req.query('userId')
  // dateFrom/dateTo are accepted alongside startDate/endDate for the same reason entityType is
  // accepted alongside entity, one line above: the screen sent dateFrom and dateTo, this read
  // startDate and endDate, and so narrowing the Audit Log to a single day returned the whole log —
  // an ignored filter reading as an answer, again. (T41)
  const startDate = c.req.query('startDate') || c.req.query('dateFrom')
  const endDate = c.req.query('endDate') || c.req.query('dateTo')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const result = await audit.query({
    companyId: currentUser.companyId,
    entity,
    entityId,
    action,
    userId,
    search,
    startDate,
    endDate,
    page,
    limit,
  })

  return c.json(result)
})

// What this company's log can be filtered by, read from its own rows. The screen builds its
// dropdowns from this instead of a hard-coded list, which is what had drifted. See
// services/audit.ts filterOptions for the full story. (T41)
app.get('/filters', async (c) => {
  const currentUser = c.get('user') as any
  return c.json(await audit.filterOptions(currentUser.companyId))
})

// CSV export of audit log
app.get('/export', async (c) => {
  const currentUser = c.get('user') as any
  // Both spellings here too — an export that quietly ignores the filter is a spreadsheet of
  // everything, handed over as though it were the thing that was asked for. (T47 P21)
  const entity = c.req.query('entity') || c.req.query('entityType')
  const action = c.req.query('action')
  const userId = c.req.query('userId')
  // Same two aliases, and the same search, as the list above — by that comment's own argument the
  // export is the worse place to drop a filter, because the spreadsheet leaves the building. (T41)
  const startDate = c.req.query('startDate') || c.req.query('dateFrom')
  const endDate = c.req.query('endDate') || c.req.query('dateTo')
  const search = c.req.query('search')

  const conditions = [sql`company_id = ${currentUser.companyId}`]
  if (entity)    conditions.push(sql`entity = ${entity}`)
  if (action)    conditions.push(sql`action = ${action}`)
  if (userId)    conditions.push(sql`user_id = ${userId}`)
  // The same two helpers the list uses, so the CSV contains exactly the rows that were on screen.
  conditions.push(...dateConditions(startDate, endDate))
  const searchCond = searchCondition(search)
  if (searchCond) conditions.push(searchCond)

  const where = conditions.reduce((acc, cond, i) => i === 0 ? cond : sql`${acc} AND ${cond}`)

  const result = await db.execute(sql`
    SELECT id, action, entity, entity_id, entity_name, user_email, ip_address,
           changes::text as changes, metadata::text as metadata, created_at
    FROM audit_log
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT 10000
  `)

  const rows = (result as any).rows || result

  // Build CSV
  const headers = ['ID', 'Action', 'Entity', 'Entity ID', 'Entity Name', 'User Email', 'IP Address', 'Changes', 'Metadata', 'Created At']
  const csvRows = [headers.join(',')]

  for (const row of rows) {
    csvRows.push([
      row.id,
      row.action,
      row.entity,
      row.entity_id || '',
      `"${(row.entity_name || '').replace(/"/g, '""')}"`,
      row.user_email || '',
      row.ip_address || '',
      `"${(row.changes || '').replace(/"/g, '""')}"`,
      `"${(row.metadata || '').replace(/"/g, '""')}"`,
      row.created_at,
    ].join(','))
  }

  const csv = csvRows.join('\n')

  // Log the export
  audit.log({
    action: audit.ACTIONS.EXPORT,
    entity: 'audit_log',
    metadata: { rowCount: rows.length, filters: { entity, action, userId, search, startDate, endDate } },
    req: c,
  })

  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
  return c.body(csv)
})

export default app
