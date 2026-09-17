import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, unit, salesLead, repairOrder } from '../../db/schema.ts'
import { eq, and, gte, lt, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

/**
 * RV / Powersports dealership dashboard — inventory, sales pipeline and service
 * KPIs (not the contractor jobs/quotes/invoices the base ships).
 */

const app = new Hono()
app.use('*', authenticate)

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [contactRows, unitsByStatus, unitsByCategory, openLeadRows, leadsThisMonthRows, closedWonRows, closedLostRows, openRoRows, rosThisMonthRows, revenueRows] = await Promise.all([
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    safe(() => db.select({ status: unit.status, c: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ category: unit.category, c: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.category), [] as { category: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), sql`${salesLead.stage} NOT IN ('closed_won', 'closed_lost')`)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), gte(salesLead.createdAt, startOfMonth), lt(salesLead.createdAt, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_won'), gte(salesLead.closedAt, startOfMonth), lt(salesLead.closedAt, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_lost'), gte(salesLead.closedAt, startOfMonth), lt(salesLead.closedAt, startOfNextMonth))), [{ value: 0 }]),
    // Open ROs = work not finished. Exclude 'ready' (done, awaiting pickup) + 'closed'.
    safe(() => db.select({ value: count() }).from(repairOrder).where(and(eq(repairOrder.companyId, companyId), sql`${repairOrder.status} NOT IN ('ready', 'closed')`)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(repairOrder).where(and(eq(repairOrder.companyId, companyId), gte(repairOrder.createdAt, startOfMonth), lt(repairOrder.createdAt, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ amt: repairOrder.actualTotal }).from(repairOrder).where(and(eq(repairOrder.companyId, companyId), gte(repairOrder.completedAt, startOfMonth), lt(repairOrder.completedAt, startOfNextMonth))), [] as { amt: string | null }[]),
  ])

  const byStatus = Object.fromEntries(unitsByStatus.map(u => [u.status, Number(u.c)]))
  const byCategory = Object.fromEntries(unitsByCategory.map(u => [u.category, Number(u.c)]))
  const totalUnits = unitsByStatus.reduce((s, u) => s + Number(u.c), 0)
  const leadsThisMonth = leadsThisMonthRows[0]?.value ?? 0
  const closedWonThisMonth = closedWonRows[0]?.value ?? 0
  const closedLostThisMonth = closedLostRows[0]?.value ?? 0
  // Close rate = won / decided (won + lost) this month, so it measures a cohort
  // against itself and can't exceed 100% (was won ÷ leads-created = 200%, H-05).
  const decidedThisMonth = Number(closedWonThisMonth) + Number(closedLostThisMonth)
  const closeRate = decidedThisMonth > 0
    ? Math.min(100, Math.round((Number(closedWonThisMonth) / decidedThisMonth) * 1000) / 10)
    : 0
  const revenueThisMonth = revenueRows.reduce((s: number, r: any) => s + Number(r.amt || 0), 0)

  return c.json({
    contacts: contactRows[0]?.value ?? 0,
    inventory: { total: totalUnits, available: byStatus['available'] || 0, byStatus, byCategory },
    sales: { openLeads: openLeadRows[0]?.value ?? 0, leadsThisMonth, closedWonThisMonth, closeRate },
    service: { openRepairOrders: openRoRows[0]?.value ?? 0, repairOrdersThisMonth: rosThisMonthRows[0]?.value ?? 0, revenueThisMonth },
  })
})

