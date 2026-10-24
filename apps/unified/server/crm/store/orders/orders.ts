// The back office's orders at /api/admin/orders (access 'user'; ungated — the store has no feature switches, everything
// is core): the list and the dashboard's figures, the store's customers, one order with its refund history, status
// changes (with the money back on a refund or a cancel), whole and part refunds and their Try again, and fulfilment
// (tracking, the note, "save & mark shipped"). Moved from templates/crm-store/backend/src/routes/orders.ts; the refund
// machinery is ./refunds.ts and the order's rules ./rules.ts. The registry signs the person in; every action keeps the
// template's permission (the whole router orders:read; status and fulfilment orders:update; refunds orders:refund).
//
// Changes from the template:
//   · every query is the company's (company_id); a line or a refund row is reached through an order of the company, so
//     another company's order is a 404;
//   · replies through server/http/reply.ts (RULEBOOK §3):
//       GET /                         { orders }            → { data, pagination } (all of them, one page)
//       GET /stats                    { stats }             → the stats object
//       GET /customers                { customers }         → { data, pagination } (see below)
//       GET /:id                      { order }             → the order (with items and refunds)
//       PATCH /:id/status             { order, refund? }    → unchanged (a record with two parts)
//       PATCH /:id/fulfillment        { order }             → the order
//       POST /:id/refunds/quote       { quote }             → the quote
//       POST /:id/refunds             { order, refund, restocked } → unchanged
//       POST /:id/refunds/:rid/retry  { order, refund }     → unchanged
//       POST /:id/refund/retry        { order, refund }     → unchanged
//     and errors keep their sentence and code but lose their extra fields: a refused refund's 502 no longer carries
//     `order` (the screen reloads the order on refund_failed / refund_unconfirmed), the over-the-total refusal no longer
//     carries `maxCents` (the sentence names it), and the refusals in ./rules.ts lose `allowed`, `status`, `required`;
//     a body that does not parse is a 400 with the template's sentence, code 'validation_failed' and `fields`;
//   · GET /customers (decision 2: the store's customers are the CRM's contacts): the company's 'customer' contacts, each
//     with its order count, spend and last order — the template derived them from orders by email; kept because the
//     store's Customers screen lists spend and orders, which the contacts list does not; ?page and ?limit (default 50);
//   · a part refund names its lines by the order item's id (text, cuid2) where the template required a uuid;
//   · a status save that changes nothing marks the request recorded (the engine's requestScope), so the write floor adds
//     no row (template audit.nothingToRecord); the fulfilment row's changes are the three boxes' own diff;
//   · the startup repair of fulfilment stamps (repairFulfilmentStamps) runs once at boot through d.services.addJob, not
//     when the module loads — see ./index.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { storeOrder, storeOrderRefund, type RefundLine } from '../../../db/schema/store.ts'
import { orderStats, storeCustomers, moveOrderFrom, reservePartMoney, reserveLineUnits, shippingRefundedCents } from '../../../data/storeOrders.ts'
import { requestScope } from '../../../core/audit.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { SHOPPER_TYPE } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import { COUNTED, hasParcel, isFulfilment, mayMove, moveRefusal, changedUnderYou, noParcelRefusal, refundRefusal, seatOf, orderForSeat, fitsFulfillment, fulfillmentRefusal } from './rules.ts'
import { createStoreGiftCards } from '../giftCards.ts'
import { emailItems, emailOrder } from '../emails.ts'
import { holdsRefund, quoteRefund, type MoneyBack, type OrderRefunds } from './refunds.ts'

type Order = typeof storeOrder.$inferSelect

