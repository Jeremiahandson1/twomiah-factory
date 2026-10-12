// Shipping labels: connect a carrier account, quote a parcel, buy a label.
// A bought label writes the same tracking fields manual fulfilment uses, so the
// existing "your order shipped" email fires unchanged.
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { orders, shippingConfig, storeSettings } from '../../db/schema.ts'
import { eq, and, or, isNull, lt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { encryptJSON } from '../lib/crypto.ts'
import { getActiveShipping, DEFAULT_PARCEL } from '../shipping/index.ts'
import { notifyShipped, orderForCaller, isFulfilment, refundRefusal, may, mayMove, moveRefusal } from './orders.ts'
import { requirePermission } from '../middleware/permissions.ts'
import logger from '../services/logger.ts'
import audit from '../services/audit.ts'
import { formatCents } from '../lib/money.ts'

const admin = new Hono()
// Reading the carrier set-up and buying a label for an order is the packing bench (shipping:label,
// staff); connecting, replacing or disconnecting the carrier account is shipping:configure, the manager's.
admin.use('*', authenticate, requirePermission('shipping:read'))

const addressSchema = z.object({
  name: z.string().optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2),
  phone: z.string().optional(),
})

const parcelSchema = z.object({
  lengthIn: z.number().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  weightOz: z.number().positive(),
})

// Never returns the key — only whether one is set, like the payments config.
admin.get('/config', async (c) => {
  const [cfg] = await db.select().from(shippingConfig).limit(1)
  if (!cfg) return c.json({ connected: false, provider: null, defaultParcel: DEFAULT_PARCEL, fromAddress: null })
  return c.json({
    connected: cfg.connected,
    provider: cfg.provider,
    mode: cfg.mode,
    defaultParcel: cfg.defaultParcel ?? DEFAULT_PARCEL,
    fromAddress: cfg.fromAddress,
  })
})

const connectSchema = z.object({
  provider: z.literal('easypost'),
  apiKey: z.string().min(8),
  mode: z.enum(['test', 'live']).default('test'),
  fromAddress: addressSchema,
  defaultParcel: parcelSchema.optional(),
})

admin.post('/config', requirePermission('shipping:configure'), async (c) => {
  const parsed = connectSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Provide an API key and a valid ship-from address' }, 400)

  const values = {
    provider: parsed.data.provider,
    mode: parsed.data.mode,
    credentialsEnc: encryptJSON({ apiKey: parsed.data.apiKey, mode: parsed.data.mode }),
    fromAddress: parsed.data.fromAddress as any,
    defaultParcel: (parsed.data.defaultParcel ?? DEFAULT_PARCEL) as any,
    connected: true,
    updatedAt: new Date(),
  }

  const [existing] = await db.select().from(shippingConfig).limit(1)
  if (existing) await db.update(shippingConfig).set(values).where(eq(shippingConfig.id, existing.id))
  else await db.insert(shippingConfig).values(values)
  return c.json({ ok: true, connected: true })
})

admin.delete('/config', requirePermission('shipping:configure'), async (c) => {
  const [existing] = await db.select().from(shippingConfig).limit(1)
  if (existing) {
    await db.update(shippingConfig)
      .set({ connected: false, updatedAt: new Date() })
      .where(eq(shippingConfig.id, existing.id))
  }
  return c.json({ ok: true, connected: false })
})

/**
 * WHO THE PARCEL IS FOR. (Live, EasyPost test mode, 10/12: a printed USPS label read "SHIP TO: 1 MAIN ST" with no name,
 * and UPS refused outright — "Missing or invalid ship to name".) Checkout stores the shopper's name and phone on the
 * order, not inside the address, and the address went to the carrier alone. The name and phone travel with it now.
 */
const shipTo = (order: typeof orders.$inferSelect) => ({
  ...(order.shippingAddress as any),
  name: (order.shippingAddress as any)?.name || order.customerName || '',
  phone: (order.shippingAddress as any)?.phone || order.customerPhone || undefined,
})

/** An order that cannot ship (pending, cancelled, refunded, delivered) is quoted and sold no label. */
const labelRefusal = (c: any, status: string) => c.json({ error: `This order is ${status}, so no label can be bought for it.`, code: 'no_parcel' }, 409)

/** Quotes for one order, so the merchant can see the price before buying. */
admin.get('/orders/:id/rates', requirePermission('shipping:label'), async (c) => {
  const active = await getActiveShipping()
  if (!active) return c.json({ error: 'No carrier account connected' }, 400)

  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  if (!order.shippingAddress) return c.json({ error: 'This order has no shipping address' }, 400)
  if (!mayMove(order.status, 'shipped')) return labelRefusal(c, order.status)

  try {
    const rates = await active.provider.getRates({
      from: active.fromAddress,
      to: shipTo(order),
      parcel: active.parcel,
    })
    return c.json({ data: rates })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not get rates' }, 502)
  }
})

