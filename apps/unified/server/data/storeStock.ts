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
//
// An ORDER is filled from one location (Shopify's fulfilment location): the first location, in order, that has every line in
// stock, else the first; a counter sale from the counter's own. Its units come off that location first (then the others in order,
// if it runs short), and where each unit came off is kept on the order, so moving the order to another location puts exactly
// those units back and takes them there.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { inventoryLocation, storeProductVariant, storeStockLevel } from '../db/schema/index.ts'
import { lockedCount, recordMove, shiftStock, type MoveWhy } from './storeStockMoves.ts'

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
export async function reconcile(exec: any, companyId: string, variantId: string, prefer?: string | null): Promise<boolean> {
  return (await reconcileTaking(exec, companyId, variantId, prefer)).touched
}

/** reconcile, taking from `prefer` first when units went out, and saying where they came off (location id → units). */
async function reconcileTaking(exec: any, companyId: string, variantId: string, prefer?: string | null): Promise<{ touched: boolean; takes: Record<string, number> }> {
  const takes: Record<string, number> = {}
  const rows: any[] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId)))
  if (!rows.length) return { touched: false, takes }
  const [v] = await exec.select({ qty: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, variantId)).limit(1)
  if (!v) return { touched: false, takes }
  // Switched to not counting (inventory_qty null): its location counts mean nothing any more.
  if (v.qty == null) { await exec.delete(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId))); return { touched: true, takes } }
  const sum = rows.reduce((n, r) => n + (Number(r.quantity) || 0), 0)
  let diff = Number(v.qty) - sum
  if (diff === 0) return { touched: true, takes }
  const order = (await storeLocations(exec, companyId)).map((l) => l.id)
  const rank = (id: string) => (prefer && id === prefer ? -1 : order.indexOf(id) + 1 || 1e9)
  const ranked = [...rows].sort((a, b) => rank(a.locationId) - rank(b.locationId))
  if (diff > 0) {
    await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} + ${diff}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, ranked[0].id))
  } else {
    for (const r of ranked) {
      if (diff === 0) break
      const take = Math.min(Number(r.quantity) || 0, -diff)
      if (take > 0) {
        await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} - ${take}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, r.id))
        diff += take
        takes[r.locationId] = (takes[r.locationId] ?? 0) + take
      }
    }
  }
  await writeTotal(exec, companyId, variantId)
  return { touched: true, takes }
}

/** An order's lines' units off the stock, from `prefer` first: where they came off, by option (only options counted by location). */
export async function takeForOrder(exec: any, companyId: string, lines: Array<{ variantId: string; quantity: number }>, prefer: string | null, why: MoveWhy = { reason: 'sold' }): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const l of lines) {
    // Kept in the stock history (data/storeStockMoves.ts), counted under the row's lock.
    await shiftStock(exec, l.variantId, -l.quantity, { locationId: prefer, ...why }, true)
    const r = await reconcileTaking(exec, companyId, l.variantId, prefer)
    if (Object.keys(r.takes).length) {
      const m = out[l.variantId] ?? {}
      for (const [loc, n] of Object.entries(r.takes)) m[loc] = (m[loc] ?? 0) + n
      out[l.variantId] = m
    }
  }
  return out
}

/** Where an order is filled from: the first location, in order, with every counted line in stock there; else the first. */
export async function chooseOrderLocation(exec: any, companyId: string, lines: Array<{ variantId: string; quantity: number }>): Promise<string | null> {
  const locs = await storeLocations(exec, companyId)
  if (!locs.length) return null
  const levels = await levelsFor(exec, companyId, lines.map((l) => l.variantId))
  const counted = lines.filter((l) => levels.has(l.variantId))
  if (!counted.length) return null
  const fits = locs.find((loc) => counted.every((l) => (levels.get(l.variantId)?.get(loc.id) ?? 0) >= l.quantity))
  return (fits ?? locs[0]).id
}

/**
 * Move an order to another location: the units it took go back where they came off, and the same number come off `to` (then the
 * others in order, if `to` runs short). The options' totals do not change. Returns the new takes.
 */
