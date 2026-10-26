// Shipping labels at /api/admin/shipping (access 'user'; ungated, as the store's every module): connect a carrier
// account, quote a parcel, buy a label. A bought label writes the same tracking fields manual fulfilment uses, so the
// "your order shipped" email fires unchanged. Moved from templates/crm-store/backend/src/routes/shipping.ts. Reading the
// carrier set-up and buying a label for an order is the packing bench (shipping:read, shipping:label — staff);
// connecting, replacing or disconnecting the carrier account is shipping:configure, the manager's.
//
// Changes from the template:
//   · the carrier connection and every order are the company's (company_id); another company's order is a 404;
//   · the carrier is the company's connected one (core.getActiveShipping), the shipped email core.notifyShipped;
//   · replies through server/http/reply.ts: POST /config { ok, connected } → { success, connected }; DELETE /config
//     { ok, connected: false } → { success, connected: false }; GET /orders/:id/rates { data } → { data, pagination };
//     GET /config and POST /orders/:id/label ({ label, order, note? }) unchanged; a body that does not parse is a 400 with
//     the template's sentence, code 'validation_failed' and `fields`;
//   · the bought label's audit row is the engine's audit (d.audit.log) and reads exactly as the template's.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { storeOrder, shippingConfig } from '../../../db/schema/store.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { DEFAULT_PARCEL, type StoreCore } from '../core.ts'
import { encryptJSON } from '../../../core/crypto.ts'
import { formatCents } from '../lib/money.ts'
import { isFulfilment, mayMove, moveRefusal, refundRefusal, seatOf, orderForSeat } from './rules.ts'

type Order = typeof storeOrder.$inferSelect

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

const connectSchema = z.object({
  provider: z.literal('easypost'),
  apiKey: z.string().min(8),
  mode: z.enum(['test', 'live']).default('test'),
  fromAddress: addressSchema,
  defaultParcel: parcelSchema.optional(),
})

/**
 * WHO THE PARCEL IS FOR. (Live, EasyPost test mode, 10/12: a printed USPS label read "SHIP TO: 1 MAIN ST" with no name,
 * and UPS refused outright — "Missing or invalid ship to name".) Checkout stores the shopper's name and phone on the
 * order, not inside the address, and the address went to the carrier alone. The name and phone travel with it now.
 */
const shipTo = (order: Order) => ({
  ...(order.shippingAddress as any),
  name: (order.shippingAddress as any)?.name || order.customerName || '',
  phone: (order.shippingAddress as any)?.phone || order.customerPhone || undefined,
})

/** An order that cannot ship (pending, cancelled, refunded, delivered) is quoted and sold no label. */
const labelRefusal = (c: Context, status: string) => fail(c, 409, `This order is ${status}, so no label can be bought for it.`, 'no_parcel')

/** How long a label purchase may be under way before another press is let through (see the claim below). */
const LABEL_CLAIM_MINUTES = 5

const buySchema = z.object({ rateId: z.string().optional(), markShipped: z.boolean().default(true) })

