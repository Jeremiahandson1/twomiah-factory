// The vendor-bill module's money roll-ups and its payment lock (RULEBOOK §2: raw SQL lives here). Moved from
// templates/crm/backend/src/routes/bills.ts.
import { eq, and, count, sql, inArray } from 'drizzle-orm'
import { vendorBill, jobPurchaseOrder as purchaseOrder } from '../db/schema/index.ts'

/** The company's bills grouped by status: amount and paid summed, and how many. */
export async function billTotalsByStatus(db: any, companyId: string): Promise<{ status: string; totalAmount: string | null; totalPaid: string | null; cnt: number }[]> {
  return db.select({
    status: vendorBill.status,
    totalAmount: sql<string>`sum(${vendorBill.amount})`,
    totalPaid: sql<string>`sum(${vendorBill.amountPaid})`,
    cnt: count(),
  }).from(vendorBill).where(eq(vendorBill.companyId, companyId)).groupBy(vendorBill.status)
}

/**
 * One job's COMMITTED figure: what is still outstanding on its live purchase orders (sent, acknowledged, received,
 * billed) after the bills in `spend` statuses against each, clamped at zero per order (T32 M3).
 */
export async function jobCommitted(db: any, companyId: string, jobId: string, spend: string[]): Promise<string> {
  const billedPerPo = db.$with('billed_per_po').as(
    db.select({
      poId: vendorBill.purchaseOrderId,
      billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`.as('billed'),
    }).from(vendorBill).where(and(
      eq(vendorBill.companyId, companyId),
      inArray(vendorBill.status, spend),
    )).groupBy(vendorBill.purchaseOrderId),
  )
  const [row] = await db.with(billedPerPo).select({
    committed: sql<string>`coalesce(sum(greatest(${purchaseOrder.total}::numeric - coalesce(${billedPerPo.billed}::numeric, 0), 0)), 0)`,
  }).from(purchaseOrder)
    .leftJoin(billedPerPo, eq(billedPerPo.poId, purchaseOrder.id))
    .where(and(
      eq(purchaseOrder.companyId, companyId),
      eq(purchaseOrder.jobId, jobId),
      inArray(purchaseOrder.status, ['sent', 'acknowledged', 'received', 'billed']),
    ))
  return row?.committed ?? '0'
}

/** One job's bills (open, partial, paid): the amount billed and the amount paid. */
export async function jobBilledAndPaid(db: any, companyId: string, jobId: string): Promise<{ billed: string; paid: string }> {
  const [row] = await db.select({
    billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`,
    paid: sql<string>`coalesce(sum(${vendorBill.amountPaid}), 0)`,
  }).from(vendorBill).where(and(
    eq(vendorBill.companyId, companyId),
    eq(vendorBill.jobId, jobId),
    inArray(vendorBill.status, ['open', 'partial', 'paid']),
  ))
  return { billed: row?.billed ?? '0', paid: row?.paid ?? '0' }
}

/** What has been billed against one purchase order, counting bills in `spend` statuses. */
export async function billedAgainstPurchaseOrder(db: any, companyId: string, purchaseOrderId: string, spend: string[]): Promise<number> {
  const [row] = await db.select({
    billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`,
  }).from(vendorBill).where(and(
    eq(vendorBill.companyId, companyId),
    eq(vendorBill.purchaseOrderId, purchaseOrderId),
    inArray(vendorBill.status, spend),
  ))
  return Number(row?.billed || 0)
}

/**
 * The bill, read under a row lock (SELECT … FOR UPDATE) inside the caller's transaction, so concurrent payments
 * queue on it rather than each adding to the same starting figure (T32 B4). Null when it isn't this company's.
 */
export async function lockBill(tx: any, id: string, companyId: string): Promise<{ id: string; status: string; amount: string; amountPaid: string; purchaseOrderId: string | null } | null> {
  const locked: any = await tx.execute(sql`
    SELECT id, status, amount, amount_paid, purchase_order_id FROM vendor_bill WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE
  `)
  const r = (locked.rows || locked)[0]
  if (!r) return null
  return { id: r.id, status: r.status, amount: r.amount, amountPaid: r.amount_paid, purchaseOrderId: r.purchase_order_id }
}
