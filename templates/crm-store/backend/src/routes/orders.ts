import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { orders, orderItems, storeSettings } from '../../db/schema.ts'
import { eq, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { sendOrderShipped } from '../services/email.ts'

const admin = new Hono()
admin.use('*', authenticate)

// Email the customer that their order shipped (with tracking). Non-blocking.
async function notifyShipped(order: typeof orders.$inferSelect): Promise<void> {
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
  return c.json({ orders: rows })
})

admin.get('/stats', async (c) => {
  const [row] = await db.select({
    paidCount: sql<number>`count(*) filter (where ${orders.status} not in ('pending','cancelled'))`,
    pendingFulfillment: sql<number>`count(*) filter (where ${orders.status} = 'paid')`,
    revenueCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} not in ('pending','cancelled')), 0)`,
  }).from(orders)
  return c.json({ stats: {
    paidCount: Number(row.paidCount),
    pendingFulfillment: Number(row.pendingFulfillment),
    revenueCents: Number(row.revenueCents),
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
  return c.json({ order: { ...order, items } })
})

const statusSchema = z.object({
  status: z.enum(['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']),
})

admin.patch('/:id/status', async (c) => {
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid status' }, 400)
  const [prev] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'Not found' }, 404)
  const patch: Record<string, unknown> = { status: parsed.data.status, updatedAt: new Date() }
  if (parsed.data.status === 'fulfilled' || parsed.data.status === 'shipped') patch.fulfilledAt = new Date()
  const [updated] = await db.update(orders).set(patch).where(eq(orders.id, prev.id)).returning()
  if (parsed.data.status === 'shipped' && prev.status !== 'shipped') void notifyShipped(updated)
  return c.json({ order: updated })
})

const fulfillSchema = z.object({
  trackingCarrier: z.string().optional().nullable(),
  trackingNumber: z.string().optional().nullable(),
  internalNote: z.string().optional().nullable(),
  markShipped: z.boolean().optional(),
})

admin.patch('/:id/fulfillment', async (c) => {
  const parsed = fulfillSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid fulfillment' }, 400)
  const [prev] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'Not found' }, 404)
  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  delete (patch as any).markShipped
  if (parsed.data.markShipped) { patch.status = 'shipped'; patch.fulfilledAt = new Date() }
  const [updated] = await db.update(orders).set(patch).where(eq(orders.id, prev.id)).returning()
  if (parsed.data.markShipped && prev.status !== 'shipped') void notifyShipped(updated)
  return c.json({ order: updated })
})

export default admin
