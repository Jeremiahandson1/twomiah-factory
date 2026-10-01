import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { timeEntry, user, staffAccountEntry } from '../../db/schema.ts'
import { eq, and, gte, lt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { companyTimeZone, storeDayRange, createStaffBalanceStore } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)
/**
 * The pay run is gated. (T32 H1)
 *
 * This router answered on `authenticate` alone, so every signed-in user of the company could read
 * GET /summary — every person's hours and pay, the owner's included. A field technician and a
 * read-only viewer both did, on the tenant that was tested.
 *
 * `payroll:read` is held by admin and manager, which is exactly who the Pay run panel on the Time
 * screen is already shown to, so no screen loses anything.
 */
app.use('*', requirePermission('payroll:read'))

// The same ledger the expense sheet writes to — read here, never written. A pay run reports what was
// recovered; the decision to recover it was made on the Expenses screen. (Salon RR9)
const staffBalance = createStaffBalanceStore(staffAccountEntry)

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

  /**
   * What came off pay in this period, and what is left to pay. (Salon RR9)
   *
   * A deduction recorded against someone's staff balance is money the shop is recovering from their
   * pay — so the pay run is the one place it has to appear. Without this the balance went down and
   * the figure the shop pays out stayed the same, which would mean recovering the money twice or
   * not at all depending on which number somebody typed into their bank.
   *
   * `totalPay` stays exactly what it was — hours × rate, what was earned. `deductions` and `netPay`
   * are new lines beside it, never a quiet adjustment of the first: a pay figure that has already
   * had something taken off it without saying so is how disputes start.
   */
  const deductions = await staffBalance.deductionsBetween(db, currentUser.companyId, payPeriod.start, payPeriod.end)
  Object.entries(byUser).forEach(([id, u]: [string, any]) => {
    u.totalHours = Number(u.totalHours.toFixed(2))
    u.totalPay = Number(u.totalPay.toFixed(2))
    u.deductions = Number((deductions[id] || 0).toFixed(2))
    /**
     * A pay run never says "pay them minus two pounds".
     *
     * netPay was `totalPay - deductions` with no floor, and the first time I looked at the screen
     * against the API it read: earned $0.00, recovered −$2.00, to pay **−$2.00**. Nobody pays a
     * negative wage, and a figure like that in the column somebody copies into a bank transfer is
     * worse than no column at all.
     *
     * It is not only a probe artefact either: somebody who owes more than they earn in a light week,
     * or who leaves mid-period, lands here for real. So the recovery is capped at what there is to
     * recover from, and what could NOT be taken is reported rather than folded away — it stays on
     * their balance, and the shop has to get it another way.
     */
    u.netPay = Number(Math.max(0, u.totalPay - u.deductions).toFixed(2))
    u.unrecovered = Number(Math.max(0, u.deductions - u.totalPay).toFixed(2))
    // What they still owe after this period, so the shop can see whether to keep recovering.
    u.stillOwed = 0
  })
  for (const u of Object.values(byUser) as any[]) {
    u.stillOwed = await staffBalance.owed(db, currentUser.companyId, u.user.id)
  }

  const totals = Object.values(byUser).reduce((acc: any, u: any) => ({
    pay: Number((acc.pay + u.totalPay).toFixed(2)),
    deductions: Number((acc.deductions + u.deductions).toFixed(2)),
    net: Number((acc.net + u.netPay).toFixed(2)),
    unrecovered: Number((acc.unrecovered + u.unrecovered).toFixed(2)),
  }), { pay: 0, deductions: 0, net: 0, unrecovered: 0 })

  return c.json({ payPeriodStart: startDate, payPeriodEnd: endDate, users: Object.values(byUser), totals })
})

// Expenses are NOT here.
//
// This file used to carry a read-only GET /expenses that had answered 500 on every call it ever
// received — it was written against a different template's expense table (no user_id, no status
// column here) — and there was no way to create, edit or approve one, and no screen at all.
//
// The real implementation is the shared expenses module, mounted at /api/expenses, with the
// shared Expenses screen. Two endpoints over one table is how the hourly-rate defect happened in
// this very file: two places held the rate and the export read the empty one. (T46 N24)
export default app
