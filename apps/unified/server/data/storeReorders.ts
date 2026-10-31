// The queries behind "Draft a reorder" (store_reorders, 2026-10-31, parity row 4). Raw SQL stays here (RULEBOOK §2).
//
// What is low is the Low stock list's own rule (an active product's option that tracks its stock, has a level, and is at or
// under it — see storeCatalog.lowStockItems). What to order is the gap back up to the "order up to" count on the option, else
// twice its low-stock level, less what is already on an open purchase order (draft, sent, or part received), so pressing
// "Draft a reorder" twice never orders the same shortfall twice.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { storeProduct, storeProductVariant, storePurchaseOrder, storePurchaseOrderLine, storeSupplier } from '../db/schema/store.ts'

export const OPEN_STATUSES = ['draft', 'sent', 'partly_received'] as const

export interface ReorderCandidate {
  variantId: string; sku: string; productName: string; variantName: string
  quantity: number; lowStockAt: number; reorderToQty: number | null; costCents: number | null
  supplierId: string | null; supplierName: string | null; onOrder: number
}

/** How many to order: back up to the target, less what is already on order; never negative. */
export const suggestedQuantity = (c: Pick<ReorderCandidate, 'quantity' | 'lowStockAt' | 'reorderToQty' | 'onOrder'>): number =>
  Math.max(0, (c.reorderToQty ?? c.lowStockAt * 2) - c.quantity - c.onOrder)

export async function reorderCandidates(db: any, companyId: string): Promise<ReorderCandidate[]> {
  const v = storeProductVariant
  const onOrder = sql<number>`coalesce((select sum(l.quantity - l.received_quantity) from store_purchase_order_lines l join store_purchase_orders po on po.id = l.purchase_order_id
    where l.variant_id = ${v.id} and po.company_id = ${companyId} and po.status in ('draft', 'sent', 'partly_received')), 0)`
  const rows = await db.select({
    variantId: v.id, sku: v.sku, productName: storeProduct.name, variantName: v.name, quantity: v.inventoryQty, lowStockAt: v.lowStockAt,
    reorderToQty: v.reorderToQty, costCents: v.costCents, supplierId: v.supplierId, supplierName: storeSupplier.name, onOrder,
  }).from(v).innerJoin(storeProduct, eq(storeProduct.id, v.productId)).leftJoin(storeSupplier, eq(storeSupplier.id, v.supplierId))
    .where(and(eq(storeProduct.companyId, companyId), eq(storeProduct.status, 'active'),
      sql`${v.lowStockAt} is not null and ${v.inventoryQty} is not null and ${v.inventoryQty} <= ${v.lowStockAt}`))
    .orderBy(sql`${v.inventoryQty} asc`, storeProduct.name, v.sku)
  return rows.map((r: any) => ({ ...r, quantity: Number(r.quantity), lowStockAt: Number(r.lowStockAt), onOrder: Number(r.onOrder) }))
}

/** The next number, PO-0001 on: one more than the highest in use. Orders are never deleted (a wrong one is cancelled), so a number is never used twice. */
export async function nextPurchaseOrderNumber(db: any, companyId: string): Promise<string> {
  const [r] = await db.select({ top: sql<number>`coalesce(max(nullif(regexp_replace(${storePurchaseOrder.number}, '\\D', '', 'g'), '')::int), 0)` })
    .from(storePurchaseOrder).where(eq(storePurchaseOrder.companyId, companyId))
  return `PO-${String(Number(r?.top ?? 0) + 1).padStart(4, '0')}`
}

/** Options by id, for the lines of an order being drafted — only this company's. */
export async function variantsOf(db: any, companyId: string, ids: string[]) {
  if (!ids.length) return []
  return db.select({ id: storeProductVariant.id, sku: storeProductVariant.sku, variantName: storeProductVariant.name, productName: storeProduct.name, costCents: storeProductVariant.costCents, supplierId: storeProductVariant.supplierId })
    .from(storeProductVariant).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeProduct.companyId, companyId), inArray(storeProductVariant.id, ids)))
}

/** The order's lines, in the order they were drafted. */
export const linesOf = (db: any, purchaseOrderId: string) =>
  db.select().from(storePurchaseOrderLine).where(eq(storePurchaseOrderLine.purchaseOrderId, purchaseOrderId)).orderBy(storePurchaseOrderLine.name, storePurchaseOrderLine.sku)

/**
 * Book received units in against the order, in one transaction: each line's received count goes up, the option's stock goes
 * up by the same (an option that does not track its stock is left untracked), and the order becomes partly_received or
 * received. Refused whole if any line would be received past what was ordered. Returns the order's new status.
 */
export async function receiveAgainst(db: any, companyId: string, purchaseOrderId: string, receipts: Array<{ lineId: string; quantity: number }>): Promise<{ status: 'partly_received' | 'received'; booked: number } | { problem: string }> {
  return db.transaction(async (tx: any) => {
    const lines: any[] = await tx.select().from(storePurchaseOrderLine).where(eq(storePurchaseOrderLine.purchaseOrderId, purchaseOrderId)).for('update')
    const byId = new Map(lines.map((l) => [l.id, l]))
    let booked = 0
    for (const r of receipts) {
      const line = byId.get(r.lineId)
      if (!line) return { problem: 'One of those lines is not on this order.' }
      if (line.receivedQuantity + r.quantity > line.quantity) return { problem: `${line.name} (${line.sku}): ${line.quantity} were ordered and ${line.receivedQuantity} have come in, so ${r.quantity} more is too many.` }
    }
    for (const r of receipts) {
      if (r.quantity <= 0) continue
      const line = byId.get(r.lineId)!
      await tx.update(storePurchaseOrderLine).set({ receivedQuantity: sql`${storePurchaseOrderLine.receivedQuantity} + ${r.quantity}` }).where(eq(storePurchaseOrderLine.id, line.id))
      line.receivedQuantity += r.quantity; booked += r.quantity
      if (line.variantId) {
        await tx.update(storeProductVariant).set({ inventoryQty: sql`${storeProductVariant.inventoryQty} + ${r.quantity}`, updatedAt: new Date() })
          .where(and(eq(storeProductVariant.id, line.variantId), sql`${storeProductVariant.inventoryQty} is not null`))
      }
    }
    const all = lines.every((l) => l.receivedQuantity >= l.quantity)
    const status = all ? 'received' : 'partly_received'
    await tx.update(storePurchaseOrder).set({ status, updatedAt: new Date(), ...(all ? { receivedAt: new Date() } : {}) })
      .where(and(eq(storePurchaseOrder.id, purchaseOrderId), eq(storePurchaseOrder.companyId, companyId)))
    return { status, booked }
  })
}
