import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntry, user } from '../../db/schema.ts'
import { eq, and, gte, lte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET payroll summary for a pay period
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  // first_name + last_name, because this schema's user table has no `name` column.
  // `user.name` was undefined, so drizzle threw while BUILDING the select and this route answered 500
  // on every call it ever received — silently, because nothing in this template has a screen for it.
  // (Same defect as crm/crm-basic/crm-fieldservice/crm-landscaping, and the salon's T46 N24.)
  const entries = await db.select({
    entry: timeEntry,
    userId: user.id,
    userFirstName: user.firstName,
    userLastName: user.lastName,
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
        user: { id: e.userId, name: [e.userFirstName, e.userLastName].filter(Boolean).join(' ') || null },
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

// There is deliberately no GET /payroll/expenses here.
//
// There used to be, and it answered 500 on EVERY call it ever received: the expense table has
// `submittedById`, not `userId`, so `leftJoin(user, eq(expense.userId, user.id))` built
// `eq(undefined, …)`. Its `?status=` filter was dead too, cast `as any`, which is why nothing
// complained. Nothing has ever called it — no screen, no test, no script.
//
// This template has no expenses module: no screen, no nav entry and no expense_tracking in its
// registry. The expense table here is clone residue, and so was this route.
// Repairing it would have put a second, UNSCOPED list over the same table, and non-managers are
// meant to see only their own claims (RR7 X5). Two implementations over one table is how T46 N24
// happened. scripts/check-selected-columns-exist.ts now fails the build on the column fault itself.

export default app
