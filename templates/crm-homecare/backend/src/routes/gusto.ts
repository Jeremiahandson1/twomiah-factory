import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { gustoSyncLog, gustoEmployeeMap, users, timeEntries } from '../../db/schema.ts'
import { eq, and, gte, lte, sql, count, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/gusto/config
app.get('/config', async (c) => {
  const [mapCount] = await db.select({ value: count() }).from(gustoEmployeeMap)
  return c.json({
    enabled: !!process.env.ENABLE_GUSTO,
    connected: mapCount.value > 0,
  })
})

// GET /api/gusto/preview
app.get('/preview', async (c) => {
  const employees = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId,
      gustoUuid: gustoEmployeeMap.gustoUuid,
      isSynced: gustoEmployeeMap.isSynced,
      lastSyncedAt: gustoEmployeeMap.lastSyncedAt,
    })
    .from(users)
    .leftJoin(gustoEmployeeMap, eq(users.id, gustoEmployeeMap.userId))
    .where(eq(users.role, 'caregiver'))

  return c.json({ employees, total: employees.length })
})

// POST /api/gusto/export-csv
app.post('/export-csv', async (c) => {
  const { payPeriodStart, payPeriodEnd } = await c.req.json()
  if (!payPeriodStart || !payPeriodEnd) {
    return c.json({ error: 'payPeriodStart and payPeriodEnd are required' }, 400)
  }

  const rows = await db
    .select({
      caregiverId: timeEntries.caregiverId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      totalMinutes: sql<number>`sum(${timeEntries.durationMinutes})::int`,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(
      and(
        gte(timeEntries.startTime, new Date(payPeriodStart)),
        lte(timeEntries.startTime, new Date(payPeriodEnd)),
        eq(timeEntries.isComplete, true),
      )
    )
    .groupBy(timeEntries.caregiverId, users.firstName, users.lastName, users.email)

  const header = 'Employee ID,First Name,Last Name,Email,Total Hours\n'
  const csvRows = rows.map((r) => {
    const hours = ((r.totalMinutes || 0) / 60).toFixed(2)
    return `${r.caregiverId},${r.firstName},${r.lastName},${r.email},${hours}`
  })
  const csv = header + csvRows.join('\n')

  return c.json({ csv, rows: rows.length })
})

// POST /api/gusto/export
app.post('/export', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  const [log] = await db
    .insert(gustoSyncLog)
    .values({
      syncType: body.syncType || 'manual',
      status: 'completed',
      payPeriodStart: body.payPeriodStart,
      payPeriodEnd: body.payPeriodEnd,
      recordsExported: 0,
      createdById: user.userId,
    })
    .returning()

  return c.json({ success: true, syncLog: log })
})

export default app
