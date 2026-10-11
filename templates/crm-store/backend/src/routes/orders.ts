import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { orders, orderItems, storeSettings, productVariants } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission } from '../middleware/permissions.ts'
import { sendOrderShipped } from '../services/email.ts'

const admin = new Hono()
admin.use('*', authenticate, requirePermission('orders:read'))

export const may = (c: any, permission: string) => hasPermission((c.get('user') as any)?.role, permission)

// What the shop paid its supplier, and the margin over it, is margin:read — the fleet's line for cost.
// Staff pack the order; they do not need to know what it cost us. (owner's decision, T42)
export const orderForCaller = (c: any, order: any) => {
  if (!order || may(c, 'margin:read')) return order
  const { supplierCostCents: _cost, ...rest } = order
  return rest
}

/**
 * A status change staff may make: moving a PAID order along the floor — fulfilled, shipped, delivered.
 * Everything else changes whether the order was paid for (cancel, refund, mark paid or pending, reopen a
 * cancelled one, ship one nobody paid for) and is orders:refund, the manager's and the owner's.
 */
const COUNTED = ['paid', 'fulfilled', 'shipped', 'delivered']
const FULFILMENT = ['fulfilled', 'shipped', 'delivered']
export const isFulfilment = (from: string, to: string) => COUNTED.includes(from) && FULFILMENT.includes(to)
/**
 * WHERE AN ORDER MAY GO NEXT. (Store QA T1, M1)
 *
 *   "A cancelled order moved to paid then shipped (200 each), and a refunded order moved back to paid. Setting the
 *    cancelled order back to cancelled left fulfilledAt populated."
 *
 * The status route checked WHO was asking and never WHERE the order stood, so anything could become anything. That
 * was not cosmetic: cancelling or refunding a paid order puts its units back on the shelf (below), and nothing
 * takes them out again — so "reopening" one sold stock the shop had already restored, and a refunded order read as
 * paid money that had gone back to the customer. Cancelled and refunded are where an order ends; a mistake there
 * is a new order, not a resurrection. Nothing ships before it is paid.
 *
 * This is the table the order screen has always offered (frontend OrderDetailPage NEXT_STATUS) — the server now
 * holds everyone to it, and tests/store/order-lifecycle.test.ts holds the two tables equal. A same-status save is
 * not a move and is allowed.
 */
export const NEXT_STATUS: Record<string, string[]> = {
  // an order taken offline is marked paid by the owner or a manager; one never paid for is cancelled
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
}
export const mayMove = (from: string, to: string) => from === to || (NEXT_STATUS[from] || []).includes(to)
export const moveRefusal = (c: any, from: string, to: string) => c.json({
  error: (NEXT_STATUS[from] || []).length
    ? `An order that is ${from} can be marked ${NEXT_STATUS[from].join(', ')} — not ${to}.`
    : `An order that is ${from} is closed and cannot be marked ${to}. If it should go ahead, take it as a new order.`,
  code: 'invalid_transition',
  allowed: NEXT_STATUS[from] || [],
}, 409)

export const refundRefusal = (c: any) => c.json({
  error: 'Cancelling, refunding or changing whether an order was paid is for a manager or the owner.',
  required: 'orders:refund',
}, 403)

// Email the customer that their order shipped (with tracking). Non-blocking.
export async function notifyShipped(order: typeof orders.$inferSelect): Promise<void> {
  try {
    const [settings] = await db.select().from(storeSettings).limit(1)
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
    await sendOrderShipped({
      order: {
        orderNumber: order.orderNumber, customerEmail: order.customerEmail, customerName: order.customerName,
        subtotalCents: order.subtotalCents, shippingCents: order.shippingCents, taxCents: order.taxCents,
        totalCents: order.totalCents, currency: order.currency, shippingAddress: order.shippingAddress,
        trackingCarrier: order.trackingCarrier, trackingNumber: order.trackingNumber,
      },
      items: items.map((it) => ({ productName: it.productName, variantName: it.variantName, quantity: it.quantity, lineTotalCents: it.lineTotalCents })),
      storeName: settings?.companyName || 'Our Store',
      supportEmail: settings?.supportEmail,
    })
  } catch { /* non-blocking */ }
}

