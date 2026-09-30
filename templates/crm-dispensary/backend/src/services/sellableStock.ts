/**
 * Can this product be sold right now, and out of which batch?
 *
 * ── why this is a module and not a block of code in the till ────────────────────────────────────
 *
 * T49 B1. The recall rule lived inline in POST /api/orders and nowhere else, so it stopped a sale at
 * ONE of the four ways a sale can be created. A recalled product was still on the public menu, still
 * on the kiosk menu, still in the AI budtender's recommendations, and a public order-ahead for it was
 * accepted and then completed at the till — 201, then 200, stock 5 → 4, no batch assigned, and the
 * only batch with stock recalled.
 *
 * That is the same shape as T48 Q6 (three doors out of a recalled batch, one locked) and as T47 P20
 * (a guard on create and not on edit). The lesson each time is the same and this file is the answer
 * to it: the rule gets ONE implementation and every door calls it. A rule copied into four routes is
 * four rules that will drift, and the one nobody updates is the one that sells the recalled lot.
 *
 * ── the rule itself ─────────────────────────────────────────────────────────────────────────────
 *
 *   · a product with an ACTIVE batch holding units sells out of the oldest such batch — the shop
 *     sells what came in first, so a recall bites on exactly the stock it is about;
 *   · a product with NO batch rows at all sells exactly as before. Plenty of shops do not run
 *     batches and refusing those sales would be a far worse bug than the one this fixes;
 *   · stock that sits outside every batch ("untracked") is not governed by any batch's status, EXCEPT
 *     under a recall;
 *   · a RECALL stops the whole product, untracked units included. The difference from a quarantine is
 *     what the shop can prove: a quarantine is a lot the shop knows the bounds of, so units outside
 *     it are a different lot and are fine. A recall says product matching this description is unsafe,
 *     and untracked units have no provenance at all — the shop cannot show they are not from the
 *     recalled lot, because that is what untracked means. (T45 BL4, and it is a blocker for a reason.)
 *
 * An empty ACTIVE batch is not what a sale comes out of; it falls through to the untracked question,
 * which answers it honestly rather than stamping the sale with a batch already depleted to zero
 * (T47 P9 watched that happen).
 */
import { sql } from 'drizzle-orm'

export interface SellableStock {
  /** productId → the batch this sale should come out of. */
  sellableBatch: Map<string, any>
  /** productId → why it cannot be sold ('recalled' | 'quarantine' | 'expired' | …). */
  blockedProducts: Map<string, string>
  /** productId → units on hand belonging to no batch: sellable, with no batch to record against. */
  untrackedUnits: Map<string, number>
}

/** How many units of a product the shop has on hand, whatever shape the row arrived in. */
function onHandOf(product: any): number {
  if (!product) return 0
  return Number(product.stockQuantity ?? product.stock_quantity ?? 0) || 0
}

/**
 * @param productIds the products on the order
 * @param products   productId → the product row (needs its stock quantity, in either case style)
 */
export async function resolveSellableStock(
  db: any,
  companyId: string,
  productIds: string[],
  products: Map<string, any>,
): Promise<SellableStock> {
  const out: SellableStock = {
    sellableBatch: new Map(),
    blockedProducts: new Map(),
    untrackedUnits: new Map(),
  }
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return out

  // sql.join, not ANY(${ids}) — a JS array reaches Postgres as one parameter and comes back
  // "malformed array literal", which in this position would 500 every sale in the shop.
  const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `)
  const rows: any = await db.execute(sql`
    SELECT id, product_id, batch_number, metrc_tag, status, current_quantity, received_date
    FROM batches
    WHERE company_id = ${companyId} AND product_id IN (${idList})
    ORDER BY received_date ASC NULLS LAST, created_at ASC
  `)

  const byProduct = new Map<string, any[]>()
  for (const b of ((rows as any).rows || rows)) {
    byProduct.set(b.product_id, [...(byProduct.get(b.product_id) || []), b])
  }

  for (const [productId, list] of byProduct) {
    const usable = list.find((b) => b.status === 'active' && Number(b.current_quantity) > 0)
    if (usable) { out.sellableBatch.set(productId, usable); continue }

    const worst = list.find((b) => b.status === 'recalled') || list[0]

    if (worst?.status === 'recalled' || list.some((b) => b.status === 'recalled')) {
      out.blockedProducts.set(productId, 'recalled')
      continue
    }

    // No sellable batch — but is the shop holding units no batch ever claimed? Every batch's
    // quantity added together is what IS tracked; anything on hand beyond that never entered one,
    // and a hold on a lot is not a hold on it.
    const tracked = list.reduce((sum, b) => sum + Math.max(0, Number(b.current_quantity) || 0), 0)
    const spare = Math.max(0, onHandOf(products.get(productId)) - tracked)
    if (spare > 0) { out.untrackedUnits.set(productId, spare); continue }

    out.blockedProducts.set(productId, String(worst?.status || 'unavailable'))
  }

  return out
}

/** The refusal a customer or a till should be shown, or null when the line is fine. */
export function refusalFor(product: any, blocked: string | undefined): { error: string; code: string; productId: string; batchStatus: string } | null {
  if (!blocked) return null
  const name = product?.name || 'That product'
  return {
    error: blocked === 'recalled'
      ? `${name} has been RECALLED and cannot be sold. Remove it from the order.`
      : `${name} has no sellable stock — every batch is ${blocked}. Remove it from the order.`,
    code: 'batch_not_sellable',
    productId: product?.id,
    batchStatus: blocked,
  }
}

/**
 * Which of these products must not be OFFERED at all — the public menu, the kiosk menu and the AI
 * budtender's pool.
 *
 * Listing a recalled product and refusing it at checkout is a worse experience than not listing it,
 * and on the AI path it is worse than that: the assistant recommended a recalled product by name and
 * told the customer how many were left. A recall should make the product disappear from every
 * channel, which is what a buyer coming from a Metrc-integrated POS expects.
 */
export async function recalledProductIds(db: any, companyId: string, productIds: string[]): Promise<Set<string>> {
  const blocked = new Set<string>()
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return blocked
  const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `)
  const rows: any = await db.execute(sql`
    SELECT DISTINCT product_id FROM batches
    WHERE company_id = ${companyId} AND status = 'recalled' AND product_id IN (${idList})
  `)
  for (const r of ((rows as any).rows || rows)) blocked.add(r.product_id)
  return blocked
}