// GET /dashboard/sales-report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD — the dealership figures for the Reports page
// period (the shared Reports page showed contractor jobs / quotes / team hours here). Definitions match /stats:
// a sale is a lead marked Sold (closed_won) with closedAt in the period; close rate = won ÷ (won + lost) in the period.
// Front-end gross per sold unit = sale price − unit cost, where sale price is the saved desk (price − discount) when
// there is one, else the unit's internet price; units with no cost on file are counted as sold but not in gross.
// (RV T19 M8)
app.get('/sales-report', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  const day = (v: string | undefined, fallback: Date) => {
    if (!v) return fallback
    const d = new Date(`${v}T00:00:00Z`)
    return Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : d
  }
  const now = new Date()
  const start = day(c.req.query('startDate'), new Date(now.getTime() - 30 * 86_400_000))
  const endDay = day(c.req.query('endDate'), now)
  if (!start || !endDay) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD dates' }, 400)
  const end = c.req.query('endDate') ? new Date(endDay.getTime() + 86_400_000) : endDay
  if (start > end) return c.json({ error: 'startDate must be on or before endDate' }, 400)

  const [sold, lostRows, openByStage, closedRos, openRos] = await Promise.all([
    db.select({ leadId: salesLead.id, deal: salesLead.deal, category: unit.category, internetPrice: unit.internetPrice, cost: unit.cost })
      .from(salesLead).leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_won'), gte(salesLead.closedAt, start), lt(salesLead.closedAt, end))),
    db.select({ value: count() }).from(salesLead)
      .where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_lost'), gte(salesLead.closedAt, start), lt(salesLead.closedAt, end))),
    db.select({ stage: salesLead.stage, c: count() }).from(salesLead)
      .where(and(eq(salesLead.companyId, companyId), sql`${salesLead.stage} NOT IN ('closed_won', 'closed_lost')`)).groupBy(salesLead.stage),
    db.select({ actual: repairOrder.actualTotal, estimated: repairOrder.estimatedTotal }).from(repairOrder)
      .where(and(eq(repairOrder.companyId, companyId), eq(repairOrder.status, 'closed'), gte(repairOrder.completedAt, start), lt(repairOrder.completedAt, end))),
    db.select({ estimated: repairOrder.estimatedTotal }).from(repairOrder)
      .where(and(eq(repairOrder.companyId, companyId), sql`${repairOrder.status} <> 'closed'`)),
  ])

  const r2 = (n: number) => Math.round(n * 100) / 100
  let gross = 0, grossUnits = 0
  const soldByCategory: Record<string, number> = {}
  for (const s of sold) {
    soldByCategory[s.category || 'no unit'] = (soldByCategory[s.category || 'no unit'] || 0) + 1
    const deal = s.deal as any
    const price = deal && Number.isFinite(Number(deal.price)) ? Number(deal.price) - (Number(deal.discount) || 0) : s.internetPrice != null ? Number(s.internetPrice) : null
    if (price != null && s.cost != null && Number.isFinite(price) && Number.isFinite(Number(s.cost))) { gross += price - Number(s.cost); grossUnits++ }
  }
  const won = sold.length, lost = Number(lostRows[0]?.value || 0)
  return c.json({
    range: { startDate: start.toISOString().slice(0, 10), endDate: new Date(end.getTime() - 1).toISOString().slice(0, 10) },
    sales: {
      unitsSold: won, lost, closeRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
      frontEndGross: r2(gross), unitsWithCost: grossUnits, averageGross: grossUnits ? r2(gross / grossUnits) : 0,
      soldByCategory,
    },
    pipeline: Object.fromEntries(openByStage.map((s) => [s.stage, Number(s.c)])),
    service: {
      closedRepairOrders: closedRos.length,
      closedValue: r2(closedRos.reduce((n, r) => n + Number(r.actual ?? r.estimated ?? 0), 0)),
      openRepairOrders: openRos.length,
      openEstimatedValue: r2(openRos.reduce((n, r) => n + Number(r.estimated ?? 0), 0)),
    },
  })
})

app.get('/recent-activity', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [recentUnits, recentLeads, recentRepairOrders] = await Promise.all([
    safe(() => db.select({ id: unit.id, year: unit.year, make: unit.make, modelName: unit.modelName, status: unit.status, category: unit.category, updatedAt: unit.updatedAt })
      .from(unit).where(eq(unit.companyId, companyId)).orderBy(desc(unit.updatedAt)).limit(5), []),
    safe(() => db.select({ id: salesLead.id, stage: salesLead.stage, source: salesLead.source, updatedAt: salesLead.updatedAt })
      .from(salesLead).where(eq(salesLead.companyId, companyId)).orderBy(desc(salesLead.updatedAt)).limit(5), []),
    safe(() => db.select({ id: repairOrder.id, roNumber: repairOrder.roNumber, status: repairOrder.status, updatedAt: repairOrder.updatedAt })
      .from(repairOrder).where(eq(repairOrder.companyId, companyId)).orderBy(desc(repairOrder.updatedAt)).limit(5), []),
  ])

  return c.json({ recentUnits, recentLeads, recentRepairOrders })
})

export default app
