import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, unit, salesLead, repairOrder } from '../../db/schema.ts'
import { eq, and, gte, lt, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId

  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)
  const startOfNextMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1)

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [
    contactRows,
    unitsByStatus,
    unitsByCategory,
    openLeadRows,
    leadsThisMonthRows,
    closedWonThisMonthRows,
    openRoRows,
    rosThisMonthRows,
    serviceRevenueRows,
  ] = await Promise.all([
    // Total contacts (customers + leads)
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    // Inventory units grouped by status
    safe(() => db.select({ status: unit.status, _count: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.status), []),
    // Inventory units grouped by category
    safe(() => db.select({ category: unit.category, _count: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.category), []),
    // Open (active) sales leads — not yet closed
    safe(() => db.select({ value: count() }).from(salesLead).where(and(
      eq(salesLead.companyId, companyId),
      sql`${salesLead.stage} NOT IN ('closed_won', 'closed_lost')`,
    )), [{ value: 0 }]),
    // Sales leads created this month
    safe(() => db.select({ value: count() }).from(salesLead).where(and(
      eq(salesLead.companyId, companyId),
      gte(salesLead.createdAt, startOfMonth),
      lt(salesLead.createdAt, startOfNextMonth),
    )), [{ value: 0 }]),
    // Deals closed-won this month (by close date)
    safe(() => db.select({ value: count() }).from(salesLead).where(and(
      eq(salesLead.companyId, companyId),
      eq(salesLead.stage, 'closed_won'),
      gte(salesLead.closedAt, startOfMonth),
      lt(salesLead.closedAt, startOfNextMonth),
    )), [{ value: 0 }]),
    // Open repair orders (not closed)
    safe(() => db.select({ value: count() }).from(repairOrder).where(and(
      eq(repairOrder.companyId, companyId),
      sql`${repairOrder.status} <> 'closed'`,
    )), [{ value: 0 }]),
    // Repair orders opened this month
    safe(() => db.select({ value: count() }).from(repairOrder).where(and(
      eq(repairOrder.companyId, companyId),
      gte(repairOrder.createdAt, startOfMonth),
      lt(repairOrder.createdAt, startOfNextMonth),
    )), [{ value: 0 }]),
    // Service revenue this month (completed ROs, by completion date)
    safe(() => db.select({ status: repairOrder.actualTotal, completedAt: repairOrder.completedAt }).from(repairOrder).where(and(
      eq(repairOrder.companyId, companyId),
      gte(repairOrder.completedAt, startOfMonth),
      lt(repairOrder.completedAt, startOfNextMonth),
    )), [] as { status: string | null; completedAt: Date | null }[]),
  ])

  const contacts = contactRows[0]?.value ?? 0
  const openLeads = openLeadRows[0]?.value ?? 0
  const leadsThisMonth = leadsThisMonthRows[0]?.value ?? 0
  const closedWonThisMonth = closedWonThisMonthRows[0]?.value ?? 0
  const openRepairOrders = openRoRows[0]?.value ?? 0
  const rosThisMonth = rosThisMonthRows[0]?.value ?? 0

  const serviceRevenueThisMonth = serviceRevenueRows.reduce(
    (s: number, r: any) => s + Number(r.status || 0), 0,
  )

  // Close rate = closed_won this month / leads created this month
  const closeRate = leadsThisMonth > 0
    ? Math.round((closedWonThisMonth / leadsThisMonth) * 1000) / 10
    : 0

  const totalUnits = unitsByStatus.reduce((s: number, u: any) => s + u._count, 0)

  return c.json({
    contacts,
    inventory: {
      total: totalUnits,
      byStatus: Object.fromEntries(unitsByStatus.map((u: any) => [u.status, u._count])),
      byCategory: Object.fromEntries(unitsByCategory.map((u: any) => [u.category, u._count])),
    },
    sales: {
      openLeads,
      leadsThisMonth,
      closedWonThisMonth,
      closeRate, // percentage
    },
    service: {
      openRepairOrders,
      repairOrdersThisMonth: rosThisMonth,
      revenueThisMonth: serviceRevenueThisMonth,
    },
  })
})

app.get('/recent-activity', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId

  const [recentLeads, recentRepairOrders, recentUnits] = await Promise.all([
    db.select({
      id: salesLead.id, stage: salesLead.stage, source: salesLead.source,
      contactId: salesLead.contactId, unitId: salesLead.unitId, updatedAt: salesLead.updatedAt,
    }).from(salesLead).where(eq(salesLead.companyId, companyId)).orderBy(desc(salesLead.updatedAt)).limit(5),
    db.select({
      id: repairOrder.id, roNumber: repairOrder.roNumber, status: repairOrder.status,
      estimatedTotal: repairOrder.estimatedTotal, actualTotal: repairOrder.actualTotal,
      customerId: repairOrder.customerId, updatedAt: repairOrder.updatedAt,
    }).from(repairOrder).where(eq(repairOrder.companyId, companyId)).orderBy(desc(repairOrder.updatedAt)).limit(5),
    db.select({
      id: unit.id, stockNumber: unit.stockNumber, category: unit.category, status: unit.status,
      year: unit.year, make: unit.make, modelName: unit.modelName, listedPrice: unit.listedPrice,
      updatedAt: unit.updatedAt,
    }).from(unit).where(eq(unit.companyId, companyId)).orderBy(desc(unit.updatedAt)).limit(5),
  ])

  return c.json({ recentLeads, recentRepairOrders, recentUnits })
})

export default app
