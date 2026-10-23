// The dropship supplier connection at /api/admin/suppliers (access 'user'; ungated): connect Printful or CJ, switch
// auto-forward, map a variant to the supplier's item, forward or hold an order. Owner's only (integrations:update) —
// connecting a supplier lets the store spend the merchant's money at that supplier. Moved from
// templates/crm-store/backend/src/suppliers/routes.ts; the forwarding itself and the hourly sweep are the store core's
// (core.forwardOrderToSupplier, core.sweepSupplierOrders — registered hourly by ./index.ts).
//
// Changes from the template:
//   · the connection, the orders and the variants are the company's: a variant is the company's through its product
//     (product_variants has no company_id), and the variant map lists only the company's variants; another company's
//     order or variant is a 404;
//   · the supplier is built by core's buildSupplierProvider, the connected one read by core.getActiveSupplier(companyId);
//   · replies through server/http/reply.ts:
//       GET /                         { config }                          → unchanged
//       POST /connect                 { config, webhookConfigured, trackingNote } → unchanged
//       POST /disconnect              { ok }                              → { success: true }
//       POST /auto-forward            { ok, autoForward }                 → { success: true, autoForward }
//       PUT /variant-map/:variantId   { ok, cleared } / { ok, name }      → { success: true, cleared } / { success: true, name }
//       GET /variant-map              { map }                             → { data, pagination }
//       POST /orders/:id/forward      { ok, note? } 200 / 400             → { success: true, note? }, or a 400 { error: note }
//       POST /orders/:id/hold         { ok }                              → { success: true }
//     a body that does not parse is a 400 with the template's sentence, code 'validation_failed' and `fields`.
import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { storeOrder, storeProduct, storeProductVariant, supplierConfig, variantSupplierMap } from '../../../db/schema/store.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { buildSupplierProvider, type StoreCore } from '../core.ts'
import { encryptJSON } from '../../../core/crypto.ts'
import type { SupplierCredentials } from '../suppliers/types.ts'

const connectSchema = z.object({
  provider: z.enum(['printful', 'cj']),
  mode: z.enum(['test', 'live']).default('test'),
  apiKey: z.string().min(1),
  accountEmail: z.string().email().optional(), // CJ only
})

const configView = (cfg: typeof supplierConfig.$inferSelect) => ({ provider: cfg.provider, mode: cfg.mode, connected: cfg.connected, autoForward: cfg.autoForward })

