import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntry, user, expense } from '../../db/schema.ts'
import { eq, and, gte, lte, lt, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { companyTimeZone, storeDayRange } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

// GET payroll summary for a pay period
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

  // The shop's own days, from the shared definition every vertical uses.
  const payTz = await companyTimeZone(db, currentUser.companyId)
  const payPeriod = { start: storeDayRange(payTz, startDate).start, end: storeDayRange(payTz, endDate).end }

  // `user` in this schema has first_name and last_name and NO `name` column, so `user.name` was
  // undefined and drizzle threw building the select — both handlers in this file answered 500
  // every single time they were called. Nothing has a screen for either, which is the only
  // reason it was never reported. Same two-column join the appointment book uses.
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
      // Whole SHOP days, half-open. This used to be
      //     gte(timeEntry.date, new Date(startDate)), lte(timeEntry.date, new Date(endDate))
      // and timeEntry.date is a timestamp while startDate/endDate are 'YYYY-MM-DD'. So the start
      // cut at UTC midnight — an evening shift was paid on the next day — and the END cut there
      // too, which excluded almost the whole of the last day of every pay period: a week ending
      // Friday counted only the instant Friday began. Same defect the dispensary carried.
      gte(timeEntry.date, payPeriod.start),
      lt(timeEntry.date, payPeriod.end),
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

// GET expenses
//
// This route answered 500 on every call it has ever received, and nothing noticed because it has
// no screen. It was written against a DIFFERENT template's expense table: the salon's `expense`
// has no `user_id` and no `status` column, so
//     .leftJoin(user, eq(expense.userId, user.id))
// built `eq(undefined, ...)` and Postgres answered "syntax error at or near =", on the plain
// unfiltered call, every time. `eq(expense.status as any, status)` was the same mistake with a
// cast hiding it — and the `as any` is exactly why the compiler never said so.
//
// A salon expense is not attached to a person in this schema, so there is no name to report; it
// is approved or not. Filtering on `approved` is the column that exists. There is no contract to
// break here because there was never a successful response.
app.get('/expenses', async (c) => {
  const currentUser = c.get('user') as any
  const approved = c.req.query('approved')

  const conditions = [eq(expense.companyId, currentUser.companyId)]
  if (approved === 'true' || approved === 'false') conditions.push(eq(expense.approved, approved === 'true'))

  // Bounded: expenses only accumulate, so a list with no LIMIT answers with every one a salon has
  // ever filed.
  const page = Math.max(1, Number(c.req.query('page') || '1') || 1)
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || '100') || 100))

  const rows = await db.select()
    .from(expense)
    .where(and(...conditions))
    .orderBy(desc(expense.createdAt))
    .limit(limit)
    .offset((page - 1) * limit)

  const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` })
    .from(expense).where(and(...conditions)) as any
  return c.json({
    data: rows,
    pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
  })
})

export default app