// ── Orders ───────────────────────────────────────────────────────────────────
admin.get('/', async (c) => {
  const status = c.req.query('status')
  const rows = status
    ? await db.select().from(orders).where(eq(orders.status, status as any)).orderBy(desc(orders.createdAt))
    : await db.select().from(orders).orderBy(desc(orders.createdAt))
  return c.json({ orders: rows.map((o) => orderForCaller(c, o)) })
})

admin.get('/stats', async (c) => {
  const [row] = await db.select({
    paidCount: sql<number>`count(*) filter (where ${orders.status} not in ('pending','cancelled'))`,
    pendingFulfillment: sql<number>`count(*) filter (where ${orders.status} = 'paid')`,
    atSupplier: sql<number>`count(*) filter (where ${orders.supplierStatus} = 'placed')`,
    revenueCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} not in ('pending','cancelled')), 0)`,
    refundedCount: sql<number>`count(*) filter (where ${orders.status} = 'refunded')`,
    refundedCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = 'refunded'), 0)`,
  }).from(orders)
  return c.json({ stats: {
    paidCount: Number(row.paidCount),
    pendingFulfillment: Number(row.pendingFulfillment),
    atSupplier: Number(row.atSupplier),
    // The shop's takings as one figure is revenue:read — staff see how many orders are waiting, not
    // what the business has taken. null, not 0: "no revenue" and "not yours to see" are different.
    revenueCents: may(c, 'revenue:read') ? Number(row.revenueCents) : null,
    /**
     * What went back. (Store QA T1, L3: "Revenue $25.00 / Orders 1 while the only orders are cancelled and refunded …
     * the dashboard shows no refund figure beside it.") Revenue keeps counting a refunded sale — the owner's refund
     * model: the sale happened, the refund is its own event — so the refund has to be on the screen too, or $25.00
     * reads as money the shop still has. Same seat rule as revenue: null when it is not theirs to see.
     */
    refundedCount: Number(row.refundedCount),
    refundedCents: may(c, 'revenue:read') ? Number(row.refundedCents) : null,
  } })
})

