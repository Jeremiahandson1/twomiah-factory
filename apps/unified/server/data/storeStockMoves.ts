// THE STOCK HISTORY's raw SQL (RULEBOOK §2): every change to a variant's inventory_qty goes through here and leaves a
// store_stock_moves row (db/schema/store.ts storeStockMove — Shopify's inventory adjustment history), and the inventory reports
// read the stock at a past moment from those rows. Every function returns camelCase.
//
// shiftStock moves a count by a number, READ AND WRITTEN UNDER THE ROW'S LOCK in one statement: the count before is the one the
// update starts from (two sales at the same moment each see the other's result, never the same starting figure), so the row's
// before → after is exact. Doors that set a count (the product editor, a location count, the API's set) read the count under
// the same lock in their transaction and call recordMove with it.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { rowsOf } from '@twomiah/tenant-backend'
import { storeProduct, storeProductVariant, storeStockMove } from '../db/schema/store.ts'

export type StockReason = 'sold' | 'restocked' | 'received' | 'adjusted' | 'counted' | 'transferred' | 'created' | 'untracked' | 'exchanged'
export const STOCK_REASONS: readonly StockReason[] = ['sold', 'restocked', 'received', 'adjusted', 'counted', 'transferred', 'created', 'untracked', 'exchanged']
/** What each stock-history reason reads as (the Stock changes report, the product's stock history). */
export const STOCK_REASON_WORDS: Record<StockReason, string> = {
  sold: 'Sold', restocked: 'Back on the shelf (refund or return)', received: 'Received on a purchase order', adjusted: 'Count changed', counted: 'Counted at a location',
  transferred: 'Moved between locations', created: 'Started counting', untracked: 'Stopped counting', exchanged: 'Sent out in an exchange',
}

/** Why a count moved and who moved it. A door with no person (checkout, a webhook) leaves `by` empty. */
export interface MoveWhy {
  reason: StockReason
  orderId?: string | null
  /** The purchase order, return or API key behind it. */
  refId?: string | null
  locationId?: string | null
  byUserId?: string | null
  byName?: string | null
  note?: string | null
}

/** One row of the history. Nothing is written when the count did not move — except a transfer, which moves stock between places. */
export async function recordMove(exec: any, companyId: string, variantId: string, before: number | null, after: number | null, why: MoveWhy): Promise<void> {
  if (before === after && why.reason !== 'transferred') return
  await exec.insert(storeStockMove).values({
    companyId, variantId, reason: why.reason, quantityBefore: before, quantityAfter: after, delta: (after ?? 0) - (before ?? 0),
    locationId: why.locationId ?? null, orderId: why.orderId ?? null, refId: why.refId ?? null,
    byUserId: why.byUserId ?? null, byName: why.byName ?? null, note: why.note ? String(why.note).slice(0, 500) : null,
  })
}

/**
 * Move a counted variant's stock by `by` (negative = units out), never below zero when `floor` — under the row's lock, in one
 * statement — and keep the move. An untracked variant (inventory_qty null) is left alone: null.
 */
export async function shiftStock(exec: any, variantId: string, by: number, why: MoveWhy, floor = false): Promise<{ companyId: string; before: number; after: number } | null> {
  const next = floor ? sql`greatest(0, o.before + ${by}::int)` : sql`o.before + ${by}::int`
  const [r] = rowsOf(await exec.execute(sql`
    with o as (
      select v.id, v.inventory_qty as before, p.company_id from product_variants v join products p on p.id = v.product_id
      where v.id = ${variantId} and v.inventory_qty is not null for update of v
    )
    update product_variants v set inventory_qty = ${next}, updated_at = ${new Date().toISOString()}::timestamp
    from o where v.id = o.id
    returning o.before as before, v.inventory_qty as after, o.company_id as company_id`)) as any[]
  if (!r) return null
  const out = { companyId: String(r.company_id), before: Number(r.before), after: Number(r.after) }
  await recordMove(exec, out.companyId, variantId, out.before, out.after, why)
  return out
}

/** A variant's count read under its row's lock (inside the caller's transaction): the `before` of a count about to be set. */
export async function lockedCount(tx: any, variantId: string): Promise<{ qty: number | null } | null> {
  const [v] = await tx.select({ qty: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, variantId)).limit(1).for('update')
  return v ? { qty: v.qty == null ? null : Number(v.qty) } : null
}

