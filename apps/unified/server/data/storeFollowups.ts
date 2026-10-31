// The queries behind the store's post-purchase emails (store_followups, 2026-10-31, parity row 3): which orders have just
// reached their shopper, what was in them, and which products to suggest. Raw SQL stays here (RULEBOOK §2).
//
// "Reached the shopper" is orders.delivered_at (set when the order is marked delivered or picked up). An order that was only
// ever marked shipped or fulfilled has no such mark: it is counted as arrived SHIPPED_ARRIVAL_DAYS after it went out, so a
// shop that never marks orders delivered still sends its follow-ups (the owner is told this on the screen).
//
// Every sweep looks at a window — the orders whose send day passed in the last CATCH_UP_DAYS — so switching an email on
// never mails everyone who ordered last year, and a sweep that was down for a day still catches up.
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { contact, marketingAutomationSend } from '../db/schema/index.ts'
import { storeOrder, storeOrderItem, storeProduct } from '../db/schema/store.ts'
import { countedOrderCondition } from '../crm/store/tileConditions.ts'

export const SHIPPED_ARRIVAL_DAYS = 5
export const CATCH_UP_DAYS = 14
const DAY = 86_400_000
const BATCH = 200

/** When the order reached the shopper: marked so, else (shipped / fulfilled only) a few days after it went out. */
const arrival = sql`coalesce(${storeOrder.deliveredAt}, ${storeOrder.fulfilledAt} + ${SHIPPED_ARRIVAL_DAYS} * interval '1 day')`

/** Orders that count as having reached a shopper who can be emailed: sent out, not refunded in full, nothing digital. */
const arrivedOrder = (companyId: string): SQL[] => [
  eq(storeOrder.companyId, companyId),
  inArray(storeOrder.status, ['fulfilled', 'shipped', 'delivered', 'picked_up']),
  ne(storeOrder.fulfillment, 'digital'),
  ne(storeOrder.source, 'exchange'),
  sql`${storeOrder.refundedCents} < ${storeOrder.totalCents}`,
  sql`${storeOrder.contactId} is not null`,
  sql`${contact.email} is not null and ${contact.email} <> '' and ${contact.emailOptOut} = false`,
  sql`${arrival} is not null`,
]

export interface ArrivedOrder { orderId: string; contactId: string; arrivedAt: Date; orderedAt: Date }

/** Orders whose `afterDays` since arrival fell inside the catch-up window (and, for `firstOnly`, that were the customer's first sale). */
export async function ordersDueAfter(db: any, companyId: string, afterDays: number, now: Date, o: { firstOnly?: boolean } = {}): Promise<ArrivedOrder[]> {
  const conds = [
    ...arrivedOrder(companyId),
    sql`${arrival} <= ${new Date(now.getTime() - afterDays * DAY)}`,
    sql`${arrival} > ${new Date(now.getTime() - (afterDays + CATCH_UP_DAYS) * DAY)}`,
  ]
  if (o.firstOnly) {
    // Nothing earlier that counted as a sale for the same customer.
    conds.push(sql`not exists (select 1 from ${storeOrder} e where e.company_id = ${storeOrder.companyId} and e.contact_id = ${storeOrder.contactId}
      and e.id <> ${storeOrder.id} and e.created_at < ${storeOrder.createdAt} and e.status not in ('pending', 'cancelled') and e.source <> 'exchange')`)
  }
  const rows = await db.select({ orderId: storeOrder.id, contactId: storeOrder.contactId, arrivedAt: sql<Date>`${arrival}`, orderedAt: storeOrder.createdAt })
    .from(storeOrder).innerJoin(contact, eq(contact.id, storeOrder.contactId)).where(and(...conds)).orderBy(sql`${arrival} asc`, storeOrder.id).limit(BATCH)
  return rows.map((r: any) => ({ ...r, arrivedAt: new Date(r.arrivedAt) }))
}

export interface ReplenishDue { orderId: string; contactId: string; productId: string; name: string; slug: string }

/**
 * Consumables whose own reminder day (products.replenish_after_days, counted from arrival) fell inside the window — unless the
 * customer has bought the product again since (they do not need a nudge to buy what they already reordered).
 */
