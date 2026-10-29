// The store's orders group's raw SQL (RULEBOOK §2), for server/crm/store/orders/: every sql fragment of
// templates/crm-store/backend/src/routes/orders.ts, one named function per query, each keeping its atomic or conditional
// guarantee — a refund is reserved, settled, released and restocked in ONE statement each, conditional on the order still
// standing where it was read, so two people (or a person and the 5-minute resume) can never refund or restock twice.
// Every function takes the database (or the open transaction) first and answers camelCase (Drizzle's .returning() and
// select shapes); an order is always the company's (company_id), its lines and refunds reached through it.
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { contact } from '../db/schema/index.ts'
import { storeOrder, storeOrderItem, storeOrderRefund, storeProductVariant } from '../db/schema/store.ts'
import { toPackCondition, atSupplierCondition, countedOrderCondition } from '../crm/store/tileConditions.ts'

type Order = typeof storeOrder.$inferSelect

/** Raw on purpose: inside an UPDATE of orders, "orders"."id" is the row being updated. No part refund still pending. */
const noPartInFlight = sql`not exists (select 1 from "order_refunds" r where r."order_id" = "orders"."id" and r."status" = 'pending')`

/**
 * The dashboard's figures for one company. A refunded sale still counts as revenue (the owner's refund model: the sale
 * happened, the refund is its own event), so what went back is counted beside it — every order with money sent back,
 * whole or in part (E2E Run 2).
 */
export async function orderStats(db: any, companyId: string): Promise<{ paidCount: number; pendingFulfillment: number; atSupplier: number; revenueCents: number; refundedCount: number; refundedCents: number }> {
  const [row] = await db.select({
    paidCount: sql<number>`count(*) filter (where ${countedOrderCondition(storeOrder)})`,
    pendingFulfillment: sql<number>`count(*) filter (where ${toPackCondition(storeOrder)})`,
    atSupplier: sql<number>`count(*) filter (where ${atSupplierCondition(storeOrder)})`,
    revenueCents: sql<number>`coalesce(sum(${storeOrder.totalCents}) filter (where ${storeOrder.status} not in ('pending','cancelled')), 0)`,
    refundedCount: sql<number>`count(*) filter (where ${storeOrder.status} not in ('pending','cancelled') and ${storeOrder.refundedCents} > 0)`,
    refundedCents: sql<number>`coalesce(sum(${storeOrder.refundedCents}) filter (where ${storeOrder.status} not in ('pending','cancelled')), 0)`,
  }).from(storeOrder).where(eq(storeOrder.companyId, companyId))
  return {
    paidCount: Number(row?.paidCount ?? 0), pendingFulfillment: Number(row?.pendingFulfillment ?? 0), atSupplier: Number(row?.atSupplier ?? 0),
    revenueCents: Number(row?.revenueCents ?? 0), refundedCount: Number(row?.refundedCount ?? 0), refundedCents: Number(row?.refundedCents ?? 0),
  }
}

/**
 * The store's customers (decision 2: a shopper is a contact): the company's 'customer' contacts, each with what they
 * have ordered — orders other than pending ones counted, spend counted from paid ones (not pending or cancelled), as the
 * template's derived list counted them — most recent buyer first. A page of them and how many there are.
 */
export async function storeCustomers(db: any, companyId: string, customerType: string, page: number, limit: number, q = ''): Promise<{ rows: { id: string; name: string; email: string | null; phone: string | null; orderCount: number; totalSpentCents: number; lastOrderAt: Date | null }[]; total: number }> {
  // ?q= finds a customer by name or email (a shop of thousands cannot pick one from a list) — 2026-10-24.
  const needle = q.trim() ? `%${q.trim().replace(/[\\%_]/g, (ch) => '\\' + ch)}%` : ''
  const mine = and(eq(contact.companyId, companyId), eq(contact.type, customerType), ...(needle ? [or(ilike(contact.name, needle), ilike(contact.email, needle))] : []))
  const orders = db.select({
    contactId: storeOrder.contactId,
    orderCount: sql<number>`count(*) filter (where ${storeOrder.status} <> 'pending')`.as('order_count'),
    // Spent is what they paid less what was refunded to them — the Dashboard's net (orderStats); a fully refunded order
    // counted in full here (store live test, 2026-10-26).
    totalSpentCents: sql<number>`coalesce(sum(${storeOrder.totalCents} - ${storeOrder.refundedCents}) filter (where ${storeOrder.status} not in ('pending','cancelled')), 0)`.as('total_spent_cents'),
    lastOrderAt: sql<Date | null>`max(${storeOrder.createdAt}) filter (where ${storeOrder.status} <> 'pending')`.as('last_order_at'),
  }).from(storeOrder).where(eq(storeOrder.companyId, companyId)).groupBy(storeOrder.contactId).as('o')
  const rows = await db.select({
    id: contact.id, name: contact.name, email: contact.email, phone: contact.phone,
    orderCount: orders.orderCount, totalSpentCents: orders.totalSpentCents, lastOrderAt: orders.lastOrderAt,
  }).from(contact).leftJoin(orders, eq(orders.contactId, contact.id)).where(mine)
    .orderBy(sql`${orders.lastOrderAt} desc nulls last`, desc(contact.createdAt), desc(contact.id))
    .limit(limit).offset((page - 1) * limit)
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(contact).where(mine)
  return {
    rows: rows.map((r: any) => ({ ...r, orderCount: Number(r.orderCount ?? 0), totalSpentCents: Number(r.totalSpentCents ?? 0), lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null })),
    total: Number(n),
  }
}

