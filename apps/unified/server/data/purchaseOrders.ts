// The purchase-order module's money roll-ups (RULEBOOK §2: SQL aggregates live here). Moved from
// templates/crm/backend/src/routes/purchaseOrders.ts.
import { eq, and, count, sql, inArray, notInArray } from 'drizzle-orm'
import { jobPurchaseOrder as purchaseOrder, vendorBill } from '../db/schema/index.ts'

/** The company's purchase orders grouped by status: face value summed, and how many. */
export async function purchaseOrderTotalsByStatus(db: any, companyId: string): Promise<{ status: string; totalAmount: string | null; cnt: number }[]> {
  return db.select({
    status: purchaseOrder.status,
    totalAmount: sql<string>`sum(${purchaseOrder.total})`,
    cnt: count(),
  }).from(purchaseOrder).where(eq(purchaseOrder.companyId, companyId)).groupBy(purchaseOrder.status)
}

/**
 * OPEN COMMITTED: what is still outstanding on the live purchase orders (not draft, cancelled or declined) after
 * the bills against each (open, partial, paid), clamped at zero per order so one over-billed PO cannot net off
 * another's commitment (T32 M3).
 */
export async function openCommitted(db: any, companyId: string): Promise<string> {
  const billedPerPo = db.$with('billed_per_po').as(
    db.select({
      poId: vendorBill.purchaseOrderId,
      billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`.as('billed'),
    }).from(vendorBill).where(and(
      eq(vendorBill.companyId, companyId),
      inArray(vendorBill.status, ['open', 'partial', 'paid']),
    )).groupBy(vendorBill.purchaseOrderId),
  )
  const [row] = await db.with(billedPerPo).select({
    outstanding: sql<string>`coalesce(sum(greatest(${purchaseOrder.total}::numeric - coalesce(${billedPerPo.billed}::numeric, 0), 0)), 0)`,
  }).from(purchaseOrder)
    .leftJoin(billedPerPo, eq(billedPerPo.poId, purchaseOrder.id))
    .where(and(
      eq(purchaseOrder.companyId, companyId),
      notInArray(purchaseOrder.status, ['draft', 'cancelled', 'declined']),
    ))
  return row?.outstanding ?? '0'
}
