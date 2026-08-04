// Supplier registry + the order-forwarding core.
//
// forwardOrderToSupplier is called fire-and-forget from finalizeOrder (a
// forwarding failure must NEVER block payment finalization) and re-tried by
// the boot/interval sweep. Policy (locked in scope):
//  - forward only when a supplier is connected, autoForward is on, and EVERY
//    line item has a variant→supplier mapping (never partial-forward)
//  - unmapped orders get supplierStatus='unmapped' (merchant ships manually)
//  - failures get supplierStatus='error' + the message, and the sweep retries
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { orders, orderItems, supplierConfig, variantSupplierMap } from '../../db/schema.ts'
import { decryptJSON } from '../lib/crypto.ts'
import type { SupplierProvider, SupplierCredentials } from './types.ts'
import { PrintfulProvider } from './printful.ts'
import { CjProvider } from './cj.ts'
import logger from '../services/logger.ts'

export function buildProvider(provider: string, creds: SupplierCredentials): SupplierProvider {
  if (provider === 'printful') return new PrintfulProvider(creds)
  if (provider === 'cj') return new CjProvider(creds)
  throw new Error('Unknown supplier provider: ' + provider)
}

export async function getActiveSupplier(): Promise<{ provider: SupplierProvider; autoForward: boolean; creds: SupplierCredentials } | null> {
  const [cfg] = await db.select().from(supplierConfig).where(eq(supplierConfig.connected, true)).limit(1)
  if (!cfg) return null
  const creds = decryptJSON<SupplierCredentials>(cfg.credentialsEnc)
  creds.mode = (cfg.mode as 'test' | 'live') ?? 'test'
  return { provider: buildProvider(cfg.provider, creds), autoForward: cfg.autoForward, creds }
}

export async function forwardOrderToSupplier(orderId: string, opts: { manual?: boolean } = {}): Promise<{ ok: boolean; note?: string }> {
  const active = await getActiveSupplier()
  if (!active) return { ok: false, note: 'No supplier connected' }
  if (!active.autoForward && !opts.manual) return { ok: false, note: 'Auto-forward is off' }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return { ok: false, note: 'Order not found' }
  if (order.supplierOrderId) return { ok: true, note: 'Already forwarded' }
  if (order.supplierStatus === 'hold' && !opts.manual) return { ok: false, note: 'On hold' }
  if (order.status !== 'paid') return { ok: false, note: 'Order is not in paid status' }
  if (!order.shippingAddress) {
    await db.update(orders).set({ supplierStatus: 'error', supplierError: 'No shipping address on order', updatedAt: new Date() }).where(eq(orders.id, orderId))
    return { ok: false, note: 'No shipping address' }
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const variantIds = items.map(i => i.variantId).filter((v): v is string => !!v)
  const maps = variantIds.length
    ? await db.select().from(variantSupplierMap).where(inArray(variantSupplierMap.variantId, variantIds))
    : []
  const byVariant = new Map(maps.map(m => [m.variantId, m]))
  const unmapped = items.filter(i => !i.variantId || !byVariant.get(i.variantId))
  if (unmapped.length > 0) {
    await db.update(orders).set({ supplierStatus: 'unmapped', updatedAt: new Date() }).where(eq(orders.id, orderId))
    return { ok: false, note: 'Items without a supplier mapping: ' + unmapped.map(i => i.sku || i.productName).join(', ') }
  }

  try {
    const result = await active.provider.placeOrder({
      externalId: order.id,
      recipientName: order.customerName || order.customerEmail || 'Customer',
      email: order.customerEmail ?? null,
      phone: order.customerPhone ?? null,
      address: order.shippingAddress,
      items: items.map(i => ({
        supplierVariantRef: byVariant.get(i.variantId!)!.supplierVariantRef,
        quantity: i.quantity,
        name: i.productName,
        sku: i.sku || '',
      })),
    })
    await db.update(orders).set({
      supplierOrderId: result.supplierOrderId,
      supplierStatus: 'placed',
      supplierCostCents: result.costCents,
      supplierError: null,
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId))
    logger.info('supplier order placed', { orderId, supplier: active.provider.name, supplierOrderId: result.supplierOrderId })
    return { ok: true }
  } catch (err: any) {
    const msg = err?.message || 'supplier order failed'
    await db.update(orders).set({ supplierStatus: 'error', supplierError: msg, updatedAt: new Date() }).where(eq(orders.id, orderId))
    logger.warn('supplier forwarding failed', { orderId, error: msg })
    return { ok: false, note: msg }
  }
}

// Sweep: (1) retry paid orders that never forwarded or errored; (2) poll
// tracking for placed orders on providers without webhooks (CJ).
export async function sweepSupplierOrders(): Promise<void> {
  try {
    const active = await getActiveSupplier()
    if (!active) return

    if (active.autoForward) {
      const retriable = await db.select({ id: orders.id, supplierStatus: orders.supplierStatus }).from(orders)
        .where(and(eq(orders.status, 'paid'), isNull(orders.supplierOrderId)))
        .limit(25)
      for (const o of retriable) {
        if (o.supplierStatus === 'hold' || o.supplierStatus === 'unmapped') continue
        await forwardOrderToSupplier(o.id)
      }
    }

    const placed = await db.select().from(orders)
      .where(and(eq(orders.supplierStatus, 'placed'), eq(orders.status, 'paid')))
      .limit(25)
    for (const o of placed) {
      if (!o.supplierOrderId) continue
      try {
        const t = await active.provider.getTracking(o.supplierOrderId)
        if (t.shipped && t.trackingNumber) {
          const [updated] = await db.update(orders).set({
            status: 'shipped',
            supplierStatus: 'shipped',
            trackingCarrier: t.trackingCarrier,
            trackingNumber: t.trackingNumber,
            fulfilledAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(orders.id, o.id)).returning()
          const { notifyShipped } = await import('../routes/orders.ts')
          void notifyShipped(updated)
        }
      } catch (err: any) {
        logger.warn('supplier tracking poll failed', { orderId: o.id, error: err?.message })
      }
    }
  } catch (err: any) {
    logger.warn('supplier sweep failed', { error: err?.message })
  }
}
