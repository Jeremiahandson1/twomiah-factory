import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { auditLogs, users } from '../../db/schema.ts'
import { eq, and, desc, gte, lte, count } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET / — list with pagination and filters
app.get('/', async (c) => {
  try {
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    const userId = c.req.query('userId')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = (page - 1) * limit

    const conditions: any[] = []
    if (startDate) conditions.push(gte(auditLogs.timestamp, new Date(startDate)))
    if (endDate) conditions.push(lte(auditLogs.timestamp, new Date(endDate)))
    if (userId) conditions.push(eq(auditLogs.userId, userId))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        action: auditLogs.action,
        tableName: auditLogs.tableName,
        recordId: auditLogs.recordId,
        oldData: auditLogs.oldData,
        newData: auditLogs.newData,
        ipAddress: auditLogs.ipAddress,
        timestamp: auditLogs.timestamp,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset)

    const [totalResult] = await db
      .select({ total: count() })
      .from(auditLogs)
      .where(whereClause)

    return c.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit),
      },
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST /export — same query but return all results without pagination
app.post('/export', async (c) => {
  try {
    const body = await c.req.json()
    const { startDate, endDate, userId } = body

    const conditions: any[] = []
    if (startDate) conditions.push(gte(auditLogs.timestamp, new Date(startDate)))
    if (endDate) conditions.push(lte(auditLogs.timestamp, new Date(endDate)))
    if (userId) conditions.push(eq(auditLogs.userId, userId))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        action: auditLogs.action,
        tableName: auditLogs.tableName,
        recordId: auditLogs.recordId,
        oldData: auditLogs.oldData,
        newData: auditLogs.newData,
        ipAddress: auditLogs.ipAddress,
        timestamp: auditLogs.timestamp,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.timestamp))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST /compliance-report — aggregate counts by action type
app.post('/compliance-report', async (c) => {
  try {
    const body = await c.req.json()
    const { startDate, endDate } = body

    const conditions: any[] = []
    if (startDate) conditions.push(gte(auditLogs.timestamp, new Date(startDate)))
    if (endDate) conditions.push(lte(auditLogs.timestamp, new Date(endDate)))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select({
        action: auditLogs.action,
        count: count(),
      })
      .from(auditLogs)
      .where(whereClause)
      .groupBy(auditLogs.action)
      .orderBy(desc(count()))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
