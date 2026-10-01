import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntry, user, expense, staffAccountEntry } from '../../db/schema.ts'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { createStaffBalanceStore } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

// The same ledger the expense sheet writes to — read here, never written. A pay run reports what
// was recovered; the decision to recover it was made on the Expenses screen. (Salon RR9)
const staffBalance = createStaffBalanceStore(staffAccountEntry)

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

  /**
   * What came off pay in this period, and what is left to pay. (Salon RR9)
   *
   * A deduction recorded against someone's staff balance is money the business is recovering from
   * their pay, so the pay run is the one place it has to appear: otherwise the balance goes down and
   * the figure somebody types into the bank stays the same, and the money is recovered twice or not
   * at all depending on which number they trusted.
   *
   * `totalPay` stays exactly what it was — hours × rate, what was earned. `deductions` and
   * `netPay` are new lines beside it, never a quiet adjustment of the first.
   */
  const deductions = await staffBalance.deductionsBetween(db, currentUser.companyId, new Date(startDate), new Date(`${endDate}T23:59:59.999Z`))
  for (const [id, u] of Object.entries(byUser) as Array<[string, any]>) {
    u.deductions = Number((deductions[id] || 0).toFixed(2))
    // A pay run never reports a negative wage. Somebody who owes more than they earned in a light
    // week — or who leaves mid-period — used to land on "to pay: −$2.00", which is a figure
    // somebody copies into a bank transfer. The recovery is capped at what there is to take it
    // from, and what could NOT be taken is reported rather than folded away: it stays on their
    // balance and has to come from somewhere else. (Found by reading the screen against the API.)
    u.netPay = Number(Math.max(0, u.totalPay - u.deductions).toFixed(2))
    u.unrecovered = Number(Math.max(0, u.deductions - u.totalPay).toFixed(2))
    u.stillOwed = await staffBalance.owed(db, currentUser.companyId, id)
  }
  const totals = Object.values(byUser).reduce((acc: any, u: any) => ({
    pay: Number((acc.pay + u.totalPay).toFixed(2)),
    deductions: Number((acc.deductions + u.deductions).toFixed(2)),
    net: Number((acc.net + u.netPay).toFixed(2)),
    unrecovered: Number((acc.unrecovered + u.unrecovered).toFixed(2)),
  }), { pay: 0, deductions: 0, net: 0, unrecovered: 0 })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, users: Object.values(byUser), totals })
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
