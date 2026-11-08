// The visits one invoice bills, each with its amount before tax: a lawn route's month (route_visit_invoice) and a storm's visits
// (snow stop → its logged visit's billed amount). Read by automatic commissions (packages/tenant-backend commissions.ts
// visitShares) so each visit's crew earns on their own visits (landscaping live test 11/08).
import { and, eq, isNotNull } from 'drizzle-orm'
import { routeVisitInvoice, snowEvent, snowStormStop } from '../db/schema/index.ts'

export async function visitSharesOf(db: any, inv: { id: string; companyId: string }): Promise<Array<{ jobId: string; amount: number }>> {
  const route: any[] = await db.select({ jobId: routeVisitInvoice.jobId, amount: routeVisitInvoice.amount }).from(routeVisitInvoice)
    .where(and(eq(routeVisitInvoice.companyId, inv.companyId), eq(routeVisitInvoice.invoiceId, inv.id)))
  const storm: any[] = await db.select({ jobId: snowStormStop.jobId, amount: snowEvent.billableAmount }).from(snowEvent)
    .innerJoin(snowStormStop, eq(snowStormStop.eventId, snowEvent.id))
    .where(and(eq(snowEvent.companyId, inv.companyId), eq(snowEvent.invoiceId, inv.id), isNotNull(snowStormStop.jobId)))
  return [...route, ...storm].filter((r) => r.jobId).map((r) => ({ jobId: String(r.jobId), amount: Number(r.amount) || 0 }))
}
