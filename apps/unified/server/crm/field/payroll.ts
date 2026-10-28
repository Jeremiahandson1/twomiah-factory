// /api/payroll: the pay run for a period — each person's hours and pay, what came off their pay, and what is left to
// pay. Moved from the CRM template's routes/payroll.ts (templates/crm/backend/src/routes). The registry signs the
// person in and gates 'time_tracking': the template mounted it ungated, and its only screen, the Pay run panel, sits
// on the Time screen, which the sidebar gates on time_tracking (gate both sides). Every action checks payroll:read
// (the template's T32 H1, on the mount). There is deliberately no GET /expenses (see the template).
import { Hono } from 'hono'
import { and, eq, gte, lt } from 'drizzle-orm'
import { createStaffBalanceStore, companyTimeZone, storeDayRange } from '@twomiah/tenant-backend'
import { timeEntry, user, staffAccountEntry } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { sendGustoHoursCsv } from '../payrollExport/gustoHours.ts'
import { companyWorkWeek, splitByWorkWeek, dailyOvertimeNotice, WEEKDAY_NAMES } from '../payrollExport/workWeek.ts'

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
    // Whole days on the shop's clock, half-open (from the field-service copy, which had fixed it): the base CRM cut
    // at UTC midnight, paying an evening shift on the next day and dropping almost all of a period's last day.
    const payTz = await companyTimeZone(db, currentUser.companyId)
    const payPeriod = { start: storeDayRange(payTz, startDate).start, end: storeDayRange(payTz, endDate).end }

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
        gte(timeEntry.date, payPeriod.start),
        lt(timeEntry.date, payPeriod.end),
      ))

    // Overtime is hours over 40 in each work week (the company's start day), the Gusto file's own split.
    const workWeek = await companyWorkWeek(db, currentUser.companyId)
    const mine: Record<string, any[]> = {}
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
      ;(mine[id] ??= []).push(e.entry)
    })
    Object.values(byUser).forEach((u: any) => {
      u.totalHours = Number(u.totalHours.toFixed(2))
      u.totalPay = Number(u.totalPay.toFixed(2))
    })
    for (const [id, u] of Object.entries(byUser) as Array<[string, any]>) {
      const s = splitByWorkWeek(mine[id], payTz, workWeek.startDay)
      u.regularHours = s.regularHours
      u.overtimeHours = s.overtimeHours
    }

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
      regularHours: Number((acc.regularHours + u.regularHours).toFixed(2)),
      overtimeHours: Number((acc.overtimeHours + u.overtimeHours).toFixed(2)),
    }), { pay: 0, deductions: 0, net: 0, unrecovered: 0, regularHours: 0, overtimeHours: 0 })

    return one(c, {
      payPeriodStart: startDate, payPeriodEnd: endDate, users: Object.values(byUser), totals,
      // The pay week the overtime split used, and — where the state pays overtime by the day too — the notice that this
      // does not (never a guess).
      workWeekStart: workWeek.startDay, workWeekStartName: WEEKDAY_NAMES[workWeek.startDay], overtimeNotice: dailyOvertimeNotice(workWeek.state),
    })
  })

  /**
   * GET /gusto-hours?startDate=&endDate= — the period's hours as the file Gusto's hours upload reads, for every trade
   * but home care (its own, /api/gusto/export-csv). Same permission as the pay run above, the same entries (whole days on
   * the shop's clock, approved or not, running clock-ins left out as they have no hours yet), and the same builder as
   * home care's file (payrollExport/gustoHours.ts). Overtime is hours over 40 in the company's work week (workWeek.ts, Sunday unless
   * set otherwise) on the shop's calendar — the rule home care's payroll pays — so Gusto is told the split and applies its own overtime rate.
   */
  app.get('/gusto-hours', async (c) => {
    const me = c.get('user')
    const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
    const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T12:00:00Z').getTime())
    if (!isDay(startDate) || !isDay(endDate)) return fail(c, 400, 'startDate and endDate required')
    const tz = await companyTimeZone(db, me.companyId)
    const { startDay } = await companyWorkWeek(db, me.companyId)
    const rows = await db.select({
      date: timeEntry.date, hours: timeEntry.hours, clockIn: timeEntry.clockIn, clockOut: timeEntry.clockOut,
      userId: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
    })
      .from(timeEntry)
      .innerJoin(user, eq(timeEntry.userId, user.id))
      .where(and(
        eq(timeEntry.companyId, me.companyId),
        gte(timeEntry.date, storeDayRange(tz, startDate!).start),
        lt(timeEntry.date, storeDayRange(tz, endDate!).end),
      ))
    const people = new Map<string, { person: any; entries: any[] }>()
    for (const r of rows as any[]) {
      if (r.clockIn && !r.clockOut) continue
      const p = people.get(r.userId) ?? { person: r, entries: [] }
      people.set(r.userId, p)
      p.entries.push(r)
    }
    const out = [...people.values()]
      .map(({ person, entries }) => ({ firstName: person.firstName, lastName: person.lastName, email: person.email, ...splitByWorkWeek(entries, tz, startDay) }))
      .filter((r) => r.totalHours > 0)
      .sort((a, b) => String(a.lastName).localeCompare(String(b.lastName)) || String(a.firstName).localeCompare(String(b.firstName)))
    return sendGustoHoursCsv(c, d, startDate!, endDate!, out)
  })

  return app
}
