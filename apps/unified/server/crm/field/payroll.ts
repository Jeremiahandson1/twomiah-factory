// /api/payroll: the pay run for a period — each person's hours and pay, what came off their pay, and what is left to
// pay. Moved from the CRM template's routes/payroll.ts (templates/crm/backend/src/routes). The registry signs the
// person in and gates 'time_tracking': the template mounted it ungated, and its only screen, the Pay run panel, sits
// on the Time screen, which the sidebar gates on time_tracking (gate both sides). Every action checks payroll:read
// (the template's T32 H1, on the mount). There is deliberately no GET /expenses (see the template).
import { Hono } from 'hono'
import { and, eq, gte, lte } from 'drizzle-orm'
import { createStaffBalanceStore } from '@twomiah/tenant-backend'
import { timeEntry, user, staffAccountEntry } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export function createPayrollRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('payroll:read'))

  // The ledger the expense sheet writes; read here, never written (Salon RR9).
  const staffBalance = createStaffBalanceStore(staffAccountEntry)

  app.get('/summary', async (c) => {
    const currentUser = c.get('user')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')

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

    // By person.
    const byUser: Record<string, any> = {}
    entries.forEach((e: any) => {
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

    /**
     * What came off pay in this period, and what is left to pay (Salon RR9). `totalPay` stays hours × rate; the
     * recovery is capped at what there is to take it from, and what could not be taken is reported as `unrecovered`.
     */
    const deductions = await staffBalance.deductionsBetween(db, currentUser.companyId, new Date(startDate), new Date(`${endDate}T23:59:59.999Z`))
    for (const [id, u] of Object.entries(byUser) as Array<[string, any]>) {
      u.deductions = Number((deductions[id] || 0).toFixed(2))
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

    return one(c, { payPeriodStart: startDate, payPeriodEnd: endDate, users: Object.values(byUser), totals })
  })

  return app
}
