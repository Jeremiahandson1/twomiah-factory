import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntry, user, expense } from '../../db/schema.ts'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET payroll summary for a pay period
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  const entries = await db.select({
    entry: timeEntry,
    userId: user.id,
    userName: user.name,
  })
    .from(timeEntry)
    .leftJoin(user, eq(timeEntry.userId, user.id))
    .where(and(
      eq(timeEntry.companyId, currentUser.companyId),
      gte(timeEntry.date, new Date(startDate)),
      lte(timeEntry.date, new Date(endDate)),
    ))

  // Group by user
  const byUser: Record<string, any> = {}
  entries.forEach(e => {
    const id = e.entry.userId
    if (!byUser[id]) {
      byUser[id] = {
        user: { id: e.userId, name: e.userName },
        totalHours: 0,
        totalPay: 0,
        entryCount: 0,
      }
    }
    byUser[id].totalHours += Number(e.entry.hours || 0)
    byUser[id].totalPay += Number(e.entry.hours || 0) * Number(e.entry.hourlyRate || 0)
    byUser[id].entryCount++
  })

  Object.values(byUser).forEach((u: any) => {
    u.totalHours = Number(u.totalHours.toFixed(2))
    u.totalPay = Number(u.totalPay.toFixed(2))
  })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, users: Object.values(byUser) })
})

// GET expenses
app.get('/expenses', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')

  const conditions = [eq(expense.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(expense.status as any, status))

  const rows = await db.select({
    expense,
    userName: user.name,
  })
    .from(expense)
    .leftJoin(user, eq(expense.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(expense.createdAt))

  return c.json(rows.map(r => ({ ...r.expense, user: { name: r.userName } })))
})

export default app
