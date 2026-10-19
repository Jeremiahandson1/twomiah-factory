// The dealership dashboard: inventory, the sales pipeline and the service department, and the Reports page's sales
// figures. What /api/dashboard answers where CrmSettings.dashboard is 'dealership' (templates/crm-rv shipped it in place
// of the jobs dashboard). The month's service revenue is invoices:read's (T41). Moved from
// templates/crm-rv/backend/src/routes/dashboard.ts.
import { Hono } from 'hono'
import { eq, and, gte, lt, count, desc, ne, notInArray } from 'drizzle-orm'
import { contact, unit, salesLead, repairOrder } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const CLOSED = ['closed_won', 'closed_lost']

export function createDealershipDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const { hasPermission, getExtraPermissions, requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // The dashboard is dashboard:read, as the jobs dashboard is; money inside it still follows invoices:read and margin:read.
  app.use('*', requirePermission('dashboard:read'))
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }

  // GET /stats — money behind invoices:read.
  app.get('/stats', async (c) => {
    const user = c.get('user')
    const companyId = user.companyId
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const [contactRows, unitsByStatus, unitsByCategory, availableByCategoryRows, openLeadRows, leadsThisMonthRows, closedWonRows, closedLostRows, openRoRows, rosThisMonthRows, revenueRows] = await Promise.all([
      safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
      safe(() => db.select({ status: unit.status, c: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.status), [] as { status: string; c: number }[]),
      safe(() => db.select({ category: unit.category, c: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.category), [] as { category: string; c: number }[]),
      // what is for sale now, by category — the panel under the "available" tile (RV T19 L7)
      safe(() => db.select({ category: unit.category, c: count() }).from(unit).where(and(eq(unit.companyId, companyId), eq(unit.status, 'available'))).groupBy(unit.category), [] as { category: string; c: number }[]),
      safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), notInArray(salesLead.stage, CLOSED))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), gte(salesLead.createdAt, startOfMonth), lt(salesLead.createdAt, startOfNextMonth))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_won'), gte(salesLead.closedAt, startOfMonth), lt(salesLead.closedAt, startOfNextMonth))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_lost'), gte(salesLead.closedAt, startOfMonth), lt(salesLead.closedAt, startOfNextMonth))), [{ value: 0 }]),
      // Open ROs = work not finished: not 'ready' (done, awaiting pickup) and not 'closed'.
      safe(() => db.select({ value: count() }).from(repairOrder).where(and(eq(repairOrder.companyId, companyId), notInArray(repairOrder.status, ['ready', 'closed']))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(repairOrder).where(and(eq(repairOrder.companyId, companyId), gte(repairOrder.createdAt, startOfMonth), lt(repairOrder.createdAt, startOfNextMonth))), [{ value: 0 }]),
      safe(() => db.select({ amt: repairOrder.actualTotal }).from(repairOrder).where(and(eq(repairOrder.companyId, companyId), gte(repairOrder.completedAt, startOfMonth), lt(repairOrder.completedAt, startOfNextMonth))), [] as { amt: string | null }[]),
    ])

    const byStatus = Object.fromEntries(unitsByStatus.map((u: any) => [u.status, Number(u.c)]))
    const byCategory = Object.fromEntries(unitsByCategory.map((u: any) => [u.category, Number(u.c)]))
    const totalUnits = unitsByStatus.reduce((s: number, u: any) => s + Number(u.c), 0)
    const leadsThisMonth = leadsThisMonthRows[0]?.value ?? 0
    const closedWonThisMonth = closedWonRows[0]?.value ?? 0
    const closedLostThisMonth = closedLostRows[0]?.value ?? 0
    // Close rate = won / decided (won + lost) this month, so it can't exceed 100% (H-05).
    const decidedThisMonth = Number(closedWonThisMonth) + Number(closedLostThisMonth)
    const closeRate = decidedThisMonth > 0 ? Math.min(100, Math.round((Number(closedWonThisMonth) / decidedThisMonth) * 1000) / 10) : 0
    const revenueThisMonth = revenueRows.reduce((s: number, r: any) => s + Number(r.amt || 0), 0)
    const maySeeRevenue = hasPermission(user?.role, 'invoices:read', await getExtraPermissions(user?.userId))
    const availableByCategory = Object.fromEntries(availableByCategoryRows.map((u: any) => [u.category, Number(u.c)]))

    return one(c, {
      contacts: contactRows[0]?.value ?? 0,
      inventory: { total: totalUnits, available: byStatus['available'] || 0, byStatus, byCategory, availableByCategory },
      // closeRate is this month's; the lost count is sent so the card can say so (RV T19 L9)
      sales: { openLeads: openLeadRows[0]?.value ?? 0, leadsThisMonth, closedWonThisMonth, closedLostThisMonth: Number(closedLostThisMonth), closeRate },
      // The service WORKLOAD stays; the month's service revenue is the business's income — omitted, not zeroed (T41).
      service: {
        openRepairOrders: openRoRows[0]?.value ?? 0,
        repairOrdersThisMonth: rosThisMonthRows[0]?.value ?? 0,
        ...(maySeeRevenue ? { revenueThisMonth } : {}),
      },
    })
  })

  // GET /sales-report?startDate=&endDate= — the dealership figures for the Reports page period (RV T19 M8). A sale is a
  // lead marked Sold with closedAt in the period; front-end gross per sold unit = sale price − unit cost.
  app.get('/sales-report', async (c) => {
    const user = c.get('user')
    const companyId = user.companyId
    const day = (v: string | undefined, fallback: Date) => {
      if (!v) return fallback
      const dt = new Date(`${v}T00:00:00Z`)
      return Number.isNaN(dt.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : dt
    }
    const now = new Date()
    const start = day(c.req.query('startDate'), new Date(now.getTime() - 30 * 86_400_000))
    const endDay = day(c.req.query('endDate'), now)
    if (!start || !endDay) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD dates')
    const end = c.req.query('endDate') ? new Date(endDay.getTime() + 86_400_000) : endDay
    if (start > end) return fail(c, 400, 'startDate must be on or before endDate')

    const [sold, lostRows, openByStage, closedRos, openRos] = await Promise.all([
      db.select({ leadId: salesLead.id, deal: salesLead.deal, category: unit.category, internetPrice: unit.internetPrice, cost: unit.cost })
        .from(salesLead).leftJoin(unit, eq(salesLead.unitId, unit.id))
        .where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_won'), gte(salesLead.closedAt, start), lt(salesLead.closedAt, end))),
      db.select({ value: count() }).from(salesLead)
        .where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_lost'), gte(salesLead.closedAt, start), lt(salesLead.closedAt, end))),
      db.select({ stage: salesLead.stage, c: count() }).from(salesLead)
        .where(and(eq(salesLead.companyId, companyId), notInArray(salesLead.stage, CLOSED))).groupBy(salesLead.stage),
      db.select({ actual: repairOrder.actualTotal, estimated: repairOrder.estimatedTotal }).from(repairOrder)
        .where(and(eq(repairOrder.companyId, companyId), eq(repairOrder.status, 'closed'), gte(repairOrder.completedAt, start), lt(repairOrder.completedAt, end))),
      db.select({ estimated: repairOrder.estimatedTotal }).from(repairOrder)
        .where(and(eq(repairOrder.companyId, companyId), ne(repairOrder.status, 'closed'))),
    ])

    const r2 = (n: number) => Math.round(n * 100) / 100
    let gross = 0, grossUnits = 0
    const soldByCategory: Record<string, number> = {}
    for (const s of sold as any[]) {
      soldByCategory[s.category || 'no unit'] = (soldByCategory[s.category || 'no unit'] || 0) + 1
      const deal = s.deal as any
      const price = deal && Number.isFinite(Number(deal.price)) ? Number(deal.price) - (Number(deal.discount) || 0) : s.internetPrice != null ? Number(s.internetPrice) : null
      if (price != null && s.cost != null && Number.isFinite(price) && Number.isFinite(Number(s.cost))) { gross += price - Number(s.cost); grossUnits++ }
    }
    const won = sold.length, lost = Number(lostRows[0]?.value || 0)
    // Front-end gross is sale price less what the store PAID — the margin T41/T42 put behind margin:read on the unit
    // and the F&I menu. The template sent it to any signed-in seat here; it is omitted (not zeroed) for the others.
    const mayMargin = hasPermission(user?.role, 'margin:read', await getExtraPermissions(user?.userId))
    return one(c, {
      range: { startDate: start.toISOString().slice(0, 10), endDate: new Date(end.getTime() - 1).toISOString().slice(0, 10) },
      sales: {
        unitsSold: won, lost, closeRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
        ...(mayMargin ? { frontEndGross: r2(gross), unitsWithCost: grossUnits, averageGross: grossUnits ? r2(gross / grossUnits) : 0 } : {}),
        soldByCategory,
      },
      pipeline: Object.fromEntries((openByStage as any[]).map((s) => [s.stage, Number(s.c)])),
      service: {
        closedRepairOrders: closedRos.length,
        closedValue: r2((closedRos as any[]).reduce((n, r) => n + Number(r.actual ?? r.estimated ?? 0), 0)),
        openRepairOrders: openRos.length,
        openEstimatedValue: r2((openRos as any[]).reduce((n, r) => n + Number(r.estimated ?? 0), 0)),
      },
    })
  })

  app.get('/recent-activity', async (c) => {
    const companyId = c.get('user').companyId
    const [recentUnits, recentLeads, recentRepairOrders] = await Promise.all([
      safe(() => db.select({ id: unit.id, year: unit.year, make: unit.make, modelName: unit.modelName, status: unit.status, category: unit.category, updatedAt: unit.updatedAt })
        .from(unit).where(eq(unit.companyId, companyId)).orderBy(desc(unit.updatedAt)).limit(5), [] as any[]),
      safe(() => db.select({ id: salesLead.id, stage: salesLead.stage, source: salesLead.source, updatedAt: salesLead.updatedAt })
        .from(salesLead).where(eq(salesLead.companyId, companyId)).orderBy(desc(salesLead.updatedAt)).limit(5), [] as any[]),
      safe(() => db.select({ id: repairOrder.id, roNumber: repairOrder.roNumber, status: repairOrder.status, updatedAt: repairOrder.updatedAt })
        .from(repairOrder).where(eq(repairOrder.companyId, companyId)).orderBy(desc(repairOrder.updatedAt)).limit(5), [] as any[]),
    ])
    return one(c, { recentUnits, recentLeads, recentRepairOrders })
  })

  return app
}
