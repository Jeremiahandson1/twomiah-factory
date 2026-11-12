// A voided label's refund, followed to its end (live test 11/12: a real USPS label voided on the store test site answered
// "submitted", and nothing ever asked again — the order said "refund requested" for good). USPS pays a voided label back
// some weeks later, or refuses it when the parcel was scanned after all; Shopify's order then reads "refunded" or
// "refund declined". Here: every 6 hours the carrier is asked about each label voided in the last 60 days whose refund is
// still submitted — on orders (./shipping.ts, Void label) and on cancelled returns (../returns/returns.ts) — and the
// answer is written back, with an audit line on the order when it settles. The shipment id stays on the row after a void
// for this. No carrier account connected: nothing is asked, and the row waits.
//
// Registered with d.services.addJob by ./index.ts (never in tests); the tests call pass() directly.
import { and, eq, gt, isNotNull } from 'drizzle-orm'
import { storeOrder, storeReturn } from '../../../db/schema/store.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'

/** How long a submitted refund is asked after: USPS settles within about a month; past this it is the carrier's to chase. */
export const FOLLOW_REFUNDS_DAYS = 60

const SAID: Record<string, string> = { refunded: 'refunded by the carrier', rejected: 'refused by the carrier — the postage was not paid back' }

export function createLabelRefundSweep(d: CrmDeps, core: StoreCore) {
  const { db, audit, logger } = d

  /** One pass. Returns how many refunds settled. */
  async function pass(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - FOLLOW_REFUNDS_DAYS * 24 * 60 * 60_000)
    const orders = await db.select({ id: storeOrder.id, companyId: storeOrder.companyId, orderNumber: storeOrder.orderNumber, shipmentId: storeOrder.labelShipmentId })
      .from(storeOrder).where(and(eq(storeOrder.labelRefundStatus, 'submitted'), isNotNull(storeOrder.labelShipmentId), gt(storeOrder.labelVoidedAt, since)))
    const returns = await db.select({ id: storeReturn.id, companyId: storeReturn.companyId, orderId: storeReturn.orderId, returnNumber: storeReturn.returnNumber, shipmentId: storeReturn.labelShipmentId })
      .from(storeReturn).where(and(eq(storeReturn.labelRefundStatus, 'submitted'), isNotNull(storeReturn.labelShipmentId), gt(storeReturn.labelVoidedAt, since)))
    if (!orders.length && !returns.length) return 0

    const carriers = new Map<string, Awaited<ReturnType<StoreCore['getActiveShipping']>>>()
    const carrierOf = async (companyId: string) => {
      if (!carriers.has(companyId)) carriers.set(companyId, await core.getActiveShipping(companyId).catch(() => null))
      return carriers.get(companyId)
    }
    const ask = async (companyId: string, shipmentId: string): Promise<string | null> => {
      const active = await carrierOf(companyId)
      if (!active) return null
      try {
        const s = (await active.provider.labelRefundStatus(shipmentId)).refundStatus
        return s === 'refunded' || s === 'rejected' ? s : null
      } catch (e: any) {
        logger.warn('[store] voided label refund not read', { shipmentId, error: e?.message })
        return null
      }
    }

    let settled = 0
    for (const o of orders) {
      const s = await ask(o.companyId, o.shipmentId!)
      if (!s) continue
      // Only while it is still this label's refund (a new label bought since clears the void fields).
      const [moved] = await db.update(storeOrder).set({ labelRefundStatus: s, updatedAt: new Date() })
        .where(and(eq(storeOrder.id, o.id), eq(storeOrder.labelRefundStatus, 'submitted'), eq(storeOrder.labelShipmentId, o.shipmentId!))).returning({ id: storeOrder.id })
      if (!moved) continue
      settled++
      await audit.log({ companyId: o.companyId, action: 'update', entity: 'order', entityId: o.id, entityName: o.orderNumber, metadata: { description: `Voided label's postage ${SAID[s]}`, refundStatus: s } })
    }
    for (const r of returns) {
      const s = await ask(r.companyId, r.shipmentId!)
      if (!s) continue
      const [moved] = await db.update(storeReturn).set({ labelRefundStatus: s, updatedAt: new Date() })
        .where(and(eq(storeReturn.id, r.id), eq(storeReturn.labelRefundStatus, 'submitted'), eq(storeReturn.labelShipmentId, r.shipmentId!))).returning({ id: storeReturn.id })
      if (!moved) continue
      settled++
      await audit.log({ companyId: r.companyId, action: 'update', entity: 'order', entityId: r.orderId, metadata: { description: `Return ${r.returnNumber}: its voided label's postage ${SAID[s]}`, returnId: r.id, refundStatus: s } })
    }
    return settled
  }

  return { pass }
}
