// Inventory items at or under their reorder point, for the daily low-stock email (crm/lowStockDigest.ts).
import { and, eq, sql, inArray } from 'drizzle-orm'
import { inventoryItem, stockLevel } from '../db/schema/field.ts'
import { user } from '../db/schema/index.ts'

export interface InventoryLowItem { name: string; sku: string; unit: string; quantity: number; reorderPoint: number }

/**
 * The company's active items whose stock, over every location, is at or under the reorder point the owner set — fewest left
 * first. An item with NO reorder point (0, the default) has no level, so it is never listed: otherwise every item that is
 * simply not stocked would be in the email every day.
 */
export async function inventoryLowItems(db: any, companyId: string): Promise<InventoryLowItem[]> {
  const total = sql<number>`coalesce(sum(${stockLevel.quantity}), 0)::int`
  const rows = await db.select({ name: inventoryItem.name, sku: inventoryItem.sku, unit: inventoryItem.unit, reorderPoint: inventoryItem.reorderPoint, quantity: total })
    .from(inventoryItem).leftJoin(stockLevel, eq(stockLevel.itemId, inventoryItem.id))
    .where(and(eq(inventoryItem.companyId, companyId), eq(inventoryItem.active, true), sql`${inventoryItem.reorderPoint} > 0`))
    .groupBy(inventoryItem.id)
    .having(sql`coalesce(sum(${stockLevel.quantity}), 0) <= ${inventoryItem.reorderPoint}`)
    .orderBy(total, inventoryItem.name, inventoryItem.sku)
  return rows.map((r: any) => ({ ...r, quantity: Number(r.quantity), reorderPoint: Number(r.reorderPoint) }))
}

/** The people who run the business — active owners, admins and managers — who get the email (what the per-movement alert used). */
export async function inventoryAlertRecipients(db: any, companyId: string): Promise<string[]> {
  const rows = await db.select({ email: user.email }).from(user)
    .where(and(eq(user.companyId, companyId), eq(user.isActive, true), inArray(user.role, ['owner', 'admin', 'manager'])))
  return rows.map((r: any) => r.email).filter(Boolean)
}