/**
 * Move an order from the status it was read in (TWO PEOPLE ON ONE ORDER: only the request that still finds it there
 * moves it). `whenNoPartInFlight` adds "no part refund still on its way" to the same statement — a refund of "the rest"
 * is worked out from what has gone back. The moved order, or null when someone else got there first.
 */
export async function moveOrderFrom(db: any, p: { orderId: string; companyId: string; from: string; patch: Record<string, unknown>; whenNoPartInFlight?: boolean }): Promise<Order | null> {
  const [row] = await db.update(storeOrder).set(p.patch as any)
    .where(and(eq(storeOrder.id, p.orderId), eq(storeOrder.companyId, p.companyId), eq(storeOrder.status, p.from), ...(p.whenNoPartInFlight ? [noPartInFlight] : [])))
    .returning()
  return row ?? null
}

/**
 * THE REFUND IS DONE: the refund stamp comes off, and the order's refundedCents becomes its total, as one write —
 * conditional on the stamp still being set, so whoever finishes a refund settles it exactly once. The order as it was
 * cleared, or null when another finisher got there first.
 */
export async function clearRefundStamp(tx: any, orderId: string, companyId: string, extra: Record<string, unknown>): Promise<Order | null> {
  const [row] = await tx.update(storeOrder).set({
    refundPendingAt: null, refundError: null, updatedAt: new Date(), refundedCents: sql`${storeOrder.totalCents}`, ...extra,
  } as any).where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId), sql`${storeOrder.refundPendingAt} is not null`)).returning()
  return row ?? null
}

/** Units back on the shelf, counted by the database. An untracked variant (inventory_qty null = unlimited) is skipped: false. */
export async function restockVariant(tx: any, variantId: string, quantity: number): Promise<boolean> {
  const back = await tx.update(storeProductVariant)
    .set({ inventoryQty: sql`${storeProductVariant.inventoryQty} + ${quantity}`, updatedAt: new Date() } as any)
    .where(and(eq(storeProductVariant.id, variantId), sql`${storeProductVariant.inventoryQty} is not null`))
    .returning({ id: storeProductVariant.id })
  return back.length > 0
}

/** The shipping already sent back on an order: every refund row of it that did not fail. */
export async function shippingRefundedCents(db: any, orderId: string): Promise<number> {
  const [row] = await db.select({ cents: sql<number>`coalesce(sum(${storeOrderRefund.shippingCents}), 0)` }).from(storeOrderRefund)
    .where(and(eq(storeOrderRefund.orderId, orderId), sql`${storeOrderRefund.status} <> 'failed'`))
  return Number(row?.cents ?? 0)
}

/**
 * RESERVE a part refund's money: the order's refundedCents goes up — only while the order stands where it was read
 * (status, refundedCents), no whole refund is under way, no other part is pending, and the total is never passed. Two
 * people at once can never refund past the total. True when reserved.
 */
export async function reservePartMoney(tx: any, p: { orderId: string; companyId: string; status: string; refundedCents: number; amountCents: number }): Promise<boolean> {
  const held = await tx.update(storeOrder).set({ refundedCents: sql`${storeOrder.refundedCents} + ${p.amountCents}`, updatedAt: new Date() } as any)
    .where(and(eq(storeOrder.id, p.orderId), eq(storeOrder.companyId, p.companyId), eq(storeOrder.status, p.status), eq(storeOrder.refundedCents, p.refundedCents),
      sql`${storeOrder.refundPendingAt} is null`, sql`${storeOrder.refundedCents} + ${p.amountCents} <= ${storeOrder.totalCents}`, noPartInFlight))
    .returning({ id: storeOrder.id })
  return held.length > 0
}

/** RESERVE a line's units: refundedQuantity goes up, never past what was bought. True when reserved. */
export async function reserveLineUnits(tx: any, orderItemId: string, orderId: string, quantity: number): Promise<boolean> {
  const ok = await tx.update(storeOrderItem).set({ refundedQuantity: sql`${storeOrderItem.refundedQuantity} + ${quantity}` } as any)
    .where(and(eq(storeOrderItem.id, orderItemId), eq(storeOrderItem.orderId, orderId), sql`${storeOrderItem.refundedQuantity} + ${quantity} <= ${storeOrderItem.quantity}`))
    .returning({ id: storeOrderItem.id })
  return ok.length > 0
}

/** A refused part: its money goes back off the order's refundedCents (never below 0). */
export async function releasePartMoney(tx: any, orderId: string, amountCents: number): Promise<void> {
  await tx.update(storeOrder).set({ refundedCents: sql`greatest(0, ${storeOrder.refundedCents} - ${amountCents})`, updatedAt: new Date() } as any)
    .where(eq(storeOrder.id, orderId))
}

/** A refused part: its units are refundable again (never below 0). */
export async function releaseLineUnits(tx: any, orderItemId: string, orderId: string, quantity: number): Promise<void> {
  await tx.update(storeOrderItem).set({ refundedQuantity: sql`greatest(0, ${storeOrderItem.refundedQuantity} - ${quantity})` } as any)
    .where(and(eq(storeOrderItem.id, orderItemId), eq(storeOrderItem.orderId, orderId)))
}

/** Nothing left to send back: the order is refunded, as a whole refund would have left it. True when this closed it. */
export async function closeFullyRefunded(tx: any, orderId: string, extra: Record<string, unknown>): Promise<boolean> {
  const closed = await tx.update(storeOrder).set({ status: 'refunded', updatedAt: new Date(), ...extra } as any)
    .where(and(eq(storeOrder.id, orderId), sql`${storeOrder.refundedCents} >= ${storeOrder.totalCents}`, sql`${storeOrder.status} in ('paid','fulfilled','shipped','delivered','ready_for_pickup','picked_up')`))
    .returning({ id: storeOrder.id })
  return closed.length > 0
}