// Derived customers (no separate table — orders snapshot customer info).
admin.get('/customers', async (c) => {
  const rows = await db.select({
    email: orders.customerEmail,
    name: sql<string>`max(${orders.customerName})`,
    phone: sql<string>`max(${orders.customerPhone})`,
    orderCount: sql<number>`count(*)`,
    totalSpentCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} not in ('pending','cancelled')), 0)`,
    lastOrderAt: sql<string>`max(${orders.createdAt})`,
  }).from(orders)
    .where(sql`${orders.status} not in ('pending')`)
    .groupBy(orders.customerEmail)
    .orderBy(desc(sql`max(${orders.createdAt})`))
  return c.json({ customers: rows.map((r) => ({ ...r, orderCount: Number(r.orderCount), totalSpentCents: Number(r.totalSpentCents) })) })
})

admin.get('/:id', async (c) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Not found' }, 404)
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  return c.json({ order: orderForCaller(c, { ...order, items }) })
})

const statusSchema = z.object({
  status: z.enum(['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']),
})

admin.patch('/:id/status', requirePermission('orders:update'), async (c) => {
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid status' }, 400)
  const [prev] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'Not found' }, 404)
  const next = parsed.data.status
  if (next === prev.status) return c.json({ order: orderForCaller(c, prev) })
  if (!mayMove(prev.status, next)) return moveRefusal(c, prev.status, next)
  if (!isFulfilment(prev.status, next) && !may(c, 'orders:refund')) return refundRefusal(c)
  const patch: Record<string, unknown> = { status: next, updatedAt: new Date() }
  // The FIRST fulfilment is the one recorded: packing and then shipping kept rewriting it.
  if ((next === 'fulfilled' || next === 'shipped') && !prev.fulfilledAt) patch.fulfilledAt = new Date()
  // A paid order cancelled before it went out was never fulfilled. (A refund after shipping keeps it: it did ship.)
  if (next === 'cancelled') patch.fulfilledAt = null
  const [updated] = await db.update(orders).set(patch).where(eq(orders.id, prev.id)).returning()

  // Restock when a previously-paid order is cancelled/refunded. Payment
  // (finalizeOrder) decremented inventoryQty for tracked variants, so reversing
  // to cancelled/refunded must add the units back — exactly once, and only from a
  // state that actually decremented: a still-'pending' order never counted, and an
  // order already cancelled/refunded must not double-restock. Untracked variants
  // (inventoryQty IS NULL = unlimited) are skipped by the WHERE guard. COUNTED is the module's own
  // list above — the same "this order was paid for" the permission rule reads.
  if ((next === 'cancelled' || next === 'refunded') && COUNTED.includes(prev.status)) {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, prev.id))
    for (const it of items) {
      if (!it.variantId) continue
      await db.update(productVariants)
        .set({ inventoryQty: sql`${productVariants.inventoryQty} + ${it.quantity}`, updatedAt: new Date() })
        .where(and(eq(productVariants.id, it.variantId), sql`${productVariants.inventoryQty} is not null`))
    }
  }

  if (next === 'shipped' && prev.status !== 'shipped') void notifyShipped(updated)
  return c.json({ order: orderForCaller(c, updated) })
})

const fulfillSchema = z.object({
  trackingCarrier: z.string().optional().nullable(),
  trackingNumber: z.string().optional().nullable(),
  internalNote: z.string().optional().nullable(),
  markShipped: z.boolean().optional(),
})

admin.patch('/:id/fulfillment', requirePermission('orders:update'), async (c) => {
  const parsed = fulfillSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid fulfillment' }, 400)
  const [prev] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'Not found' }, 404)
  // "Save & mark shipped" is a status change too, and the same rules apply to it.
  if (parsed.data.markShipped && !mayMove(prev.status, 'shipped')) return moveRefusal(c, prev.status, 'shipped')
  if (parsed.data.markShipped && !isFulfilment(prev.status, 'shipped') && !may(c, 'orders:refund')) return refundRefusal(c)
  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  delete (patch as any).markShipped
  if (parsed.data.markShipped) { patch.status = 'shipped'; if (!prev.fulfilledAt) patch.fulfilledAt = new Date() }
  const [updated] = await db.update(orders).set(patch).where(eq(orders.id, prev.id)).returning()
  if (parsed.data.markShipped && prev.status !== 'shipped') void notifyShipped(updated)
  return c.json({ order: orderForCaller(c, updated) })
})

/**
 * Rows a back-move left stamped. (Store QA T1, M1: "QA-ROLES-2 now carries a fulfilledAt … that I could not clear.")
 * Under the table above a pending, paid or cancelled order has never been fulfilled — no move reaches those
 * statuses from a fulfilled one — so a stamp on one can only be what the old route left. Cleared once, at startup.
 */
export async function repairFulfilmentStamps(): Promise<number> {
  const rows = await db.update(orders).set({ fulfilledAt: null })
    .where(and(sql`${orders.status} in ('pending','paid','cancelled')`, sql`${orders.fulfilledAt} is not null`))
    .returning({ id: orders.id })
  return rows.length
}
repairFulfilmentStamps()
  .then((n) => { if (n) console.log(`[orders] cleared the fulfilment stamp from ${n} order${n === 1 ? '' : 's'} that never went out`) })
  .catch((err) => console.error('[orders] fulfilment-stamp repair failed:', err?.message || err))

export default admin
