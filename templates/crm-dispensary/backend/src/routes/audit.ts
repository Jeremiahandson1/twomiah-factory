import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// All audit endpoints require manager+ (owner/manager)
app.use('*', requireRole('manager'))

// Filtered audit log
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const entity = c.req.query('entity')
  const entityId = c.req.query('entityId')
  const action = c.req.query('action')
  const userId = c.req.query('userId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const result = await audit.query({
    companyId: currentUser.companyId,
    entity,
    entityId,
    action,
    userId,
    startDate,
    endDate,
    page,
    limit,
  })

  return c.json(result)
})

// CSV export of audit log
app.get('/export', async (c) => {
  const currentUser = c.get('user') as any
  const entity = c.req.query('entity')
  const action = c.req.query('action')
  const userId = c.req.query('userId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = [sql`company_id = ${currentUser.companyId}`]
  if (entity)    conditions.push(sql`entity = ${entity}`)
  if (action)    conditions.push(sql`action = ${action}`)
  if (userId)    conditions.push(sql`user_id = ${userId}`)
  if (startDate) conditions.push(sql`created_at >= ${new Date(startDate)}`)
  if (endDate)   conditions.push(sql`created_at <= ${new Date(endDate)}`)

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
    metadata: { rowCount: rows.length, filters: { entity, action, userId, startDate, endDate } },
    req: c.req,
  })

  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
  return c.body(csv)
})

export default app