/** How long a label purchase may be under way before another press is let through (see the claim below). */
const LABEL_CLAIM_MINUTES = 5

const buySchema = z.object({ rateId: z.string().optional(), markShipped: z.boolean().default(true) })

admin.post('/orders/:id/label', requirePermission('shipping:label'), async (c) => {
  const active = await getActiveShipping()
  if (!active) return c.json({ error: 'No carrier account connected' }, 400)

  const parsed = buySchema.safeParse(await c.req.json().catch(() => ({})))
  const body = parsed.success ? parsed.data : { rateId: undefined, markShipped: true }

  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  if (!order.shippingAddress) return c.json({ error: 'This order has no shipping address' }, 400)
  if (order.labelUrl) return c.json({ error: 'A label has already been bought for this order' }, 400)
  // A label is a parcel about to go out, with or without "mark shipped": only an order that can still ship gets one.
  // (Store QA T3: a cancelled order took tracking; markShipped: false let the carrier be paid for one as well.)
  if (!mayMove(order.status, 'shipped')) return labelRefusal(c, order.status)
  // Marking it shipped is a status change, and orders.ts's rule applies: an order nobody paid for is
  // not shipped from the packing bench.
  if (body.markShipped && !mayMove(order.status, 'shipped')) return moveRefusal(c, order.status, 'shipped')
  if (body.markShipped && !isFulfilment(order.status, 'shipped') && !may(c, 'orders:refund')) return refundRefusal(c)

  /**
   * ONE LABEL PER ORDER, EVEN FROM TWO SCREENS. The check above reads labelUrl, and the label is bought seconds later:
   * two people pressing Buy on the same order both found none and both were charged by the carrier. So the order is
   * CLAIMED first — label_purchased_at stamped only where no label exists and no purchase is under way — and only the
   * request that claims it calls the carrier. A claim left by a purchase that died half-way (the process restarted)
   * lapses after LABEL_CLAIM_MINUTES, so the order is never stuck without a way to buy one.
   */
  const [claimed] = await db.update(orders).set({ labelPurchasedAt: new Date() })
    .where(and(eq(orders.id, order.id), isNull(orders.labelUrl),
      or(isNull(orders.labelPurchasedAt), lt(orders.labelPurchasedAt, new Date(Date.now() - LABEL_CLAIM_MINUTES * 60_000)))))
    .returning({ id: orders.id })
  if (!claimed) return c.json({ error: 'A label is already being bought for this order — reload it in a moment.', code: 'label_in_progress' }, 409)

  try {
    const label = await active.provider.buyLabel({
      from: active.fromAddress,
      to: shipTo(order),
      parcel: active.parcel,
      rateId: body.rateId,
    })

    const patch: Record<string, unknown> = {
      labelUrl: label.labelUrl,
      labelCostCents: label.costCents,
      labelPurchasedAt: new Date(),
      // Same fields manual fulfilment writes, so the shipped email is unchanged.
      trackingCarrier: label.carrier,
      trackingNumber: label.trackingCode,
      updatedAt: new Date(),
    }
    // The label is bought and paid for, so it is always recorded. The order moves to shipped only from the status the
    // move was decided on: one cancelled or refunded while the carrier answered keeps its status (and its label, which
    // the shop can void with the carrier).
    const [recorded] = await db.update(orders).set(patch).where(eq(orders.id, order.id)).returning()
    let updated = recorded
    let shipped = false
    if (body.markShipped && order.status !== 'shipped') {
      const move: Record<string, unknown> = { status: 'shipped', updatedAt: new Date() }
      if (!order.fulfilledAt) move.fulfilledAt = new Date()
      const [moved] = await db.update(orders).set(move).where(and(eq(orders.id, order.id), eq(orders.status, order.status))).returning()
      if (moved) { updated = moved; shipped = true; void notifyShipped(moved) }
    }

    // In the log as what it was — not the floor's "Created — order": who bought which service, for how much, and the tracking.
    await audit.log({
      action: 'create', entity: 'order', entityId: order.id, entityName: order.orderNumber,
      metadata: { description: `Shipping label bought — ${label.carrier} ${label.service}, ${formatCents(label.costCents ?? 0, 'usd')}, tracking ${label.trackingCode}${shipped ? '; marked shipped, customer emailed' : ''}`, labelCostCents: label.costCents, trackingNumber: label.trackingCode },
      req: c,
    })
    return c.json({ label, order: orderForCaller(c, updated), ...(body.markShipped && order.status !== 'shipped' && !shipped ? { note: `The label was bought, but the order is now ${updated.status}, so it was not marked shipped.` } : {}) })
  } catch (err: any) {
    // Nothing was bought: release the claim so the next press can try again.
    await db.update(orders).set({ labelPurchasedAt: null }).where(and(eq(orders.id, order.id), isNull(orders.labelUrl))).catch(() => {})
    logger.error('label purchase failed', { orderId: order.id, error: err?.message })
    return c.json({ error: err?.message || 'Could not buy that label' }, 502)
  }
})

export default admin
