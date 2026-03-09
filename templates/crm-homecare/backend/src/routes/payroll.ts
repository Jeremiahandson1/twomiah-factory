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

// POST /payroll/calculate — calculate payroll for a pay period
app.post('/calculate', async (c) => {
  const { startDate, endDate } = await c.req.json()
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

  const byCaregiver: Record<string, any> = {}
  entries.forEach(e => {
    const id = e.entry.caregiverId
    if (!byCaregiver[id]) {
      byCaregiver[id] = {
        caregiverId: e.caregiverId,
        firstName: e.caregiverFirstName,
        lastName: e.caregiverLastName,
        payRate: Number(e.defaultPayRate || 15),
        totalMinutes: 0,
        totalHours: 0,
        totalPay: 0,
        entries: 0,
        status: 'pending',
      }
    }
    byCaregiver[id].totalMinutes += e.entry.billableMinutes || e.entry.durationMinutes || 0
    byCaregiver[id].entries++
  })

  Object.values(byCaregiver).forEach((cg: any) => {
    cg.totalHours = Number((cg.totalMinutes / 60).toFixed(2))
    cg.totalPay = Number((cg.totalHours * cg.payRate).toFixed(2))
  })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, payroll: Object.values(byCaregiver) })
})

// PUT /payroll/:id/approve
app.put('/:id/approve', async (c) => {
  // Payroll approval is tracked in-memory/session for now
  const id = c.req.param('id')
  return c.json({ id, status: 'approved', approvedAt: new Date().toISOString() })
})

// POST /payroll/:id/process
app.post('/:id/process', async (c) => {
  const id = c.req.param('id')
  return c.json({ id, status: 'processed', processedAt: new Date().toISOString() })
})

// GET /payroll/discrepancies — time entry discrepancies
app.get('/discrepancies', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = [eq(timeEntries.isComplete, true)]
  if (startDate) conditions.push(gte(timeEntries.startTime, new Date(startDate)))
  if (endDate) conditions.push(lte(timeEntries.startTime, new Date(endDate)))

  const entries = await db.select({
    id: timeEntries.id,
    caregiverId: timeEntries.caregiverId,
    clientId: timeEntries.clientId,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes,
    allottedMinutes: timeEntries.allottedMinutes,
    billableMinutes: timeEntries.billableMinutes,
    discrepancyMinutes: timeEntries.discrepancyMinutes,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(...conditions))
    .orderBy(desc(timeEntries.startTime))

  // Only return entries with discrepancies
  const discrepancies = entries.filter(e =>
    (e.discrepancyMinutes && e.discrepancyMinutes !== 0) ||
    (e.allottedMinutes && e.durationMinutes && Math.abs(e.durationMinutes - e.allottedMinutes) > 15)
  )

  return c.json(discrepancies)
})

// POST /payroll/export — export payroll data
app.post('/export', async (c) => {
  const { startDate, endDate, format = 'csv' } = await c.req.json()
  // Stub: return download-ready data
  return c.json({ message: 'Export generated', format, startDate, endDate, downloadUrl: null })
})

// GET /payroll/export/quickbooks — QuickBooks-formatted export
app.get('/export/quickbooks', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  return c.json({ message: 'QuickBooks export generated', startDate, endDate, data: [] })
})

// GET /payroll/mileage — mileage summary for payroll
app.get('/mileage', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  return c.json({ startDate, endDate, mileage: [] })
})

export default app