export function createSupplierRoutes(d: CrmDeps, core: StoreCore) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('integrations:update'))

  const own = (c: Context) => (c as any).get('user').companyId as string
  const configOf = async (companyId: string) =>
    (await db.select().from(supplierConfig).where(eq(supplierConfig.companyId, companyId)).limit(1))[0] as typeof supplierConfig.$inferSelect | undefined
  /** The company's variant: reached through its product. */
  const variantOf = async (variantId: string, companyId: string) =>
    (await db.select({ id: storeProductVariant.id }).from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(eq(storeProductVariant.id, variantId), eq(storeProduct.companyId, companyId))).limit(1))[0] as { id: string } | undefined

  app.get('/', async (c) => {
    const cfg = await configOf(own(c))
    return one(c, { config: cfg ? configView(cfg) : null })
  })

  app.post('/connect', async (c) => {
    const companyId = own(c)
    const parsed = connectSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      const fields: Record<string, string> = {}
      for (const i of parsed.error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
      return fail(c, 400, 'Invalid supplier credentials', 'validation_failed', fields)
    }
    const { provider, mode, apiKey, accountEmail } = parsed.data
    if (provider === 'cj' && !accountEmail) return fail(c, 400, 'CJ needs your account email', 'validation_failed', { accountEmail: 'CJ needs your account email' })

    const creds: SupplierCredentials = { apiKey, accountEmail, mode, webhookToken: crypto.randomUUID().replace(/-/g, '') }
    const p = buildSupplierProvider(provider, creds)
    try {
      await p.verifyCredentials()
    } catch (err: any) {
      return fail(c, 400, 'The supplier rejected these credentials: ' + (err?.message || 'unknown'))
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
        logger.warn('[store] supplier webhook setup failed', { provider, error: err?.message })
      }
    }

    const values = { provider, mode, credentialsEnc: encryptJSON(creds), connected: true, updatedAt: new Date() }
    const existing = await configOf(companyId)
    const [saved] = existing
      ? await db.update(supplierConfig).set(values).where(and(eq(supplierConfig.id, existing.id), eq(supplierConfig.companyId, companyId))).returning()
      : await db.insert(supplierConfig).values({ ...values, companyId }).returning()

    return one(c, {
      config: configView(saved),
      webhookConfigured,
      trackingNote: webhookConfigured ? null : 'Tracking updates will sync on an hourly check instead of instantly.',
    })
  })

  app.post('/disconnect', async (c) => {
    const companyId = own(c)
    const existing = await configOf(companyId)
    if (existing) await db.update(supplierConfig).set({ connected: false, updatedAt: new Date() }).where(and(eq(supplierConfig.id, existing.id), eq(supplierConfig.companyId, companyId)))
    return done(c)
  })

  app.post('/auto-forward', async (c) => {
    const companyId = own(c)
    const body = await c.req.json().catch(() => ({}))
    const enabled = body?.enabled === true
    const existing = await configOf(companyId)
    if (!existing) return fail(c, 400, 'No supplier configured')
    await db.update(supplierConfig).set({ autoForward: enabled, updatedAt: new Date() }).where(and(eq(supplierConfig.id, existing.id), eq(supplierConfig.companyId, companyId)))
    return one(c, { success: true, autoForward: enabled })
  })

  // Validate + save a variant → supplier-item link. ref '' or null clears it.
  app.put('/variant-map/:variantId', async (c) => {
    const companyId = own(c)
    const variantId = c.req.param('variantId')
    if (!(await variantOf(variantId, companyId))) return fail(c, 404, 'Variant not found')
    const body = await c.req.json().catch(() => ({}))
    const ref = typeof body?.ref === 'string' ? body.ref.trim() : ''

    if (!ref) {
      await db.delete(variantSupplierMap).where(eq(variantSupplierMap.variantId, variantId))
      return one(c, { success: true, cleared: true })
    }

    const active = await core.getActiveSupplier(companyId)
    if (!active) return fail(c, 400, 'Connect a supplier first')
    let name: string
    try {
      name = (await active.provider.validateVariantRef(ref)).name
    } catch (err: any) {
      return fail(c, 400, err?.message || 'The supplier did not recognize that item')
    }

    const [existing] = await db.select().from(variantSupplierMap).where(eq(variantSupplierMap.variantId, variantId)).limit(1)
    const values = { supplierVariantRef: ref, supplierItemName: name, updatedAt: new Date() }
    if (existing) await db.update(variantSupplierMap).set(values).where(eq(variantSupplierMap.id, existing.id))
    else await db.insert(variantSupplierMap).values({ variantId, ...values })
    return one(c, { success: true, name })
  })

  app.get('/variant-map', async (c) => {
    const rows = await db.select({
      id: variantSupplierMap.id, variantId: variantSupplierMap.variantId, supplierVariantRef: variantSupplierMap.supplierVariantRef,
      supplierItemName: variantSupplierMap.supplierItemName, updatedAt: variantSupplierMap.updatedAt,
    }).from(variantSupplierMap)
      .innerJoin(storeProductVariant, eq(storeProductVariant.id, variantSupplierMap.variantId))
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(eq(storeProduct.companyId, own(c)))
    return listAll(c, rows)
  })

  // Manual forward (also the retry button) — bypasses autoForward but not 'hold'
  // unless the merchant explicitly forwards, which IS the un-hold gesture.
  app.post('/orders/:id/forward', async (c) => {
    const result = await core.forwardOrderToSupplier(own(c), c.req.param('id'), { manual: true })
    if (!result.ok) return result.note === 'Order not found' ? fail(c, 404, 'Order not found') : fail(c, 400, result.note || 'Not forwarded')
    return one(c, { success: true, ...(result.note ? { note: result.note } : {}) })
  })

  app.post('/orders/:id/hold', async (c) => {
    const companyId = own(c)
    const [order] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, c.req.param('id')), eq(storeOrder.companyId, companyId))).limit(1)
    if (!order) return fail(c, 404, 'Not found')
    if (order.supplierOrderId) return fail(c, 400, 'Already forwarded to the supplier')
    await db.update(storeOrder).set({ supplierStatus: 'hold', updatedAt: new Date() }).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))
    return done(c)
  })

  return app
}