export async function moveOrderTakes(exec: any, companyId: string, takes: Record<string, Record<string, number>>, to: string): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [variantId, byLoc] of Object.entries(takes || {})) {
    let units = 0
    for (const [loc, n] of Object.entries(byLoc)) {
      units += n
      await exec.insert(storeStockLevel).values({ companyId, variantId, locationId: loc, quantity: n })
        .onConflictDoUpdate({ target: [storeStockLevel.variantId, storeStockLevel.locationId], set: { quantity: sql`${storeStockLevel.quantity} + ${n}::int`, updatedAt: new Date() } })
    }
    // The total is unchanged by putting back, so take the same units again, from `to` first.
    const order = (await storeLocations(exec, companyId)).map((l) => l.id)
    const rows: any[] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId)))
    const rank = (id: string) => (id === to ? -1 : order.indexOf(id) + 1 || 1e9)
    let left = units
    const took: Record<string, number> = {}
    for (const r of [...rows].sort((a, b) => rank(a.locationId) - rank(b.locationId))) {
      if (left === 0) break
      const take = Math.min(Number(r.quantity) || 0, left)
      if (take > 0) {
        await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} - ${take}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, r.id))
        took[r.locationId] = take; left -= take
      }
    }
    await writeTotal(exec, companyId, variantId)
    out[variantId] = took
  }
  return out
}

/** reconcile for each variant (an order's lines). */
export async function reconcileMany(exec: any, companyId: string, variantIds: string[]): Promise<void> {
  for (const id of [...new Set(variantIds)]) await reconcile(exec, companyId, id)
}

/**
 * A count typed for one location. The first count a variant gets at a location starts its rows: the units it already had stay
 * at the first location (so nothing is lost), and the typed count is set where it was typed. The total is written from the rows.
 */
export async function setLevel(exec: any, companyId: string, variantId: string, locationId: string, quantity: number, who: Pick<MoveWhy, 'byUserId' | 'byName'> = {}): Promise<{ total: number }> {
  const was = await lockedCount(exec, variantId)
  const existing: any[] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId)))
  if (!existing.length) {
    const [v] = await exec.select({ qty: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, variantId)).limit(1)
    const first = (await storeLocations(exec, companyId))[0]
    if (first && v?.qty != null && Number(v.qty) > 0 && first.id !== locationId) await exec.insert(storeStockLevel).values({ companyId, variantId, locationId: first.id, quantity: Number(v.qty) })
  }
  await exec.insert(storeStockLevel).values({ companyId, variantId, locationId, quantity })
    .onConflictDoUpdate({ target: [storeStockLevel.variantId, storeStockLevel.locationId], set: { quantity, updatedAt: new Date() } })
  const total = await writeTotal(exec, companyId, variantId)
  await recordMove(exec, companyId, variantId, was?.qty ?? null, total, { reason: 'counted', locationId, note: `Counted ${quantity} here`, ...who })
  return { total }
}

/** Units moved from one location to another: the total does not change. Refused (null) when the first has fewer than asked. */
export async function transfer(exec: any, companyId: string, variantId: string, fromId: string, toId: string, quantity: number, why: Pick<MoveWhy, 'byUserId' | 'byName' | 'note'> = {}): Promise<{ total: number } | null> {
  const [from] = await exec.select().from(storeStockLevel).where(and(eq(storeStockLevel.companyId, companyId), eq(storeStockLevel.variantId, variantId), eq(storeStockLevel.locationId, fromId))).limit(1)
  if (!from || Number(from.quantity) < quantity) return null
  await exec.update(storeStockLevel).set({ quantity: sql`${storeStockLevel.quantity} - ${quantity}::int`, updatedAt: new Date() }).where(eq(storeStockLevel.id, from.id))
  await exec.insert(storeStockLevel).values({ companyId, variantId, locationId: toId, quantity })
    .onConflictDoUpdate({ target: [storeStockLevel.variantId, storeStockLevel.locationId], set: { quantity: sql`${storeStockLevel.quantity} + ${quantity}::int`, updatedAt: new Date() } })
  const total = await writeTotal(exec, companyId, variantId)
  // The total does not move; the history keeps it (from = refId, to = locationId).
  await recordMove(exec, companyId, variantId, total, total, { reason: 'transferred', locationId: toId, refId: fromId, ...why, note: why.note ?? `${quantity} moved` })
  return { total }
}

/** reconcile by the variant alone (the stock doors that are handed only a variant): its rows name the company. */
export async function reconcileVariant(exec: any, variantId: string, prefer?: string | null): Promise<boolean> {
  const [r] = await exec.select({ companyId: storeStockLevel.companyId }).from(storeStockLevel).where(eq(storeStockLevel.variantId, variantId)).limit(1)
  return r ? reconcile(exec, r.companyId, variantId, prefer) : false
}