export function createShippingRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('shipping:read'))

  const own = (c: Context) => (c as any).get('user').companyId as string
  const configOf = async (companyId: string) =>
    (await db.select().from(shippingConfig).where(eq(shippingConfig.companyId, companyId)).limit(1))[0] as typeof shippingConfig.$inferSelect | undefined
  const orderOf = async (id: string, companyId: string): Promise<Order | undefined> =>
    (await db.select().from(storeOrder).where(and(eq(storeOrder.id, id), eq(storeOrder.companyId, companyId))).limit(1))[0]

  // Never returns the key — only whether one is set, like the payments config.
  app.get('/config', async (c) => {
    const cfg = await configOf(own(c))
    if (!cfg) return one(c, { connected: false, provider: null, defaultParcel: DEFAULT_PARCEL, fromAddress: null })
    return one(c, {
      connected: cfg.connected,
      provider: cfg.provider,
      mode: cfg.mode,
      defaultParcel: cfg.defaultParcel ?? DEFAULT_PARCEL,
      fromAddress: cfg.fromAddress,
    })
  })

  // The carrier account's API key is a credential: set or dropped only by the seats that hold the business's other
  // credentials (integrations:update — the owner; bda5a934a's rule, store live test 2026-10-26), not the manager's
  // shipping:configure, which keeps the shop's rates (catalog/settings.ts).
  app.post('/config', requirePermission('shipping:configure'), requirePermission('integrations:update'), async (c) => {
    const companyId = own(c)
    const parsed = connectSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      const fields: Record<string, string> = {}
      for (const i of parsed.error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
      return fail(c, 400, 'Provide an API key and a valid ship-from address', 'validation_failed', fields)
    }
    const values = {
      provider: parsed.data.provider,
      mode: parsed.data.mode,
      credentialsEnc: encryptJSON({ apiKey: parsed.data.apiKey, mode: parsed.data.mode }),
      fromAddress: parsed.data.fromAddress as any,
      defaultParcel: (parsed.data.defaultParcel ?? DEFAULT_PARCEL) as any,
      connected: true,
      updatedAt: new Date(),
    }
    const existing = await configOf(companyId)
    if (existing) await db.update(shippingConfig).set(values).where(and(eq(shippingConfig.id, existing.id), eq(shippingConfig.companyId, companyId)))
    else await db.insert(shippingConfig).values({ ...values, companyId })
    return one(c, { success: true, connected: true })
  })

  app.delete('/config', requirePermission('shipping:configure'), requirePermission('integrations:update'), async (c) => {
    const companyId = own(c)
    const existing = await configOf(companyId)
    if (existing) {
      await db.update(shippingConfig).set({ connected: false, updatedAt: new Date() })
        .where(and(eq(shippingConfig.id, existing.id), eq(shippingConfig.companyId, companyId)))
    }
    return one(c, { success: true, connected: false })
  })

  /** Quotes for one order, so the merchant can see the price before buying. */
  app.get('/orders/:id/rates', requirePermission('shipping:label'), async (c) => {
    const companyId = own(c)
    const active = await core.getActiveShipping(companyId)
    if (!active) return fail(c, 400, 'No carrier account connected')
    const order = await orderOf(c.req.param('id'), companyId)
    if (!order) return fail(c, 404, 'Order not found')
    if (!order.shippingAddress) return fail(c, 400, 'This order has no shipping address')
    if (!mayMove(order.status, 'shipped')) return labelRefusal(c, order.status)
    try {
      const rates = await active.provider.getRates({ from: active.fromAddress, to: shipTo(order), parcel: active.parcel })
      return listAll(c, rates)
    } catch (err: any) {
      return fail(c, 502, err?.message || 'Could not get rates')
    }
  })

  app.post('/orders/:id/label', requirePermission('shipping:label'), async (c) => {
    const companyId = own(c)
    const active = await core.getActiveShipping(companyId)
    if (!active) return fail(c, 400, 'No carrier account connected')

    const parsed = buySchema.safeParse(await c.req.json().catch(() => ({})))
    const body = parsed.success ? parsed.data : { rateId: undefined, markShipped: true }

    const order = await orderOf(c.req.param('id'), companyId)
    if (!order) return fail(c, 404, 'Order not found')
    if (!order.shippingAddress) return fail(c, 400, 'This order has no shipping address')
    if (order.labelUrl) return fail(c, 400, 'A label has already been bought for this order')
    // A label is a parcel about to go out, with or without "mark shipped": only an order that can still ship gets one.
    // (Store QA T3: a cancelled order took tracking; markShipped: false let the carrier be paid for one as well.)
    if (!mayMove(order.status, 'shipped')) return labelRefusal(c, order.status)
    // Marking it shipped is a status change, and the orders' rule applies: an order nobody paid for is
    // not shipped from the packing bench.
    const seat = await seatOf(d.permissions, c)
    if (body.markShipped && !mayMove(order.status, 'shipped')) return moveRefusal(c, order.status, 'shipped')
    if (body.markShipped && !isFulfilment(order.status, 'shipped') && !seat.refund) return refundRefusal(c)

    /**
     * ONE LABEL PER ORDER, EVEN FROM TWO SCREENS. The check above reads labelUrl, and the label is bought seconds later:
     * two people pressing Buy on the same order both found none and both were charged by the carrier. So the order is
     * CLAIMED first — label_purchased_at stamped only where no label exists and no purchase is under way — and only the
     * request that claims it calls the carrier. A claim left by a purchase that died half-way (the process restarted)
     * lapses after LABEL_CLAIM_MINUTES, so the order is never stuck without a way to buy one.
     */
    const mine = and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId))
    const claimed = await db.update(storeOrder).set({ labelPurchasedAt: new Date() })
      .where(and(mine, isNull(storeOrder.labelUrl),
        or(isNull(storeOrder.labelPurchasedAt), lt(storeOrder.labelPurchasedAt, new Date(Date.now() - LABEL_CLAIM_MINUTES * 60_000)))))
      .returning({ id: storeOrder.id })
    if (!claimed.length) return fail(c, 409, 'A label is already being bought for this order — reload it in a moment.', 'label_in_progress')

    try {
      const label = await active.provider.buyLabel({ from: active.fromAddress, to: shipTo(order), parcel: active.parcel, rateId: body.rateId })
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
      const [recorded]: Order[] = await db.update(storeOrder).set(patch).where(mine).returning()
      let updated = recorded
      let shipped = false
      if (body.markShipped && order.status !== 'shipped') {
        const move: Record<string, unknown> = { status: 'shipped', updatedAt: new Date() }
        if (!order.fulfilledAt) move.fulfilledAt = new Date()
        const [moved]: Order[] = await db.update(storeOrder).set(move).where(and(mine, eq(storeOrder.status, order.status))).returning()
        if (moved) { updated = moved; shipped = true; void core.notifyShipped(moved) }
      }

      // In the log as what it was — not the floor's "Created — order": who bought which service, for how much, and the tracking.
      await audit.log({
        action: 'create', entity: 'order', entityId: order.id, entityName: order.orderNumber,
        metadata: { description: `Shipping label bought — ${label.carrier} ${label.service}, ${formatCents(label.costCents ?? 0, 'usd')}, tracking ${label.trackingCode}${shipped ? '; marked shipped, customer emailed' : ''}`, labelCostCents: label.costCents, trackingNumber: label.trackingCode },
        req: c,
      })
      return one(c, { label, order: orderForSeat(seat, updated), ...(body.markShipped && order.status !== 'shipped' && !shipped ? { note: `The label was bought, but the order is now ${updated.status}, so it was not marked shipped.` } : {}) })
    } catch (err: any) {
      // Nothing was bought: release the claim so the next press can try again.
      await db.update(storeOrder).set({ labelPurchasedAt: null }).where(and(mine, isNull(storeOrder.labelUrl))).catch(() => {})
      logger.error('[store] label purchase failed', { orderId: order.id, error: err?.message })
      return fail(c, 502, err?.message || 'Could not buy that label')
    }
  })

  return app
}
