import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntries, users, gustoSyncLog, expenses } from '../../db/schema.ts'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// GET payroll summary for a pay period
app.get('/summary', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  const entries = await db.select({
    entry: timeEntries,
    caregiverId: users.id,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
    defaultPayRate: users.defaultPayRate,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(
      gte(timeEntries.startTime, new Date(startDate)),
      lte(timeEntries.startTime, new Date(endDate)),
      eq(timeEntries.isComplete, true),
    ))

  // Group by caregiver
  const byCaregiver: Record<string, any> = {}
  entries.forEach(e => {
    const id = e.entry.caregiverId
    if (!byCaregiver[id]) {
      byCaregiver[id] = {
        caregiver: {
          id: e.caregiverId,
          firstName: e.caregiverFirstName,
          lastName: e.caregiverLastName,
          defaultPayRate: e.defaultPayRate,
        },
        totalMinutes: 0,
        totalPay: 0,
        entryCount: 0,
      }
    }
    byCaregiver[id].totalMinutes += e.entry.billableMinutes || e.entry.durationMinutes || 0
    byCaregiver[id].entryCount++
  })

  Object.values(byCaregiver).forEach((c: any) => {
    const hours = c.totalMinutes / 60
    c.totalHours = Number(hours.toFixed(2))
    c.totalPay = Number((hours * Number(c.caregiver.defaultPayRate || 15)).toFixed(2))
  })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, caregivers: Object.values(byCaregiver) })
})

// GET /payroll/gusto/sync-log
app.get('/gusto/sync-log', async (c) => {
  const logs = await db.select().from(gustoSyncLog).orderBy(desc(gustoSyncLog.createdAt)).limit(20)
  return c.json(logs)
})

// POST /payroll/gusto/sync
app.post('/gusto/sync', async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  const [log] = await db.insert(gustoSyncLog).values({
    syncType: 'export',
    status: 'success',
    payPeriodStart: body.startDate || undefined,
    payPeriodEnd: body.endDate || undefined,
    recordsExported: body.recordCount || 0,
    createdById: user.userId,
  }).returning()

  return c.json(log)
})

// GET /payroll/expenses
app.get('/expenses', async (c) => {
  const status = c.req.query('status')

  const conditions = status ? eq(expenses.status, status) : undefined

  const rows = await db.select({
    expense: expenses,
    userFirstName: users.firstName,
    userLastName: users.lastName,
  })
    .from(expenses)
    .leftJoin(users, eq(expenses.userId, users.id))
    .where(conditions)
    .orderBy(desc(expenses.createdAt))

  const result = rows.map(r => ({
    ...r.expense,
    user: { firstName: r.userFirstName, lastName: r.userLastName },
  }))

  return c.json(result)
})

app.post('/expenses', async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  const [expense] = await db.insert(expenses).values({
    ...body,
    userId: user.role === 'caregiver' ? user.userId : body.userId,
  }).returning()

  return c.json(expense, 201)
})

app.patch('/expenses/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [expense] = await db.update(expenses)
    .set({ status: body.status, updatedAt: new Date() })
    .where(eq(expenses.id, id))
    .returning()

  return c.json(expense)
})

export default app