// ── Reading it back ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface StockMoveRow {
  id: string; variantId: string; reason: StockReason; quantityBefore: number | null; quantityAfter: number | null; delta: number
  locationId: string | null; orderId: string | null; refId: string | null; byName: string | null; note: string | null; createdAt: Date
}

/** One variant's history, newest first (the product page's "Stock history"), a page at a time: `before` = the createdAt to go back from. */
export async function movesOfVariant(db: any, companyId: string, variantId: string, limit = 50, beforeAt?: Date): Promise<StockMoveRow[]> {
  return db.select().from(storeStockMove)
    .where(and(eq(storeStockMove.companyId, companyId), eq(storeStockMove.variantId, variantId), beforeAt ? sql`${storeStockMove.createdAt} < ${beforeAt.toISOString()}::timestamp` : undefined))
    .orderBy(desc(storeStockMove.createdAt), desc(storeStockMove.id)).limit(limit)
}

export interface MoveInWindow extends StockMoveRow { productName: string; variantName: string; sku: string }

/** Every move from `fromUtc` up to (not including) `toUtc`, newest first, with the product and option named (the adjustments report). */
export async function movesBetween(db: any, companyId: string, fromUtc: Date, toUtc: Date, limit = 5000): Promise<MoveInWindow[]> {
  const rows = await db.select({ m: storeStockMove, productName: storeProduct.name, variantName: storeProductVariant.name, sku: storeProductVariant.sku })
    .from(storeStockMove).innerJoin(storeProductVariant, eq(storeProductVariant.id, storeStockMove.variantId)).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeStockMove.companyId, companyId), sql`${storeStockMove.createdAt} >= ${fromUtc.toISOString()}::timestamp`, sql`${storeStockMove.createdAt} < ${toUtc.toISOString()}::timestamp`))
    .orderBy(desc(storeStockMove.createdAt), desc(storeStockMove.id)).limit(limit)
  return rows.map((r: any) => ({ ...r.m, productName: String(r.productName), variantName: String(r.variantName), sku: String(r.sku) }))
}

/**
 * Each counted-now-or-then variant's stock at a moment (UTC): the `after` of its last move at or before it; else the `before` of
 * its first move after it; else its count now. null = not counted then. Only the variants asked for.
 */
export async function stockAt(db: any, companyId: string, variantIds: string[], atUtc: Date): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  if (!variantIds.length) return out
  const at = sql`${atUtc.toISOString()}::timestamp`
  const last = rowsOf(await db.execute(sql`
    select distinct on (variant_id) variant_id, quantity_after from store_stock_moves
    where company_id = ${companyId} and variant_id in (${sql.join(variantIds.map((v) => sql`${v}`), sql`, `)}) and created_at <= ${at}
    order by variant_id, created_at desc, id desc`)) as any[]
  for (const r of last) out.set(String(r.variant_id), r.quantity_after == null ? null : Number(r.quantity_after))
  const rest = variantIds.filter((v) => !out.has(v))
  if (rest.length) {
    const first = rowsOf(await db.execute(sql`
      select distinct on (variant_id) variant_id, quantity_before from store_stock_moves
      where company_id = ${companyId} and variant_id in (${sql.join(rest.map((v) => sql`${v}`), sql`, `)}) and created_at > ${at}
      order by variant_id, created_at asc, id asc`)) as any[]
    for (const r of first) out.set(String(r.variant_id), r.quantity_before == null ? null : Number(r.quantity_before))
  }
  const still = variantIds.filter((v) => !out.has(v))
  if (still.length) {
    const now = await db.select({ id: storeProductVariant.id, qty: storeProductVariant.inventoryQty }).from(storeProductVariant).where(inArray(storeProductVariant.id, still))
    for (const r of now as any[]) out.set(r.id, r.qty == null ? null : Number(r.qty))
  }
  return out
}

/** When the store's stock history begins (its first move), or null when nothing has been kept yet. */
export async function historyStarts(db: any, companyId: string): Promise<Date | null> {
  const [r] = await db.select({ at: storeStockMove.createdAt }).from(storeStockMove).where(eq(storeStockMove.companyId, companyId)).orderBy(asc(storeStockMove.createdAt)).limit(1)
  return r?.at ?? null
}

