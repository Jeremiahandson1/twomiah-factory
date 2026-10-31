// The public store API's queries (store_api, 2026-10-31, parity row 8), for server/crm/store/apps/publicApi.ts. Every list is a
// keyset page: rows after the cursor's id, in id order, one more than asked for so the caller knows whether another page exists.
// A page is the company's rows only. The raw SQL of the stock writes lives here (RULEBOOK §2): a count changes in ONE statement.
import { and, asc, eq, gt, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { contact } from '../db/schema/index.ts'
import { storeOrder, storeOrderItem, storeProduct, storeProductVariant } from '../db/schema/store.ts'

export interface Paged<T> { rows: T[]; next: string | null }
const page = <T extends { id: string }>(rows: T[], limit: number): Paged<T> => ({ rows: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null })

export async function apiProducts(db: any, companyId: string, q: { status: string | null; after: string | null; limit: number; updatedSince: Date | null }): Promise<Paged<typeof storeProduct.$inferSelect>> {
  const rows = await db.select().from(storeProduct).where(and(
    eq(storeProduct.companyId, companyId),
    q.status ? eq(storeProduct.status, q.status) : ne(storeProduct.status, 'archived'),
    q.after ? gt(storeProduct.id, q.after) : undefined,
    q.updatedSince ? gte(storeProduct.updatedAt, q.updatedSince) : undefined,
  )).orderBy(asc(storeProduct.id)).limit(q.limit + 1)
  return page(rows, q.limit)
}

export async function apiOrders(db: any, companyId: string, q: { status: string | null; after: string | null; limit: number; createdSince: Date | null }): Promise<Paged<{ order: typeof storeOrder.$inferSelect; items: Array<typeof storeOrderItem.$inferSelect>; id: string }>> {
  // A pending order is a checkout nobody has paid for: not an order (the webhooks say nothing of it either) unless asked for by name.
  const rows: Array<typeof storeOrder.$inferSelect> = await db.select().from(storeOrder).where(and(
    eq(storeOrder.companyId, companyId),
    q.status ? eq(storeOrder.status, q.status) : ne(storeOrder.status, 'pending'),
    q.after ? gt(storeOrder.id, q.after) : undefined,
    q.createdSince ? gte(storeOrder.createdAt, q.createdSince) : undefined,
  )).orderBy(asc(storeOrder.id)).limit(q.limit + 1)
  const shown = rows.slice(0, q.limit)
  const items: Array<typeof storeOrderItem.$inferSelect> = shown.length ? await db.select().from(storeOrderItem).where(inArray(storeOrderItem.orderId, shown.map((o) => o.id))) : []
  return page(rows.map((o) => ({ id: o.id, order: o, items: items.filter((i) => i.orderId === o.id) })), q.limit)
}

export async function apiOrder(db: any, companyId: string, id: string) {
  const [order] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, id), eq(storeOrder.companyId, companyId))).limit(1)
  if (!order) return null
  return { order: order as typeof storeOrder.$inferSelect, items: await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, id)) as Array<typeof storeOrderItem.$inferSelect> }
}

/** The shop's customers (contacts of the customer type) with what each has ordered, as the admin's Customers page counts it. */
export async function apiCustomers(db: any, companyId: string, customerType: string, q: { after: string | null; limit: number }) {
  const orders = db.select({
    contactId: storeOrder.contactId,
    orderCount: sql<number>`count(*) filter (where ${storeOrder.status} <> 'pending')`.as('order_count'),
    totalSpentCents: sql<number>`coalesce(sum(${storeOrder.totalCents} - ${storeOrder.refundedCents}) filter (where ${storeOrder.status} not in ('pending','cancelled')), 0)`.as('total_spent_cents'),
    lastOrderAt: sql<Date | null>`max(${storeOrder.createdAt}) filter (where ${storeOrder.status} <> 'pending')`.as('last_order_at'),
  }).from(storeOrder).where(eq(storeOrder.companyId, companyId)).groupBy(storeOrder.contactId).as('o')
  const rows = await db.select({
    id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, createdAt: contact.createdAt, emailOptOut: contact.emailOptOut,
    orderCount: orders.orderCount, totalSpentCents: orders.totalSpentCents, lastOrderAt: orders.lastOrderAt,
  }).from(contact).leftJoin(orders, sql`${orders.contactId} = ${contact.id}`)
    .where(and(eq(contact.companyId, companyId), eq(contact.type, customerType), q.after ? gt(contact.id, q.after) : undefined))
    .orderBy(asc(contact.id)).limit(q.limit + 1)
  return page(rows, q.limit)
}

/** Every option with its count (no costs, no supplier). */
export async function apiInventory(db: any, companyId: string, q: { after: string | null; limit: number; sku: string | null }) {
  const rows = await db.select({
    id: storeProductVariant.id, productId: storeProduct.id, productName: storeProduct.name, sku: storeProductVariant.sku, name: storeProductVariant.name,
    inventoryQty: storeProductVariant.inventoryQty, updatedAt: storeProductVariant.updatedAt,
  }).from(storeProductVariant).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeProduct.companyId, companyId), q.after ? gt(storeProductVariant.id, q.after) : undefined, q.sku ? eq(storeProductVariant.sku, q.sku) : undefined))
    .orderBy(asc(storeProductVariant.id)).limit(q.limit + 1)
  return page(rows, q.limit)
}

export type StockWrite = { ok: true; id: string; sku: string; productName: string; before: number | null; after: number } | { ok: false; reason: 'not_found' | 'untracked' | 'changed'; now?: number | null }

/**
 * Set an option's count — or move it by a number — counted by the database in one statement. An option that does not count its stock
 * is refused (the owner switches counting on in the admin: a key must not decide what the shop tracks). `from` is the count the
 * caller saw: if the shelf has moved since, nothing is written ('changed'), as the admin's stock field does.
 */
export async function writeStock(db: any, companyId: string, variantId: string, w: { set: number } | { adjustBy: number }, from?: number): Promise<StockWrite> {
  const [v] = await db.select({ v: storeProductVariant, productName: storeProduct.name }).from(storeProductVariant).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeProductVariant.id, variantId), eq(storeProduct.companyId, companyId))).limit(1)
  if (!v) return { ok: false, reason: 'not_found' }
  if (v.v.inventoryQty === null) return { ok: false, reason: 'untracked' }
  const next = 'set' in w ? sql`${w.set}::int` : sql`GREATEST(0, ${storeProductVariant.inventoryQty} + ${w.adjustBy}::int)`
  const [row] = await db.update(storeProductVariant).set({ inventoryQty: next, updatedAt: new Date() } as any)
    .where(and(eq(storeProductVariant.id, variantId), isNotNull(storeProductVariant.inventoryQty), from === undefined ? undefined : eq(storeProductVariant.inventoryQty, from))).returning({ q: storeProductVariant.inventoryQty })
  if (!row) {
    const [now] = await db.select({ q: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, variantId)).limit(1)
    return { ok: false, reason: 'changed', now: now?.q ?? null }
  }
  return { ok: true, id: variantId, sku: v.v.sku, productName: v.productName, before: v.v.inventoryQty, after: row.q }
}