export async function replenishDue(db: any, companyId: string, now: Date): Promise<ReplenishDue[]> {
  const due = sql`${arrival} + ${storeProduct.replenishAfterDays} * interval '1 day'`
  const conds = [
    ...arrivedOrder(companyId),
    sql`${storeProduct.replenishAfterDays} is not null`,
    eq(storeProduct.status, 'active'),
    sql`${storeOrderItem.quantity} - ${storeOrderItem.refundedQuantity} > 0`,
    sql`${due} <= ${now}`,
    sql`${due} > ${new Date(now.getTime() - CATCH_UP_DAYS * DAY)}`,
    sql`not exists (select 1 from ${storeOrder} e join ${storeOrderItem} ei on ei.order_id = e.id
      where e.company_id = ${storeOrder.companyId} and e.contact_id = ${storeOrder.contactId} and ei.product_id = ${storeOrderItem.productId}
      and e.created_at > ${storeOrder.createdAt} and e.status not in ('pending', 'cancelled') and e.source <> 'exchange')`,
  ]
  const rows = await db.select({ orderId: storeOrder.id, contactId: storeOrder.contactId, productId: storeProduct.id, name: storeProduct.name, slug: storeProduct.slug })
    .from(storeOrder).innerJoin(contact, eq(contact.id, storeOrder.contactId))
    .innerJoin(storeOrderItem, eq(storeOrderItem.orderId, storeOrder.id)).innerJoin(storeProduct, eq(storeProduct.id, storeOrderItem.productId))
    .where(and(...conds)).orderBy(sql`${due} asc`, storeOrder.id, storeProduct.id).limit(BATCH * 3)
  return rows
}

export interface FollowupProduct { id: string; name: string; slug: string }

/** What was kept from an order (a line returned in full is not "bought"). */
export async function productsKept(db: any, orderId: string): Promise<Array<FollowupProduct & { category: string | null; alsoLikeIds: string[]; boughtTogetherIds: string[] }>> {
  const rows = await db.select({ id: storeProduct.id, name: storeProduct.name, slug: storeProduct.slug, category: storeProduct.category, alsoLikeIds: storeProduct.alsoLikeIds, boughtTogetherIds: storeProduct.boughtTogetherIds })
    .from(storeOrderItem).innerJoin(storeProduct, eq(storeProduct.id, storeOrderItem.productId))
    .where(and(eq(storeOrderItem.orderId, orderId), sql`${storeOrderItem.quantity} - ${storeOrderItem.refundedQuantity} > 0`))
  const seen = new Set<string>()
  return rows.filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true))).map((r: any) => ({ ...r, alsoLikeIds: r.alsoLikeIds || [], boughtTogetherIds: r.boughtTogetherIds || [] }))
}

/**
 * Up to `limit` products to suggest after an order: the owner's own picks (also like, then bought together) for what was
 * bought, else the same category — only things on sale, never a gift card, never something the customer already bought.
 */
export async function crossSellPicks(db: any, companyId: string, contactId: string, kept: Awaited<ReturnType<typeof productsKept>>, limit = 3): Promise<FollowupProduct[]> {
  if (!kept.length) return []
  const owned = new Set<string>((await db.selectDistinct({ id: storeOrderItem.productId }).from(storeOrderItem).innerJoin(storeOrder, eq(storeOrder.id, storeOrderItem.orderId))
    .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.contactId, contactId), countedOrderCondition(storeOrder)))).map((r: any) => r.id))
  for (const k of kept) owned.add(k.id)
  const ordered: string[] = []
  for (const k of kept) for (const id of [...k.alsoLikeIds, ...k.boughtTogetherIds]) if (!owned.has(id) && !ordered.includes(id)) ordered.push(id)
  const onSale = and(eq(storeProduct.companyId, companyId), eq(storeProduct.status, 'active'), ne(storeProduct.kind, 'gift_card'))!
  const picks: FollowupProduct[] = []
  if (ordered.length) {
    const rows = await db.select({ id: storeProduct.id, name: storeProduct.name, slug: storeProduct.slug }).from(storeProduct).where(and(onSale, inArray(storeProduct.id, ordered)))
    for (const id of ordered) { const r = rows.find((x: any) => x.id === id); if (r) picks.push(r) }
  }
  if (picks.length < limit) {
    const categories = [...new Set(kept.map((k) => k.category).filter((x): x is string => !!x))]
    if (categories.length) {
      const rows = await db.select({ id: storeProduct.id, name: storeProduct.name, slug: storeProduct.slug }).from(storeProduct)
        .where(and(onSale, inArray(storeProduct.category, categories))).orderBy(storeProduct.position, storeProduct.name).limit(limit + owned.size)
      for (const r of rows) if (!owned.has(r.id) && !picks.some((p) => p.id === r.id)) picks.push(r)
    }
  }
  return picks.slice(0, limit)
}

/** How many of each follow-up have gone out (from the shared once-only claim table), for the settings screen. */
export async function followupsSent(db: any, companyId: string): Promise<Record<'store_first_order' | 'store_cross_sell' | 'store_replenish', number>> {
  const rows = await db.select({ kind: marketingAutomationSend.kind, n: sql<number>`count(*)` }).from(marketingAutomationSend)
    .where(and(eq(marketingAutomationSend.companyId, companyId), eq(marketingAutomationSend.status, 'sent'), inArray(marketingAutomationSend.kind, ['store_first_order', 'store_cross_sell', 'store_replenish']))).groupBy(marketingAutomationSend.kind)
  const out = { store_first_order: 0, store_cross_sell: 0, store_replenish: 0 }
  for (const r of rows) (out as any)[r.kind] = Number(r.n)
  return out
}
