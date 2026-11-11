// STOCK BY LOCATION for the store (parity tier 2 #11, Shopify's inventory locations; feature store_locations, not ready).
//
// The locations are the shared inventory's (inventory_location, type 'store'), first made = first to sell from. A variant's count
// at each is a store_stock_level row. THE ONE RULE: a variant's inventory_qty — the number checkout, the storefront, feeds, low
// stock and the API all read — equals the sum of its rows whenever it has any. Every door that changes inventory_qty (a sale,
// a refund's restock, a delivery received, the API, the product editor) calls reconcile() after it, which moves the difference
// onto the rows:
//   · fewer than the rows say (a sale): taken from the locations in order — the first location first, then the next;
//   · more (a restock, a delivery, a count typed on the product): added to the first location.
// Setting a location's count, or moving units between two, changes the rows and writes the total from them. A variant with no
// rows is counted exactly as before; untracked stock (inventory_qty null) is never given rows.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { inventoryLocation, storeProductVariant, storeStockLevel } from '../db/schema/index.ts'

export const STORE_LOCATION_TYPE = 'store'

export interface StoreLocation { id: string; name: string; address: string | null }

/** The store's locations, in the order units are sold from. */
export async function storeLocations(exec: any, companyId: string): Promise<StoreLocation[]> {
  return exec.select({ id: inventoryLocation.id, name: inventoryLocation.name, address: inventoryLocation.address }).from(inventoryLocation)
    .where(and(eq(inventoryLocation.companyId, companyId), eq(inventoryLocation.type, STORE_LOCATION_TYPE), eq(inventoryLocation.active, true)))
    .orderBy(asc(inventoryLocation.createdAt), asc(inventoryLocation.id))
}

export async function addStoreLocation(exec: any, companyId: string, name: string, address: string | null): Promise<StoreLocation> {
  const [row] = await exec.insert(inventoryLocation).values({ companyId, name, address, type: STORE_LOCATION_TYPE }).returning({ id: inventoryLocation.id, name: inventoryLocation.name, address: inventoryLocation.address })
  return row
}

/** Each variant's counts by location (variant id → location id → quantity). */
export async function levelsFor(exec: any, companyId: string, variantIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (!variantIds.length) return out
  const rows = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), inArray(storeStockLevel.variantId, variantIds)))
  for (const r of rows as any[]) {
    const m = out.get(r.variantId) ?? new Map<string, number>()
    m.set(r.locationId, Number(r.quantity) || 0)
    out.set(r.variantId, m)
  }
  return out
}

/** The total from the rows, written to the variant (rows present only). */
async function writeTotal(exec: any, companyId: string, variantId: string): Promise<number> {
  const [s] = await exec.select({ n: sql<number>`COALESCE(SUM(${storeStockLevel.quantity}), 0)::int` }).from(storeStockLevel)
    .where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId)))
  const total = Number(s?.n ?? 0)
  await exec.update(storeProductVariant).set({ inventoryQty: total, updatedAt: new Date() } as any).where(eq(storeProductVariant.id, variantId))
  return total
}

/**
 * After a door changed a variant's inventory_qty: move the difference onto its rows (taken in location order, or added to the
 * first location). No rows, or untracked: nothing. Returns whether rows were touched. Never throws on a variant of another company:
 * it only reads that company's rows.
 */
export async function reconcile(exec: any, companyId: string, variantId: string): Promise<boolean> {
  const rows: any[] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId)))
  if (!rows.length) return false
  const [v] = await exec.select({ qty: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, variantId)).limit(1)
  if (!v) return false
  // Switched to not counting (inventory_qty null): its location counts mean nothing any more.
  if (v.qty == null) { await exec.delete(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId))); return true }
  const sum = rows.reduce((n, r) => n + (Number(r.quantity) || 0), 0)
  let diff = Number(v.qty) - sum
  if (diff === 0) return true
  const order = (await storeLocations(exec, companyId)).map((l) => l.id)
  const ranked = [...rows].sort((a, b) => (order.indexOf(a.locationId) + 1 || 1e9) - (order.indexOf(b.locationId) + 1 || 1e9))
  if (diff > 0) {
    await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} + ${diff}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, ranked[0].id))
  } else {
    for (const r of ranked) {
      if (diff === 0) break
      const take = Math.min(Number(r.quantity) || 0, -diff)
      if (take > 0) {
        await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} - ${take}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, r.id))
        diff += take
      }
    }
  }
  await writeTotal(exec, companyId, variantId)
  return true
}

/** reconcile for each variant (an order's lines). */
export async function reconcileMany(exec: any, companyId: string, variantIds: string[]): Promise<void> {
  for (const id of [...new Set(variantIds)]) await reconcile(exec, companyId, id)
}

/**
 * A count typed for one location. The first count a variant gets at a location starts its rows: the units it already had stay
 * at the first location (so nothing is lost), and the typed count is set where it was typed. The total is written from the rows.
 */
export async function setLevel(exec: any, companyId: string, variantId: string, locationId: string, quantity: number): Promise<{ total: number }> {
  const existing: any[] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId)))
  if (!existing.length) {
    const [v] = await exec.select({ qty: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, variantId)).limit(1)
    const first = (await storeLocations(exec, companyId))[0]
    if (first && v?.qty != null && Number(v.qty) > 0 && first.id !== locationId) await exec.insert(storeStockLevel).values({ companyId, variantId, locationId: first.id, quantity: Number(v.qty) })
  }
  await exec.insert(storeStockLevel).values({ companyId, variantId, locationId, quantity })
    .onConflictDoUpdate({ target: [storeStockLevel.variantId, storeStockLevel.locationId], set: { quantity, updatedAt: new Date() } })
  return { total: await writeTotal(exec, companyId, variantId) }
}

/** Units moved from one location to another: the total does not change. Refused (null) when the first has fewer than asked. */
export async function transfer(exec: any, companyId: string, variantId: string, fromId: string, toId: string, quantity: number): Promise<{ total: number } | null> {
  const [from] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId), eq(storeStockLevel.locationId, fromId))).limit(1)
  if (!from || Number(from.quantity) < quantity) return null
  await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} - ${quantity}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, from.id))
  await exec.insert(storeStockLevel).values({ companyId, variantId, locationId: toId, quantity })
    .onConflictDoUpdate({ target: [storeStockLevel.variantId, storeStockLevel.locationId], set: { quantity: sql`${storeStockLevel.quantity} + ${quantity}::int`, updatedAt: new Date() } })
  return { total: await writeTotal(exec, companyId, variantId) }
}

/** reconcile by the variant alone (the stock doors that are handed only a variant): its rows name the company. */
export async function reconcileVariant(exec: any, variantId: string): Promise<boolean> {
  const [r] = await exec.select({ companyId: storeStockLevel.companyId }).from(storeStockLevel).where(eq(storeStockLevel.variantId, variantId)).limit(1)
  return r ? reconcile(exec, r.companyId, variantId) : false
}