/** A body that does not parse: the template's sentence, with each wrong box named (RULEBOOK §3). */
const badBody = (c: Context, sentence: string, error: z.ZodError) => {
  const fields: Record<string, string> = {}
  for (const i of error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
  return fail(c, 400, sentence, 'validation_failed', fields)
}

/**
 * This request changed nothing, so it leaves no row — not even the floor's. (Live, 10/12: a second Refund press on an
 * order already refunded answered 200 as a no-op, and the floor logged it as another 'Status changed', so the log read
 * like two refunds of one order.)
 */
const nothingToRecord = () => { const scope = requestScope.getStore(); if (scope) scope.logged = true }

const statusSchema = z.object({
  status: z.enum(['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded', 'ready_for_pickup', 'picked_up']),
})

const partSchema = z.object({
  items: z.array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(1) })).max(200).default([]),
  shippingCents: z.number().int().min(0).default(0),
  // Absent: the suggested amount. The owner may refund more or less than the units are worth (a goodwill refund).
  amountCents: z.number().int().min(1).optional(),
  restock: z.boolean().default(true),
  reason: z.string().trim().max(500).optional().nullable(),
})
type PartInput = z.infer<typeof partSchema>

const fulfillSchema = z.object({
  trackingCarrier: z.string().optional().nullable(),
  trackingNumber: z.string().optional().nullable(),
  internalNote: z.string().optional().nullable(),
  markShipped: z.boolean().optional(),
})

const partInFlightRefusal = (c: Context) => fail(c, 409,
  'A refund on this order is still on its way to the payment provider. Wait for it to finish (or press Try again on it), then refund the rest.',
  'refund_in_progress')
const partClosedRefusal = (c: Context, status: string) => fail(c, 409,
  status === 'pending' ? 'This order was never paid, so there is nothing to refund.' : `This order is ${status}; there is nothing left to refund.`,
  'nothing_to_refund')

/**
 * Rows a back-move left stamped. (Store QA T1, M1: "QA-ROLES-2 now carries a fulfilledAt … that I could not clear.")
 * Under the table in ./rules.ts a pending, paid or cancelled order has never been fulfilled — no move reaches those
 * statuses from a fulfilled one — so a stamp on one can only be what the old route left. Cleared once, at boot.
 */
export async function repairFulfilmentStamps(db: any, companyId: string): Promise<number> {
  const rows = await db.update(storeOrder).set({ fulfilledAt: null })
    .where(and(eq(storeOrder.companyId, companyId), inArray(storeOrder.status, ['pending', 'paid', 'cancelled']), isNotNull(storeOrder.fulfilledAt)))
    .returning({ id: storeOrder.id })
  return rows.length
}

