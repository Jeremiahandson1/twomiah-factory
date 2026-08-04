// Admin surface for the dropship supplier connection. Owner-only — connecting
// a supplier lets the store spend the merchant's money at that supplier.
import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { supplierConfig, variantSupplierMap, productVariants, orders } from '../../db/schema.ts'
import { authenticate, requireOwner } from '../middleware/auth.ts'
import { encryptJSON } from '../lib/crypto.ts'
import logger from '../services/logger.ts'
import { buildProvider, getActiveSupplier, forwardOrderToSupplier } from './index.ts'
import type { SupplierCredentials } from './types.ts'

const admin = new Hono()
admin.use('*', authenticate, requireOwner)

admin.get('/', async (c) => {
  const [cfg] = await db.select().from(supplierConfig).limit(1)
  return c.json({
    config: cfg ? { provider: cfg.provider, mode: cfg.mode, connected: cfg.connected, autoForward: cfg.autoForward } : null,
  })
})

const connectSchema = z.object({
  provider: z.enum(['printful', 'cj']),
  mode: z.enum(['test', 'live']).default('test'),
  apiKey: z.string().min(1),
  accountEmail: z.string().email().optional(), // CJ only
})

admin.post('/connect', async (c) => {
  const parsed = connectSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid supplier credentials' }, 400)
  const { provider, mode, apiKey, accountEmail } = parsed.data
  if (provider === 'cj' && !accountEmail) return c.json({ error: 'CJ needs your account email' }, 400)

  const creds: SupplierCredentials = { apiKey, accountEmail, mode, webhookToken: crypto.randomUUID().replace(/-/g, '') }
  const p = buildProvider(provider, creds)
  try {
    await p.verifyCredentials()
  } catch (err: any) {
    return c.json({ error: 'The supplier rejected these credentials: ' + (err?.message || 'unknown') }, 400)
  }

  // Auto-configure the supplier→store webhook (same philosophy as payments:
  // the merchant never creates a webhook by hand). Non-fatal on failure —
  // tracking falls back to the sweep poll.
  let webhookConfigured = false
  const backendUrl = (process.env.BACKEND_URL || '').replace(/\/$/, '')
  if (backendUrl) {
    try {
      const r = await p.setupWebhook(backendUrl + '/api/public/webhooks/supplier?t=' + creds.webhookToken)
      webhookConfigured = !!r
    } catch (err: any) {
      logger.warn('supplier webhook setup failed', { provider, error: err?.message })
    }
  }

  const values = { provider, mode, credentialsEnc: encryptJSON(creds), connected: true, updatedAt: new Date() }
  const [existing] = await db.select().from(supplierConfig).limit(1)
  const [saved] = existing
    ? await db.update(supplierConfig).set(values).where(eq(supplierConfig.id, existing.id)).returning()
    : await db.insert(supplierConfig).values(values).returning()

  return c.json({
    config: { provider: saved.provider, mode: saved.mode, connected: saved.connected, autoForward: saved.autoForward },
    webhookConfigured,
    trackingNote: webhookConfigured ? null : 'Tracking updates will sync on an hourly check instead of instantly.',
  })
})

admin.post('/disconnect', async (c) => {
  const [existing] = await db.select().from(supplierConfig).limit(1)
  if (existing) await db.update(supplierConfig).set({ connected: false, updatedAt: new Date() }).where(eq(supplierConfig.id, existing.id))
  return c.json({ ok: true })
})

admin.post('/auto-forward', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const enabled = body.enabled === true
  const [existing] = await db.select().from(supplierConfig).limit(1)
  if (!existing) return c.json({ error: 'No supplier configured' }, 400)
  await db.update(supplierConfig).set({ autoForward: enabled, updatedAt: new Date() }).where(eq(supplierConfig.id, existing.id))
  return c.json({ ok: true, autoForward: enabled })
})

// Validate + save a variant → supplier-item link. ref '' or null clears it.
admin.put('/variant-map/:variantId', async (c) => {
  const variantId = c.req.param('variantId')
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1)
  if (!variant) return c.json({ error: 'Variant not found' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const ref = typeof body.ref === 'string' ? body.ref.trim() : ''

  if (!ref) {
    await db.delete(variantSupplierMap).where(eq(variantSupplierMap.variantId, variantId))
    return c.json({ ok: true, cleared: true })
  }

  const active = await getActiveSupplier()
  if (!active) return c.json({ error: 'Connect a supplier first' }, 400)
  let name: string
  try {
    name = (await active.provider.validateVariantRef(ref)).name
  } catch (err: any) {
    return c.json({ error: err?.message || 'The supplier did not recognize that item' }, 400)
  }

  const [existing] = await db.select().from(variantSupplierMap).where(eq(variantSupplierMap.variantId, variantId)).limit(1)
  const values = { supplierVariantRef: ref, supplierItemName: name, updatedAt: new Date() }
  existing
    ? await db.update(variantSupplierMap).set(values).where(eq(variantSupplierMap.id, existing.id))
    : await db.insert(variantSupplierMap).values({ variantId, ...values })
  return c.json({ ok: true, name })
})

admin.get('/variant-map', async (c) => {
  const rows = await db.select().from(variantSupplierMap)
  return c.json({ map: rows })
})

// Manual forward (also the retry button) — bypasses autoForward but not 'hold'
// unless the merchant explicitly forwards, which IS the un-hold gesture.
admin.post('/orders/:id/forward', async (c) => {
  const result = await forwardOrderToSupplier(c.req.param('id'), { manual: true })
  return c.json(result, result.ok ? 200 : 400)
})

admin.post('/orders/:id/hold', async (c) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Not found' }, 404)
  if (order.supplierOrderId) return c.json({ error: 'Already forwarded to the supplier' }, 400)
  await db.update(orders).set({ supplierStatus: 'hold', updatedAt: new Date() }).where(eq(orders.id, order.id))
  return c.json({ ok: true })
})

export default admin
