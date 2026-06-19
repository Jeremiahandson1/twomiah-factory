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

  const [contactRows, unitsByStatus, unitsByCategory, openLeadRows, leadsThisMonthRows, closedWonRows, openRoRows, rosThisMonthRows, revenueRows] = await Promise.all([
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    safe(() => db.select({ status: unit.status, c: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ category: unit.category, c: count() }).from(unit).where(eq(unit.companyId, companyId)).groupBy(unit.category), [] as { category: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), sql`${salesLead.stage} NOT IN ('closed_won', 'closed_lost')`)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), gte(salesLead.createdAt, startOfMonth), lt(salesLead.createdAt, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(salesLead).where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_won'), gte(salesLead.closedAt, startOfMonth), lt(salesLead.closedAt, startOfNextMonth))), [{ value: 0 }]),
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
  const closeRate = leadsThisMonth > 0 ? Math.round((closedWonThisMonth / leadsThisMonth) * 1000) / 10 : 0
  const revenueThisMonth = revenueRows.reduce((s: number, r: any) => s + Number(r.amt || 0), 0)

  return c.json({
    contacts: contactRows[0]?.value ?? 0,
    inventory: { total: totalUnits, available: byStatus['available'] || 0, byStatus, byCategory },
    sales: { openLeads: openLeadRows[0]?.value ?? 0, leadsThisMonth, closedWonThisMonth, closeRate },
    service: { openRepairOrders: openRoRows[0]?.value ?? 0, repairOrdersThisMonth: rosThisMonthRows[0]?.value ?? 0, revenueThisMonth },
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
