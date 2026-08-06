// Shipping labels: connect a carrier account, quote a parcel, buy a label.
// A bought label writes the same tracking fields manual fulfilment uses, so the
// existing "your order shipped" email fires unchanged.
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { orders, shippingConfig, storeSettings } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { encryptJSON } from '../lib/crypto.ts'
import { getActiveShipping, DEFAULT_PARCEL } from '../shipping/index.ts'
import { notifyShipped } from './orders.ts'
import logger from '../services/logger.ts'

const admin = new Hono()
admin.use('*', authenticate)

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

admin.post('/config', async (c) => {
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

admin.delete('/config', async (c) => {
  const [existing] = await db.select().from(shippingConfig).limit(1)
  if (existing) {
    await db.update(shippingConfig)
      .set({ connected: false, updatedAt: new Date() })
      .where(eq(shippingConfig.id, existing.id))
  }
  return c.json({ ok: true, connected: false })
})

/** Quotes for one order, so the merchant can see the price before buying. */
admin.get('/orders/:id/rates', async (c) => {
  const active = await getActiveShipping()
  if (!active) return c.json({ error: 'No carrier account connected' }, 400)

  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  if (!order.shippingAddress) return c.json({ error: 'This order has no shipping address' }, 400)

  try {
    const rates = await active.provider.getRates({
      from: active.fromAddress,
      to: order.shippingAddress as any,
      parcel: active.parcel,
    })
    return c.json({ data: rates })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not get rates' }, 502)
  }
})

const buySchema = z.object({ rateId: z.string().optional(), markShipped: z.boolean().default(true) })

admin.post('/orders/:id/label', async (c) => {
  const active = await getActiveShipping()
  if (!active) return c.json({ error: 'No carrier account connected' }, 400)

  const parsed = buySchema.safeParse(await c.req.json().catch(() => ({})))
  const body = parsed.success ? parsed.data : { rateId: undefined, markShipped: true }

  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  if (!order.shippingAddress) return c.json({ error: 'This order has no shipping address' }, 400)
  if (order.labelUrl) return c.json({ error: 'A label has already been bought for this order' }, 400)

  try {
    const label = await active.provider.buyLabel({
      from: active.fromAddress,
      to: order.shippingAddress as any,
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
    if (body.markShipped) { patch.status = 'shipped'; patch.fulfilledAt = new Date() }

    const [updated] = await db.update(orders).set(patch).where(eq(orders.id, order.id)).returning()
    if (body.markShipped && order.status !== 'shipped') void notifyShipped(updated)

    return c.json({ label, order: updated })
  } catch (err: any) {
    logger.error('label purchase failed', { orderId: order.id, error: err?.message })
    return c.json({ error: err?.message || 'Could not buy that label' }, 502)
  }
})

export default admin
