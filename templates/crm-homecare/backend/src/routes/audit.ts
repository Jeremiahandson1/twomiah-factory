import { Hono } from 'hono'
import { eq, and, desc, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { auditLogs } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /
app.get('/', async (c) => {
  const tableName = c.req.query('tableName')
  const userId = c.req.query('userId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '100')
  const offset = (page - 1) * limit

  const conditions = []
  if (tableName) conditions.push(eq(auditLogs.tableName, tableName))
  if (userId) conditions.push(eq(auditLogs.userId, userId))

  const whereClause = conditions.length ? and(...conditions) : undefined

  const [logs, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(auditLogs)
      .where(whereClause),
  ])

  return c.json({ logs, total })
})

export default app
