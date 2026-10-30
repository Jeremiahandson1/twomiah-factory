// What a route earns against what it costs, over a window of days — Jobber's rolling 30-day profit bar for recurring work,
// but per route and per property (no leader documents that; docs/parity/landscaping-routes.md). Visits are ordinary jobs,
// so cost is the job costing's own (labour at the crew's rates, materials, expenses, vendor bills); this file only gathers
// a route's completed visits, sets their value beside that cost and adds them up. Money: the caller gates it.
import { and, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { job, invoice, site, recurringRouteStop, routeVisitInvoice } from '../db/schema/index.ts'

const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export interface VisitCost { laborHours: number; laborCost: number; materialCost: number; expenseCost: number; billedCost: number; totalCost: number; unratedLaborHours: number }
export type CostsOf = (companyId: string, jobIds: string[]) => Promise<Map<string, VisitCost>>

interface Bucket {
  visits: number; completed: number; open: number
  earned: number; billed: number; unbilledEarned: number
  hours: number; labourCost: number; materialCost: number; expenseCost: number; cost: number; unratedHours: number
}
const empty = (): Bucket => ({ visits: 0, completed: 0, open: 0, earned: 0, billed: 0, unbilledEarned: 0, hours: 0, labourCost: 0, materialCost: 0, expenseCost: 0, cost: 0, unratedHours: 0 })
const finish = (b: Bucket) => {
  const profit = round2(b.earned - b.cost)
  return {
    visits: b.visits, completed: b.completed, open: b.open,
    earned: round2(b.earned), billed: round2(b.billed), unbilled: round2(b.unbilledEarned),
    labourHours: round1(b.hours), unratedLabourHours: round1(b.unratedHours),
    labourCost: round2(b.labourCost), materialCost: round2(b.materialCost), expenseCost: round2(b.expenseCost), cost: round2(b.cost),
    profit,
    // null, not 0%, when nothing was earned: there is no margin to speak of.
    marginPercent: b.earned > 0 ? round1((profit / b.earned) * 100) : null,
    earnedPerLabourHour: b.hours > 0 ? round2(b.earned / b.hours) : null,
  }
}

/**
 * The route's profit for visits whose service day falls in [from, to]. "Earned" is the value of the visits the crew
 * completed (the stop's price when the visit was made); "billed" is what invoices carry for them, so earned − billed is work
 * done but not yet billed. Cost counts only completed visits, so a half-done week does not look like a loss. A property
 * with a visit of two stops is one property.
 */
export async function routeProfit(db: any, companyId: string, routeId: string, range: { from: string; to: string }, costsOf: CostsOf) {
  const stopIds: string[] = (await db.select({ id: recurringRouteStop.id }).from(recurringRouteStop)
    .where(and(eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, companyId)))).map((s: any) => s.id)
  const total = empty()
  const byProperty = new Map<string, { siteId: string; name: string; b: Bucket }>()
  if (!stopIds.length) return { totals: finish(total), properties: [] as any[] }

  const visits: any[] = await db.select({
    id: job.id, status: job.status, value: job.estimatedValue, siteId: job.siteId, siteName: site.name,
  }).from(job).leftJoin(site, eq(job.siteId, site.id))
    .where(and(
      eq(job.companyId, companyId), inArray(job.recurringRouteStopId, stopIds), ne(job.status, 'cancelled'),
      gte(job.scheduledDate, dayDate(range.from)), sql`${job.scheduledDate} <= ${dayDate(range.to)}`,
    ))
  const doneIds = visits.filter((v) => v.status === 'completed').map((v) => v.id as string)
  const costs = doneIds.length ? await costsOf(companyId, doneIds) : new Map<string, VisitCost>()
  const links: any[] = doneIds.length ? await db.select({ jobId: routeVisitInvoice.jobId, amount: routeVisitInvoice.amount })
    .from(routeVisitInvoice).innerJoin(invoice, eq(routeVisitInvoice.invoiceId, invoice.id))
    .where(and(eq(routeVisitInvoice.companyId, companyId), inArray(routeVisitInvoice.jobId, doneIds), ne(invoice.status, 'void'), isNotNull(routeVisitInvoice.invoiceId))) : []
  const billedBy = new Map<string, number>(links.map((l) => [l.jobId, num(l.amount)]))

  for (const v of visits) {
    const key = v.siteId || 'none'
    if (!byProperty.has(key)) byProperty.set(key, { siteId: key, name: v.siteName || 'Property', b: empty() })
    const p = byProperty.get(key)!.b
    for (const b of [total, p]) {
      b.visits++
      if (v.status !== 'completed') { b.open++; continue }
      b.completed++
      const value = num(v.value)
      const c = costs.get(v.id)
      const billed = billedBy.get(v.id)
      b.earned += value
      if (billed != null) b.billed += billed; else b.unbilledEarned += value
      if (c) {
        b.hours += c.laborHours; b.labourCost += c.laborCost; b.materialCost += c.materialCost; b.expenseCost += c.expenseCost
        b.cost += c.totalCost; b.unratedHours += c.unratedLaborHours
      }
    }
  }
  return {
    totals: finish(total),
    properties: [...byProperty.values()].map((p) => ({ siteId: p.siteId, name: p.name, ...finish(p.b) })).sort((a, b) => a.profit - b.profit),
  }
}