export function createOrderRoutes(d: CrmDeps, core: StoreCore, refunds: OrderRefunds) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const giftCards = createStoreGiftCards(d, core)
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('orders:read'))

  /** The customer is told their pickup order is ready: the shop's pickup address and hours. Never throws. */
  const notifyReady = async (order: Order) => {
    const co = await core.shop()
    const s = await core.settings(order.companyId)
    const items = await refunds.itemsOf(order.id)
    await core.mail(order.customerEmail, 'storeReadyForPickup', {
      order: emailOrder(order), items: emailItems(items), supportEmail: co?.email, pickupAddress: s.pickupAddress, pickupHours: s.pickupHours,
    }, co?.email)
  }

  const own = (c: Context) => (c as any).get('user').companyId as string
  const statusOf = async (id: string, companyId: string) =>
    (await db.select({ status: storeOrder.status }).from(storeOrder).where(and(eq(storeOrder.id, id), eq(storeOrder.companyId, companyId))).limit(1))[0] as { status: string } | undefined

  // ── Orders ─────────────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const companyId = own(c)
    const status = c.req.query('status')
    const rows: Order[] = await db.select().from(storeOrder)
      .where(status ? and(eq(storeOrder.companyId, companyId), eq(storeOrder.status, status)) : eq(storeOrder.companyId, companyId))
      .orderBy(desc(storeOrder.createdAt), desc(storeOrder.id))
    const seat = await seatOf(d.permissions, c)
    const data = rows.map((o) => orderForSeat(seat, o))
    return listAll(c, data)
  })

  app.get('/stats', async (c) => {
    const row = await orderStats(db, own(c))
    const seat = await seatOf(d.permissions, c)
    return one(c, {
      paidCount: row.paidCount,
      pendingFulfillment: row.pendingFulfillment,
      atSupplier: row.atSupplier,
      // The shop's takings as one figure is revenue:read — staff see how many orders are waiting, not
      // what the business has taken. null, not 0: "no revenue" and "not yours to see" are different.
      revenueCents: seat.revenue ? row.revenueCents : null,
      /**
       * What went back. (Store QA T1, L3: "Revenue $25.00 / Orders 1 while the only orders are cancelled and refunded …
       * the dashboard shows no refund figure beside it.") Revenue keeps counting a refunded sale — the owner's refund
       * model: the sale happened, the refund is its own event — so the refund has to be on the screen too, or $25.00
       * reads as money the shop still has. Same seat rule as revenue: null when it is not theirs to see.
       */
      refundedCount: row.refundedCount,
      refundedCents: seat.revenue ? row.refundedCents : null,
      // What the shop has kept: the sales less what went back. (E2E Run 2: "Revenue $40.71" after a full refund.)
      netCents: seat.revenue ? row.revenueCents - row.refundedCents : null,
    })
  })

  // The store's customers: the CRM's contacts (decision 2), with what each has ordered.
  app.get('/customers', async (c) => {
    const page = Math.max(1, Number(c.req.query('page')) || 1)
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 50))
    const { rows, total } = await storeCustomers(db, own(c), d.settings?.contacts?.customerType || SHOPPER_TYPE, page, limit)
    return list(c, rows, { page, limit, total })
  })

  app.get('/:id', async (c) => {
    // With its refund history (order_refunds), oldest first.
    const order = await refunds.orderWithRefunds(c.req.param('id'), own(c))
    if (!order) return fail(c, 404, 'Not found')
    return one(c, orderForSeat(await seatOf(d.permissions, c), order))
  })

  app.patch('/:id/status', requirePermission('orders:update'), async (c) => {
    const companyId = own(c)
    const parsed = statusSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return badBody(c, 'Invalid status', parsed.error)
    const prev = await refunds.orderOf(c.req.param('id'), companyId)
    if (!prev) return fail(c, 404, 'Not found')
    const seat = await seatOf(d.permissions, c)
    const next = parsed.data.status
    // Already there: nothing moves, nothing is refunded, and nothing is written to the audit log.
    if (next === prev.status) { nothingToRecord(); return one(c, { order: orderForSeat(seat, prev) }) }
    if (!mayMove(prev.status, next)) return moveRefusal(c, prev.status, next)
    if (!fitsFulfillment(prev.fulfillment, next)) return fulfillmentRefusal(c, prev.fulfillment, next)
    if (!isFulfilment(prev.status, next) && !seat.refund) return refundRefusal(c)
    const patch: Record<string, unknown> = { status: next, updatedAt: new Date() }
    if (next === 'ready_for_pickup') patch.readyForPickupAt = new Date()
    if (next === 'picked_up') { patch.pickedUpAt = new Date(); if (!prev.fulfilledAt) patch.fulfilledAt = new Date() }
    // The FIRST fulfilment is the one recorded: packing and then shipping kept rewriting it.
    if ((next === 'fulfilled' || next === 'shipped') && !prev.fulfilledAt) patch.fulfilledAt = new Date()
    // A paid order cancelled before it went out was never fulfilled. (A refund after shipping keeps it: it did ship.)
    if (next === 'cancelled') patch.fulfilledAt = null
    // Only from the status this was decided on (changedUnderYou): a second person's change in between wins.
    // A paid order leaving for refunded/cancelled is stamped refundPendingAt in the SAME write: from here until the
    // provider has answered and the stock is back, the order says a refund is under way — so a crash in between is
    // finished by resumePendingRefunds rather than left reading "refunded" with the money still taken.
    const givesMoneyBack = (next === 'cancelled' || next === 'refunded') && COUNTED.includes(prev.status)
    if (givesMoneyBack) { patch.refundPendingAt = new Date(); patch.refundError = null }
    // "The rest" is worked out from what has gone back; a part refund still on its way would be counted in neither.
    if (givesMoneyBack && await refunds.partInFlight(prev.id)) return partInFlightRefusal(c)
    const updated = await moveOrderFrom(db, { orderId: prev.id, companyId, from: prev.status, patch, whenNoPartInFlight: givesMoneyBack })
    if (!updated) return changedUnderYou(c, await statusOf(prev.id, companyId), next)

    // The money goes back BEFORE the stock does, and only from the request that won the status change above — so two
    // presses, or a refund racing 'mark shipped', can never send money back for an order that did not move. If the
    // provider refuses, the order is put back exactly as it was and nothing is restocked. (See returnPayment.)
    let money: MoneyBack = { kind: 'not_paid' }
    let restocked = 0
    if (givesMoneyBack) {
      money = await refunds.returnPayment(prev)
      if (money.kind === 'failed') {
        await db.update(storeOrder).set({ status: prev.status, fulfilledAt: prev.fulfilledAt, refundPendingAt: null, updatedAt: new Date() })
          .where(and(eq(storeOrder.id, prev.id), eq(storeOrder.companyId, companyId), eq(storeOrder.status, next)))
        return fail(c, 502, `The payment could not be refunded, so the order is still ${prev.status} and nothing was restocked. ${money.reason}`, 'refund_failed')
      }
      if (holdsRefund(money)) {
        // Held by the provider: the order stays stamped, nothing is restocked, and the refund's id is kept to ask after it.
        if (money.kind === 'refunded') await db.update(storeOrder).set({ refundId: money.refundId, refundError: null, updatedAt: new Date() })
          .where(and(eq(storeOrder.id, prev.id), eq(storeOrder.companyId, companyId), isNotNull(storeOrder.refundPendingAt)))
      } else {
        const once = await refunds.settleRefundOnce(prev.id, companyId, money, await refunds.whoIs(c))
        restocked = once.restocked
        if (once.settled && money.kind === 'refunded' && !money.alreadyRefunded) void refunds.notifyLastRefund(prev.id, companyId, next === 'cancelled')
      }
    }

    // A pending order cancelled was never paid: a gift card it was holding gets its money back (once per order).
    if (next === 'cancelled' && prev.status === 'pending') await giftCards.release(prev, 'Order cancelled before it was paid')
    const final = givesMoneyBack ? (await refunds.orderOf(prev.id, companyId))! : updated
    await refunds.logStatusChange(c, prev, final, restocked, money)
    if (next === 'shipped' && prev.status !== 'shipped') void core.notifyShipped(updated)
    if (next === 'ready_for_pickup' && prev.status !== 'ready_for_pickup') void notifyReady(updated)
    return one(c, { order: orderForSeat(seat, final), ...(money.kind === 'not_paid' ? {} : { refund: money }) })
  })

  // The order page's "Try the refund again", for a refund the provider refused after the order had moved.
  app.post('/:id/refund/retry', requirePermission('orders:refund'), async (c) => {
    const companyId = own(c)
    const o = await refunds.orderOf(c.req.param('id'), companyId)
    if (!o) return fail(c, 404, 'Not found')
    const seat = await seatOf(d.permissions, c)
    if (!o.refundPendingAt) return one(c, { order: orderForSeat(seat, o), refund: null })
    const money = await refunds.finishRefund(o, 'Refund completed on a retry', undefined, c)
    const after = await refunds.orderOf(o.id, companyId)
    if (money.kind === 'failed') return fail(c, 502, `The refund still has not gone through. ${money.reason}`, 'refund_failed')
    return one(c, { order: orderForSeat(seat, after), refund: money })
  })

  // ── Part refunds ───────────────────────────────────────────────────────────
  /**
   * REFUND PART OF AN ORDER. (E2E Run 2: "There is no way to refund one item — Refund sends back the whole $40.71.")
   * As Shopify does it: pick the units (and, if it is going back, the shipping), the store suggests what they are worth,
   * the owner may change the amount, and only that goes back to the card. Each refund is a row of order_refunds.
   *
   *   1. RESERVE, in one transaction: the order's refundedCents and each line's refundedQuantity go up and the row is
   *      written 'pending' — conditional on the order still standing where it was read (status, refundedCents, no whole
   *      refund under way), so two people at once can never refund past the total or past a line's units.
   *   2. ASK the provider, with the row's own idempotency key (refund-<id>).
   *   3. SETTLE: the row becomes refunded (or recorded, for a provider whose refund is not built here), the chosen units
   *      go back on the shelf, and an order with nothing left to refund is marked refunded. Exactly once.
   *   A refusal gives the reservation back (the row reads failed). No answer at all keeps it pending: it may have gone
   *   through, so it is asked again — same key, same refund — by Try again or by resumePendingRefunds.
   */
  /** What the chosen units would come to — the dialog asks as the owner picks. Nothing is written. */
  app.post('/:id/refunds/quote', requirePermission('orders:refund'), async (c) => {
    const body = partSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return badBody(c, 'Choose the items and how many of each to refund.', body.error)
    const order = await refunds.orderOf(c.req.param('id'), own(c))
    if (!order) return fail(c, 404, 'Not found')
    const q = quoteRefund(order, await refunds.itemsOf(order.id), await shippingRefundedCents(db, order.id), body.data)
    if (!q.ok) return fail(c, 400, q.error, 'invalid_refund')
    return one(c, q.quote)
  })

  app.post('/:id/refunds', requirePermission('orders:refund'), async (c) => {
    const companyId = own(c)
    const body = partSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return badBody(c, 'Choose the items and how many of each to refund.', body.error)
    const input: PartInput = body.data
    const order = await refunds.orderOf(c.req.param('id'), companyId)
    if (!order) return fail(c, 404, 'Not found')
    if (!COUNTED.includes(order.status)) return partClosedRefusal(c, order.status)
    if (order.refundPendingAt) return partInFlightRefusal(c)
    if (await refunds.partInFlight(order.id)) return partInFlightRefusal(c)
    const items = await refunds.itemsOf(order.id)
    const q = quoteRefund(order, items, await shippingRefundedCents(db, order.id), input)
    if (!q.ok) return fail(c, 400, q.error, 'invalid_refund')
    const amountCents = input.amountCents ?? q.quote.suggestedCents
    if (amountCents <= 0) return fail(c, 400, 'Choose at least one item, the shipping, or an amount to refund.', 'invalid_refund')
    if (amountCents > q.quote.maxCents) return fail(c, 400, `At most ${formatCents(q.quote.maxCents, order.currency)} can still be refunded on this order.`, 'invalid_refund')

    // 1. Reserve. A line asked twice is one line.
    const merged = new Map<string, number>()
    for (const l of input.items) merged.set(l.orderItemId, (merged.get(l.orderItemId) || 0) + l.quantity)
    const lines: RefundLine[] = [...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity }))
    const by = await refunds.whoIs(c)
    class Moved extends Error {}
    let row: typeof storeOrderRefund.$inferSelect
    try {
      row = await db.transaction(async (tx: any) => {
        if (!(await reservePartMoney(tx, { orderId: order.id, companyId, status: order.status, refundedCents: order.refundedCents, amountCents }))) throw new Moved()
        for (const l of lines) if (!(await reserveLineUnits(tx, l.orderItemId, order.id, l.quantity))) throw new Moved()
        const [r] = await tx.insert(storeOrderRefund).values({
          orderId: order.id, amountCents, shippingCents: input.shippingCents, items: lines, restock: input.restock,
          reason: input.reason || null, status: 'pending', createdBy: by.userId, createdByName: by.name,
        }).returning()
        return r
      })
    } catch (e) {
      if (!(e instanceof Moved)) throw e
      return fail(c, 409, 'Someone else just refunded or changed this order, so this refund was not made. Reload the order to see what is left.', 'order_changed')
    }

    // 2 + 3.
    const { money, settled } = await refunds.sendPart(order, row, c, 'Part refund')
    if (money.kind === 'failed') {
      return money.refused
        ? fail(c, 502, `The refund was refused, so nothing was sent back and nothing was restocked. ${money.reason}`, 'refund_failed')
        : fail(c, 502, `We could not hear back from the payment provider, so this refund is waiting. It will be tried again automatically — or press Try again. It will never be sent twice. ${money.reason}`, 'refund_unconfirmed')
    }
    const after = await refunds.orderWithRefunds(order.id, companyId)
    return one(c, { order: orderForSeat(await seatOf(d.permissions, c), after), refund: money, restocked: settled?.restocked ?? 0 })
  })

  // The order page's Try again, for a part refund the provider did not answer. Same row, same key: never sent twice.
  app.post('/:id/refunds/:refundId/retry', requirePermission('orders:refund'), async (c) => {
    const companyId = own(c)
    const order = await refunds.orderOf(c.req.param('id'), companyId)
    if (!order) return fail(c, 404, 'Not found')
    const [row] = await db.select().from(storeOrderRefund)
      .where(and(eq(storeOrderRefund.id, c.req.param('refundId')), eq(storeOrderRefund.orderId, order.id))).limit(1)
    if (!row) return fail(c, 404, 'Not found')
    const seat = await seatOf(d.permissions, c)
    if (row.status !== 'pending') return one(c, { order: orderForSeat(seat, await refunds.orderWithRefunds(order.id, companyId)), refund: null })
    const { money } = await refunds.sendPart(order, row, c, 'Part refund (tried again)')
    if (money.kind === 'failed') return fail(c, 502, `The refund still has not gone through. ${money.reason}`, money.refused ? 'refund_failed' : 'refund_unconfirmed')
    return one(c, { order: orderForSeat(seat, await refunds.orderWithRefunds(order.id, companyId)), refund: money })
  })

  // ── Fulfilment ─────────────────────────────────────────────────────────────
  app.patch('/:id/fulfillment', requirePermission('orders:update'), async (c) => {
    const companyId = own(c)
    const parsed = fulfillSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return badBody(c, 'Invalid fulfillment', parsed.error)
    const prev = await refunds.orderOf(c.req.param('id'), companyId)
    if (!prev) return fail(c, 404, 'Not found')
    const seat = await seatOf(d.permissions, c)
    // "Save & mark shipped" is a status change too, and the same rules apply to it.
    if (parsed.data.markShipped && !mayMove(prev.status, 'shipped')) return moveRefusal(c, prev.status, 'shipped')
    if (parsed.data.markShipped && !fitsFulfillment(prev.fulfillment, 'shipped')) return fulfillmentRefusal(c, prev.fulfillment, 'shipped')
    if (parsed.data.markShipped && !isFulfilment(prev.status, 'shipped') && !seat.refund) return refundRefusal(c)
    // Tracking set to a value (not cleared) needs a parcel — see hasParcel.
    const tracks = !!(parsed.data.trackingCarrier?.trim() || parsed.data.trackingNumber?.trim())
    if (tracks && !hasParcel(prev)) return noParcelRefusal(c, prev.status)
    const { markShipped, ...boxes } = parsed.data
    const patch: Record<string, unknown> = { ...boxes, updatedAt: new Date() }
    if (markShipped) { patch.status = 'shipped'; if (!prev.fulfilledAt) patch.fulfilledAt = new Date() }
    // Marking it shipped, or giving it tracking, was decided from the status read above; a cancel or refund landing
    // since keeps the order as it now stands.
    const [updated]: Order[] = await db.update(storeOrder).set(patch)
      .where(markShipped || tracks
        ? and(eq(storeOrder.id, prev.id), eq(storeOrder.companyId, companyId), eq(storeOrder.status, prev.status))
        : and(eq(storeOrder.id, prev.id), eq(storeOrder.companyId, companyId)))
      .returning()
    if (!updated) {
      const now = await statusOf(prev.id, companyId)
      return markShipped ? changedUnderYou(c, now, 'shipped') : changedUnderYou(c, now, 'shipped', 'the tracking was not saved')
    }
    if (markShipped && prev.status !== 'shipped') await refunds.logStatusChange(c, prev, updated, 0)
    else {
      // The changes say it ("Tracking number: — → 1Z…"); a description would be read in their place.
      const changes = audit.diff(
        { trackingCarrier: prev.trackingCarrier, trackingNumber: prev.trackingNumber, internalNote: prev.internalNote },
        { trackingCarrier: updated.trackingCarrier, trackingNumber: updated.trackingNumber, internalNote: updated.internalNote },
      )
      await audit.log({
        action: 'update', entity: 'order', entityId: updated.id, entityName: updated.orderNumber,
        changes, metadata: changes ? null : { description: 'Fulfilment saved with no change' }, req: c,
      })
    }
    if (markShipped && prev.status !== 'shipped') void core.notifyShipped(updated)
    return one(c, orderForSeat(seat, updated))
  })

  return app
}
