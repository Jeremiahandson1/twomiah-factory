// Returns and exchanges (2026-10-30, gap 8, behind the hidden feature store_returns). A shopper (signed in to their
// account) or a staff member asks to send some of an order back; the owner approves or declines; the goods are received;
// then the owner refunds (to the card, to store credit, or part of each) or sends an exchange. The statuses:
//   requested → approved | declined → received → refunded | exchanged      (cancelled: the shopper or staff, before received)
// A return started by staff begins approved (the person starting it is the approver).
//
// THE RULES, set by the owner (store_settings): a RETURN WINDOW (days after the order shipped, else was placed); a
// RESTOCKING FEE (a share of the goods' value) and a RETURN-SHIPPING FEE (a flat amount) kept from the refund — neither
// kept when the return is the shop's fault (defective, wrong item, not as described) or the owner waives them, and
// neither on an exchange; and whether the shop buys a prepaid RETURN LABEL (EasyPost) when it approves. The figures are
// worked out at approval and kept on the return, so changing the rule later changes no return already approved.
//
// THE MONEY is the order's own refund machinery, not a second one: a refund reserves the order's money and the returned
// units and writes an order_refunds row (orders/refunds.ts), which asks the provider, puts a gift-card share back on the
// card, and issues the store-credit share as a gift card (giftCards.issueCredit) — each once, under the row's key. An
// exchange is a zero-charge new order (source 'exchange', which is not a sale: the sales reports and the books skip it)
// for the replacement, plus a refund row for any difference; the replacement may not cost more than the goods returned.
//
// STOCK comes back when the parcel is RECEIVED (restocked_at, once), not when the money goes — and not at all if the owner
// says the goods are not fit to sell again.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { Context } from 'hono'
import { storeOrder, storeOrderItem, storeOrderRefund, storeProduct, storeProductVariant, storeReturn, storeSettings, type ReturnLine, type RefundLine } from '../../../db/schema/store.ts'
import { reservePartMoney, reserveLineUnits, restockVariant, shippingRefundedCents } from '../../../data/storeOrders.ts'
import { decrementStock } from '../../../data/storeCheckout.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import { orderNumberFor } from '../checkout/checkoutService.ts'
import { COUNTED } from '../orders/rules.ts'
import { quoteRefund, type OrderRefunds } from '../orders/refunds.ts'

type Order = typeof storeOrder.$inferSelect
type OrderItem = typeof storeOrderItem.$inferSelect
type Return = typeof storeReturn.$inferSelect

export const REASONS = ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other'] as const
export type ReturnReason = (typeof REASONS)[number]
export const REASON_LABEL: Record<ReturnReason, string> = {
  defective: 'Damaged or defective', wrong_item: 'Wrong item sent', not_as_described: 'Not as described', changed_mind: 'Changed my mind', other: 'Something else',
}
/** The shop's fault: no restocking fee and no return-shipping fee are kept. */
export const OUR_FAULT: ReadonlySet<string> = new Set(['defective', 'wrong_item', 'not_as_described'])
/** A return still being dealt with: its units are spoken for, so they cannot be asked for again. */
export const OPEN: readonly string[] = ['requested', 'approved', 'received']

export type ReturnPolicy = { windowDays: number; restockingFeeBps: number; returnShippingFeeCents: number; labels: boolean; shopperReturns: boolean }
export const DEFAULT_POLICY: ReturnPolicy = { windowDays: 30, restockingFeeBps: 0, returnShippingFeeCents: 0, labels: false, shopperReturns: true }
const DAY = 86_400_000

export type Who = { userId?: string | null; name?: string | null }
export type Refusal = { ok: false; status: 400 | 403 | 404 | 409 | 502; error: string; code: string }
const no = (status: Refusal['status'], error: string, code: string): Refusal => ({ ok: false, status, error, code })

/** What the figures are for a return, given the rule: the goods' value, what the shop keeps, what goes back. */
export function worth(policy: ReturnPolicy, input: { lineValueCents: number; reason: string; resolution: string; waive?: boolean }) {
  const free = input.waive || input.resolution === 'exchange' || OUR_FAULT.has(input.reason)
  const restocking = free ? 0 : Math.min(input.lineValueCents, Math.round((input.lineValueCents * policy.restockingFeeBps) / 10_000))
  const shipping = free ? 0 : Math.min(input.lineValueCents - restocking, Math.max(0, policy.returnShippingFeeCents))
  return { lineValueCents: input.lineValueCents, restockingFeeCents: restocking, returnShippingFeeCents: shipping, refundCents: input.lineValueCents - restocking - shipping }
}

/** Is this order inside its return window, and until when. The clock starts when it shipped, else when it was placed. */
export function windowOf(order: Pick<Order, 'fulfilledAt' | 'createdAt'>, policy: ReturnPolicy, now = new Date()): { open: boolean; endsAt: Date } {
  const endsAt = new Date(new Date(order.fulfilledAt ?? order.createdAt).getTime() + policy.windowDays * DAY)
  return { open: now.getTime() <= endsAt.getTime(), endsAt }
}

export function createStoreReturns(d: CrmDeps, core: StoreCore, refunds: OrderRefunds) {
  const { db, audit, logger } = d
  const log = (companyId: string, row: Record<string, unknown>, c?: Context | null) => audit.log({ ...row, companyId, ...(c ? { req: c } : {}) })

  async function policy(companyId: string): Promise<ReturnPolicy> {
    const [s] = await db.select().from(storeSettings).where(eq(storeSettings.companyId, companyId)).limit(1)
    if (!s) return DEFAULT_POLICY
    return { windowDays: s.returnWindowDays, restockingFeeBps: s.restockingFeeBps, returnShippingFeeCents: s.returnShippingFeeCents, labels: s.returnLabels, shopperReturns: s.shopperReturns }
  }
  async function savePolicy(companyId: string, p: ReturnPolicy): Promise<ReturnPolicy> {
    const patch = { returnWindowDays: p.windowDays, restockingFeeBps: p.restockingFeeBps, returnShippingFeeCents: p.returnShippingFeeCents, returnLabels: p.labels, shopperReturns: p.shopperReturns, updatedAt: new Date() }
    const had = await db.update(storeSettings).set(patch).where(eq(storeSettings.companyId, companyId)).returning({ id: storeSettings.id })
    if (!had.length) await db.insert(storeSettings).values({ companyId, ...patch })
    return policy(companyId)
  }

  const orderOf = (id: string, companyId: string) => refunds.orderOf(id, companyId)
  const returnOf = async (id: string, companyId: string): Promise<Return | null> =>
    (await db.select().from(storeReturn).where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId))).limit(1))[0] ?? null

  /** Units of this order already spoken for by a return that is still open. */
  async function reservedUnits(orderId: string): Promise<Map<string, number>> {
    const open: Return[] = await db.select().from(storeReturn).where(and(eq(storeReturn.orderId, orderId), inArray(storeReturn.status, [...OPEN])))
    const m = new Map<string, number>()
    for (const r of open) for (const l of r.items) m.set(l.orderItemId, (m.get(l.orderItemId) || 0) + l.quantity)
    return m
  }

  /** What of an order can still be sent back: each line's units left, and why a line or the whole order cannot. */
  async function returnable(order: Order, items: OrderItem[], pol: ReturnPolicy) {
    const reserved = await reservedUnits(order.id)
    const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))]
    const giftIds = new Set<string>()
    if (productIds.length) {
      const kinds: Array<{ id: string; kind: string }> = await db.select({ id: storeProduct.id, kind: storeProduct.kind }).from(storeProduct).where(inArray(storeProduct.id, productIds))
      for (const k of kinds) if (k.kind === 'gift_card') giftIds.add(k.id)
    }
    const win = windowOf(order, pol)
    let why: string | null = null
    if (!COUNTED.includes(order.status)) why = order.status === 'refunded' ? 'This order has been refunded.' : 'This order is not one that can be returned.'
    else if (order.source === 'exchange') why = 'This order was sent as an exchange.'
    else if (order.refundPendingAt) why = 'A refund on this order is still being sent.'
    const lines = items.map((i) => {
      const gift = !!i.productId && giftIds.has(i.productId)
      const left = gift ? 0 : Math.max(0, i.quantity - i.refundedQuantity - (reserved.get(i.id) || 0))
      return { orderItemId: i.id, productName: i.productName, variantName: i.variantName, quantity: i.quantity, left, unitPriceCents: i.unitPriceCents, imageUrl: i.imageUrl ?? null, note: gift ? 'Gift cards cannot be returned' : null }
    })
    return { open: !why, why, windowOpen: win.open, windowEndsAt: win.endsAt, lines }
  }

  // ── Starting one ───────────────────────────────────────────────────────────────────────────────────────────────────
  async function start(a: {
    companyId: string; order: Order; lines: ReturnLine[]; reason: ReturnReason; note?: string | null; wanted?: string | null
    resolution: 'refund' | 'exchange'; preferCredit?: boolean; startedBy: 'shopper' | 'staff'; byName?: string | null; allowLate?: boolean
  }, c?: Context | null): Promise<{ ok: true; ret: Return } | Refusal> {
    const pol = await policy(a.companyId)
    if (a.startedBy === 'shopper' && !pol.shopperReturns) return no(403, 'Returns are arranged with the shop directly. Please get in touch.', 'returns_by_staff')
    const items = await refunds.itemsOf(a.order.id)
    const can = await returnable(a.order, items, pol)
    if (!can.open) return no(409, can.why!, 'not_returnable')
    const late = !can.windowOpen
    if (late && !(a.startedBy === 'staff' && a.allowLate)) {
      return no(409, `The return window for this order closed on ${can.windowEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} (${pol.windowDays} days).`, 'window_closed')
    }
    const merged = new Map<string, number>()
    for (const l of a.lines) merged.set(l.orderItemId, (merged.get(l.orderItemId) || 0) + Math.floor(l.quantity))
    if (!merged.size) return no(400, 'Choose what you are sending back.', 'validation_failed')
    for (const [id, qty] of merged) {
      const line = can.lines.find((x) => x.orderItemId === id)
      if (!line) return no(400, 'One of those items is not on this order.', 'validation_failed')
      if (!(qty >= 1)) return no(400, 'Choose how many to send back.', 'validation_failed')
      if (line.note) return no(409, `${line.productName}: ${line.note}.`, 'not_returnable')
      if (qty > line.left) return no(409, line.left > 0 ? `Only ${line.left} of ${line.productName} can still be sent back.` : `${line.productName} has already been returned or is in a return.`, 'not_returnable')
    }
    const lines: ReturnLine[] = [...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity }))
    const q = quoteRefund(a.order, items, await shippingRefundedCents(db, a.order.id), { items: lines, shippingCents: 0 })
    if (!q.ok) return no(409, q.error, 'not_returnable')
    const id = createId()
    const staff = a.startedBy === 'staff'
    const figures = worth(pol, { lineValueCents: q.quote.suggestedCents, reason: a.reason, resolution: a.resolution })
    const [ret]: Return[] = await db.insert(storeReturn).values({
      id, companyId: a.companyId, orderId: a.order.id, contactId: a.order.contactId, returnNumber: `RET-${id.slice(0, 8).toUpperCase()}`,
      status: staff ? 'approved' : 'requested', startedBy: a.startedBy, startedByName: a.byName ?? null, resolution: a.resolution, reason: a.reason,
      note: a.note?.trim().slice(0, 1000) || null, wanted: a.wanted?.trim().slice(0, 500) || null, preferCredit: !!a.preferCredit, items: lines, late,
      ...figures, ...(staff ? { decidedAt: new Date(), decidedByName: a.byName ?? null } : {}),
    }).returning()
    await log(a.companyId, {
      action: 'create', entity: 'order', entityId: a.order.id, entityName: a.order.orderNumber,
      metadata: { description: `Return ${ret.returnNumber} ${staff ? 'started by staff' : 'requested by the shopper'}: ${lines.reduce((n, l) => n + l.quantity, 0)} unit(s), ${REASON_LABEL[a.reason]}${late ? ' (after the return window)' : ''}`, returnId: ret.id },
    }, c)
    if (staff) void tell(a.order, ret, 'Your return is approved', approvedWords(ret, null))
    else void notifyOwner(a.order, ret)
    return { ok: true, ret }
  }

  const approvedWords = (ret: Return, label: string | null) =>
    `we have approved your return ${ret.returnNumber}. ${label ? 'Print the label below, pack the items and send them back.' : 'Please send the items back to us and we will take it from there.'}${ret.restockingFeeCents + ret.returnShippingFeeCents > 0 ? ` ${formatCents(ret.restockingFeeCents + ret.returnShippingFeeCents)} will be kept from the refund (restocking and return postage).` : ''}`

  async function tell(order: Order, ret: Return, headline: string, message: string, labelUrl?: string | null) {
    try {
      const co = await core.shop()
      await core.mail(order.customerEmail, 'storeReturnUpdate', {
        order: { orderNumber: order.orderNumber, customerName: order.customerName, currency: order.currency }, returnNumber: ret.returnNumber, headline, message, labelUrl: labelUrl ?? ret.labelUrl, supportEmail: co?.email,
      }, co?.email)
    } catch { /* non-blocking */ }
  }
  /** The owner is told a shopper asked, at the shop's own email. */
  async function notifyOwner(order: Order, ret: Return) {
    try {
      const co = await core.shop()
      if (!co?.email) return
      await core.mail(co.email, 'storeReturnUpdate', {
        order: { orderNumber: order.orderNumber, customerName: 'there', currency: order.currency }, returnNumber: ret.returnNumber, headline: 'A customer wants to return something',
        message: `${order.customerName || order.customerEmail} asked to return ${ret.items.reduce((n, l) => n + l.quantity, 0)} item(s) from order ${order.orderNumber}: ${REASON_LABEL[ret.reason as ReturnReason] ?? ret.reason}. Open Returns to approve or decline it.`, supportEmail: null,
      })
    } catch { /* non-blocking */ }
  }

  // ── Deciding ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async function approve(companyId: string, id: string, a: { waiveFees?: boolean; staffNote?: string | null }, by: Who, c?: Context | null): Promise<{ ok: true; ret: Return; label: string | null } | Refusal> {
    const ret = await returnOf(id, companyId)
    if (!ret) return no(404, 'Not found', 'not_found')
    const order = await orderOf(ret.orderId, companyId)
    if (!order) return no(404, 'Not found', 'not_found')
    const pol = await policy(companyId)
    const items = await refunds.itemsOf(order.id)
    const q = quoteRefund(order, items, await shippingRefundedCents(db, order.id), { items: ret.items, shippingCents: 0 })
    // The order may have changed since it was asked (a refund made meanwhile): the value is worked out again.
    if (!q.ok) return no(409, q.error, 'not_returnable')
    const figures = worth(pol, { lineValueCents: q.quote.suggestedCents, reason: ret.reason, resolution: ret.resolution, waive: a.waiveFees })
    const [moved]: Return[] = await db.update(storeReturn).set({
      status: 'approved', decidedAt: new Date(), decidedByName: by.name ?? null, staffNote: a.staffNote?.trim().slice(0, 1000) || ret.staffNote, ...figures, updatedAt: new Date(),
    }).where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId), eq(storeReturn.status, 'requested'))).returning()
    if (!moved) return no(409, 'This return has already been decided.', 'already_decided')
    await log(companyId, { action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `Return ${moved.returnNumber} approved${a.waiveFees ? ' (fees waived)' : ''}`, returnId: moved.id } }, c)
    const bought = pol.labels ? await buyLabel(companyId, moved.id) : null
    const now = (await returnOf(id, companyId)) ?? moved
    void tell(order, now, 'Your return is approved', approvedWords(now, bought && bought.ok ? now.labelUrl : null), bought && bought.ok ? now.labelUrl : null)
    return { ok: true, ret: now, label: bought && !bought.ok ? bought.error : null }
  }

  async function decline(companyId: string, id: string, reason: string, by: Who, c?: Context | null): Promise<{ ok: true; ret: Return } | Refusal> {
    const text = reason.trim()
    if (!text) return no(400, 'Say why, so the customer is told.', 'validation_failed')
    const ret = await returnOf(id, companyId)
    if (!ret) return no(404, 'Not found', 'not_found')
    const order = await orderOf(ret.orderId, companyId)
    if (!order) return no(404, 'Not found', 'not_found')
    const [moved]: Return[] = await db.update(storeReturn).set({ status: 'declined', declineReason: text.slice(0, 500), decidedAt: new Date(), decidedByName: by.name ?? null, closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId), eq(storeReturn.status, 'requested'))).returning()
    if (!moved) return no(409, 'This return has already been decided.', 'already_decided')
    await log(companyId, { action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `Return ${moved.returnNumber} declined: ${text}`, returnId: moved.id } }, c)
    void tell(order, moved, 'Your return was not approved', `we could not approve return ${moved.returnNumber}. ${text}`)
    return { ok: true, ret: moved }
  }

  /** The shopper changes their mind, or staff close one that will not happen: only before the goods are received. */
  async function cancel(companyId: string, id: string, by: Who & { shopperContactId?: string }, c?: Context | null): Promise<{ ok: true; ret: Return } | Refusal> {
    const ret = await returnOf(id, companyId)
    if (!ret || (by.shopperContactId && ret.contactId !== by.shopperContactId)) return no(404, 'Not found', 'not_found')
    const [moved]: Return[] = await db.update(storeReturn).set({ status: 'cancelled', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId), inArray(storeReturn.status, ['requested', 'approved']))).returning()
    if (!moved) return no(409, 'This return can no longer be cancelled.', 'cannot_cancel')
    await log(companyId, { action: 'update', entity: 'order', entityId: ret.orderId, metadata: { description: `Return ${moved.returnNumber} cancelled${by.shopperContactId ? ' by the shopper' : ''}`, returnId: moved.id } }, c)
    return { ok: true, ret: moved }
  }

  // ── The prepaid label ──────────────────────────────────────────────────────────────────────────────────────────────
  /** Buy the shopper a return label (the parcel goes from where the order was sent back to the shop). Once: claimed first. */
  async function buyLabel(companyId: string, id: string): Promise<{ ok: true } | Refusal> {
    const ret = await returnOf(id, companyId)
    if (!ret) return no(404, 'Not found', 'not_found')
    if (ret.status !== 'approved') return no(409, 'Only an approved return gets a label.', 'wrong_status')
    if (ret.labelUrl) return { ok: true }
    const order = await orderOf(ret.orderId, companyId)
    const active = await core.getActiveShipping(companyId).catch(() => null)
    if (!order || !active) return no(409, 'Connect a shipping carrier (Shipping) to buy return labels.', 'no_carrier')
    const home = order.shippingAddress as any
    if (!home?.line1) return no(409, 'This order has no address to send a label from.', 'no_address')
    const [claimed] = await db.update(storeReturn).set({ labelClaimedAt: new Date() })
      .where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId), eq(storeReturn.status, 'approved'), isNull(storeReturn.labelClaimedAt))).returning({ id: storeReturn.id })
    if (!claimed) return no(409, 'A label is already being bought for this return.', 'label_in_progress')
    try {
      const label = await active.provider.buyLabel({
        from: { ...home, name: home.name || order.customerName || '', phone: home.phone || order.customerPhone || undefined }, to: active.fromAddress, parcel: active.parcel,
      })
      await db.update(storeReturn).set({ labelUrl: label.labelUrl, labelTracking: label.trackingCode, labelCarrier: label.carrier, labelCostCents: label.costCents, updatedAt: new Date() }).where(eq(storeReturn.id, id))
      return { ok: true }
    } catch (e: any) {
      await db.update(storeReturn).set({ labelClaimedAt: null }).where(eq(storeReturn.id, id))
      logger.warn('[store] return label not bought', { returnId: id, error: e?.message })
      return no(502, `The carrier said: ${String(e?.message || 'no reason given').slice(0, 300)}`, 'label_failed')
    }
  }

  // ── Receiving ──────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The parcel is here. The units go back on the shelf now (once), unless the owner says they cannot be sold again. */
  async function receive(companyId: string, id: string, a: { restock: boolean; staffNote?: string | null }, by: Who, c?: Context | null): Promise<{ ok: true; ret: Return; restocked: number } | Refusal> {
    let restocked = 0
    const moved: Return | null = await db.transaction(async (tx: any) => {
      const [row]: Return[] = await tx.update(storeReturn).set({
        status: 'received', receivedAt: new Date(), receivedByName: by.name ?? null, staffNote: a.staffNote?.trim().slice(0, 1000) || undefined, ...(a.restock ? { restockedAt: new Date() } : {}), updatedAt: new Date(),
      }).where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId), eq(storeReturn.status, 'approved'))).returning()
      if (!row) return null
      if (a.restock) {
        for (const l of row.items) {
          const [it] = await tx.select({ variantId: storeOrderItem.variantId }).from(storeOrderItem).where(and(eq(storeOrderItem.id, l.orderItemId), eq(storeOrderItem.orderId, row.orderId))).limit(1)
          if (it?.variantId && (await restockVariant(tx, it.variantId, l.quantity))) restocked += l.quantity
        }
      }
      return row
    })
    if (!moved) {
      const had = await returnOf(id, companyId)
      return had ? no(409, 'This return is not waiting to be received.', 'wrong_status') : no(404, 'Not found', 'not_found')
    }
    const order = await orderOf(moved.orderId, companyId)
    if (order) {
      await log(companyId, { action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `Return ${moved.returnNumber} received${restocked ? `, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : a.restock ? '' : ', not restocked'}`, returnId: moved.id, restocked } }, c)
      void tell(order, moved, 'We received your return', `we received return ${moved.returnNumber}. ${moved.resolution === 'exchange' ? 'We will send your exchange shortly.' : 'Your refund is on its way.'}`)
    }
    return { ok: true, ret: moved, restocked }
  }

  // ── Money back ─────────────────────────────────────────────────────────────────────────────────────────────────────
  class Moved extends Error {}
  /**
   * Inside a transaction: spoken for before anything is asked of the provider — the order's money (only while it stands
   * where it was read), the returned units, and the refund row. A row of no money is written already settled.
   */
  async function reserve(tx: any, order: Order, ret: Return, amountCents: number, creditCents: number, by: Who): Promise<typeof storeOrderRefund.$inferSelect> {
    if (amountCents > 0 && !(await reservePartMoney(tx, { orderId: order.id, companyId: order.companyId, status: order.status, refundedCents: order.refundedCents, amountCents }))) throw new Moved()
    for (const l of ret.items) if (!(await reserveLineUnits(tx, l.orderItemId, order.id, l.quantity))) throw new Moved()
    const lines: RefundLine[] = ret.items.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity }))
    const [row] = await tx.insert(storeOrderRefund).values({
      orderId: order.id, amountCents, shippingCents: 0, items: lines, restock: false, reason: `Return ${ret.returnNumber}`, creditCents,
      status: amountCents > 0 ? 'pending' : 'recorded', moneyBack: amountCents > 0 ? null : 'none', settledAt: amountCents > 0 ? null : new Date(), createdBy: by.userId ?? null, createdByName: by.name ?? null,
    }).returning()
    return row
  }

  async function failed(order: Order, row: typeof storeOrderRefund.$inferSelect, money: { kind: 'failed'; reason: string; refused: boolean }): Promise<Refusal> {
    await reconcile(order.companyId, row.id, null)
    return money.refused
      ? no(502, `The refund was refused, so nothing was sent back. ${money.reason}`, 'refund_failed')
      : no(502, `We could not hear back from the payment provider, so this refund is waiting. It will be tried again automatically — or press Refund again. It will never be sent twice. ${money.reason}`, 'refund_unconfirmed')
  }

  /** Refund the return: to the card, to store credit, or part of each. Once. */
  async function refund(companyId: string, id: string, a: { amountCents?: number; creditCents?: number }, by: Who, c?: Context | null): Promise<{ ok: true; ret: Return; pending: boolean } | Refusal> {
    let ret = await reconcile(companyId, null, id)
    if (!ret) return no(404, 'Not found', 'not_found')
    if (ret.status === 'refunded') return no(409, 'This return has already been refunded.', 'already_refunded')
    if (ret.status !== 'received') return no(409, 'Receive the goods before refunding them.', 'wrong_status')
    const order = await orderOf(ret.orderId, companyId)
    if (!order) return no(404, 'Not found', 'not_found')
    if (order.refundPendingAt || (await refunds.partInFlight(order.id))) return no(409, 'Another refund on this order is still on its way. Wait for it to finish.', 'refund_in_flight')
    // A refund already reserved for this return that is still on its way is asked again, never made twice.
    if (ret.refundRowId) {
      const [row] = await db.select().from(storeOrderRefund).where(eq(storeOrderRefund.id, ret.refundRowId)).limit(1)
      if (row?.status === 'pending') {
        const { money } = await refunds.sendPart(order, row, c ?? null, 'Return refund (tried again)')
        if (money.kind === 'failed') return failed(order, row, money)
        ret = (await reconcile(companyId, null, id))!
        return { ok: true, ret, pending: ret.status !== 'refunded' }
      }
    }
    const amount = a.amountCents ?? ret.refundCents
    if (!(Number.isInteger(amount) && amount >= 0)) return no(400, 'Enter the amount to refund.', 'validation_failed')
    if (amount > order.totalCents - order.refundedCents) return no(409, `At most ${formatCents(order.totalCents - order.refundedCents, order.currency)} can still be refunded on this order.`, 'invalid_refund')
    const credit = a.creditCents ?? (ret.preferCredit ? amount : 0)
    if (!(Number.isInteger(credit) && credit >= 0 && credit <= amount)) return no(400, 'The store credit cannot be more than the refund.', 'validation_failed')
    let row: typeof storeOrderRefund.$inferSelect
    try {
      row = await db.transaction(async (tx: any) => {
        const [locked]: Return[] = await tx.select().from(storeReturn).where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId))).limit(1).for('update')
        if (!locked || locked.status !== 'received' || locked.refundRowId) throw new Moved()
        const made = await reserve(tx, order, locked, amount, credit, by)
        await tx.update(storeReturn).set({ refundRowId: made.id, refundCents: amount, creditCents: credit, updatedAt: new Date() }).where(eq(storeReturn.id, id))
        return made
      })
    } catch (e) {
      if (!(e instanceof Moved)) throw e
      return no(409, 'Someone else just changed this order or return, so nothing was refunded. Reload it to see where it stands.', 'order_changed')
    }
    if (amount === 0) {
      await finish(companyId, id, 'refunded', c)
      return { ok: true, ret: (await returnOf(id, companyId))!, pending: false }
    }
    const { money } = await refunds.sendPart(order, row, c ?? null, 'Return refund')
    if (money.kind === 'failed') return failed(order, row, money)
    ret = (await reconcile(companyId, null, id))!
    return { ok: true, ret, pending: ret.status !== 'refunded' }
  }

  async function finish(companyId: string, id: string, to: 'refunded' | 'exchanged', c?: Context | null): Promise<Return | null> {
    const [done]: Return[] = await db.update(storeReturn).set({ status: to, closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId), eq(storeReturn.status, 'received'))).returning()
    if (done) await log(companyId, { action: 'update', entity: 'order', entityId: done.orderId, metadata: { description: `Return ${done.returnNumber} ${to}${done.creditCents ? ` — ${formatCents(done.creditCents)} as store credit` : ''}`, returnId: done.id } }, c)
    return done ?? null
  }

  /**
   * Catch a return up with its refund row: the row settled elsewhere (the 5-minute resume, the provider's webhook) makes the
   * return refunded; a row that failed frees the return to be refunded again. Asked by id, or by the row's own id.
   */
  async function reconcile(companyId: string, rowId: string | null, id: string | null): Promise<Return | null> {
    const ret = id ? await returnOf(id, companyId)
      : rowId ? (await db.select().from(storeReturn).where(and(eq(storeReturn.refundRowId, rowId), eq(storeReturn.companyId, companyId))).limit(1))[0] ?? null : null
    if (!ret || !ret.refundRowId || ret.status !== 'received') return ret
    const [row] = await db.select().from(storeOrderRefund).where(eq(storeOrderRefund.id, ret.refundRowId)).limit(1)
    if (row && ['refunded', 'recorded'].includes(row.status)) { await finish(companyId, ret.id, 'refunded'); return returnOf(ret.id, companyId) }
    if (row?.status === 'failed') {
      await db.update(storeReturn).set({ refundRowId: null, updatedAt: new Date() }).where(and(eq(storeReturn.id, ret.id), eq(storeReturn.status, 'received')))
      return returnOf(ret.id, companyId)
    }
    return ret
  }

  // ── Exchange ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Send the replacement: a new order that costs nothing, and the difference (if the goods came to more) refunded. */
  async function exchange(companyId: string, id: string, a: { items: Array<{ sku: string; quantity: number }>; creditCents?: number }, by: Who, c?: Context | null): Promise<{ ok: true; ret: Return; order: Order; pending: boolean } | Refusal> {
    const ret0 = await reconcile(companyId, null, id)
    if (!ret0) return no(404, 'Not found', 'not_found')
    if (ret0.status !== 'received') return no(409, 'Receive the goods before sending the exchange.', 'wrong_status')
    if (ret0.refundRowId || ret0.exchangeOrderId) return no(409, 'This return has already been dealt with.', 'already_done')
    const order = await orderOf(ret0.orderId, companyId)
    if (!order) return no(404, 'Not found', 'not_found')
    if (order.refundPendingAt || (await refunds.partInFlight(order.id))) return no(409, 'Another refund on this order is still on its way. Wait for it to finish.', 'refund_in_flight')
    const wanted = new Map<string, number>()
    for (const l of a.items) wanted.set(l.sku, (wanted.get(l.sku) || 0) + Math.floor(l.quantity))
    if (!wanted.size || [...wanted.values()].some((q) => !(q >= 1))) return no(400, 'Choose what to send instead, and how many.', 'validation_failed')
    const found: Array<{ v: typeof storeProductVariant.$inferSelect; p: typeof storeProduct.$inferSelect }> = await db.select({ v: storeProductVariant, p: storeProduct }).from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId)).where(and(eq(storeProduct.companyId, companyId), inArray(storeProductVariant.sku, [...wanted.keys()])))
    let replacement = 0
    for (const [sku, qty] of wanted) {
      const f = found.find((x) => x.v.sku === sku)
      if (!f || f.p.status !== 'active' || f.p.kind === 'gift_card') return no(409, `${sku} is not available to send.`, 'not_available')
      if (f.v.inventoryQty !== null && f.v.inventoryQty < qty) return no(409, `Only ${f.v.inventoryQty} of ${f.p.name} in stock.`, 'out_of_stock')
      replacement += f.v.priceCents * qty
    }
    const returned = ret0.lineValueCents
    if (replacement > returned) return no(409, `The replacement comes to ${formatCents(replacement, order.currency)} and the goods sent back are worth ${formatCents(returned, order.currency)}. An exchange cannot cost the shopper more — refund the return and let them buy the new item instead.`, 'costs_more')
    const difference = returned - replacement
    const credit = a.creditCents ?? (ret0.preferCredit ? difference : 0)
    if (!(Number.isInteger(credit) && credit >= 0 && credit <= difference)) return no(400, 'The store credit cannot be more than the difference.', 'validation_failed')
    const orderId = createId()
    let made: Order
    let row: typeof storeOrderRefund.$inferSelect
    try {
      ;[made, row] = await db.transaction(async (tx: any) => {
        const [locked]: Return[] = await tx.select().from(storeReturn).where(and(eq(storeReturn.id, id), eq(storeReturn.companyId, companyId))).limit(1).for('update')
        if (!locked || locked.status !== 'received' || locked.refundRowId || locked.exchangeOrderId) throw new Moved()
        for (const [sku, qty] of wanted) {
          const f = found.find((x) => x.v.sku === sku)!
          if (f.v.inventoryQty !== null) {
            const [fresh] = await tx.select({ q: storeProductVariant.inventoryQty }).from(storeProductVariant).where(eq(storeProductVariant.id, f.v.id)).limit(1).for('update')
            if ((fresh?.q ?? 0) < qty) throw new Moved()
          }
        }
        const refundRow = await reserve(tx, order, locked, difference, credit, by)
        const [o]: Order[] = await tx.insert(storeOrder).values({
          id: orderId, companyId, contactId: order.contactId, orderNumber: orderNumberFor(orderId), provider: 'exchange', providerSessionId: `exchange-${locked.id}`, status: 'paid',
          customerEmail: order.customerEmail, customerName: order.customerName, customerPhone: order.customerPhone, shippingAddress: order.shippingAddress, billingAddress: order.billingAddress,
          subtotalCents: replacement, discountCents: replacement, totalCents: 0, currency: order.currency, fulfillment: order.fulfillment === 'digital' ? 'ship' : order.fulfillment,
          source: 'exchange', internalNote: `Exchange for return ${locked.returnNumber} (order ${order.orderNumber})`,
        }).returning()
        for (const [sku, qty] of wanted) {
          const f = found.find((x) => x.v.sku === sku)!
          await tx.insert(storeOrderItem).values({
            orderId, productId: f.p.id, variantId: f.v.id, productName: f.p.name, variantName: f.v.name, sku, unitPriceCents: f.v.priceCents, quantity: qty, lineTotalCents: f.v.priceCents * qty,
          })
          await decrementStock(tx, f.v.id, qty)
        }
        await tx.update(storeReturn).set({
          status: 'exchanged', exchangeOrderId: orderId, refundRowId: refundRow.id, refundCents: difference, creditCents: credit, closedAt: new Date(), updatedAt: new Date(),
        }).where(eq(storeReturn.id, id))
        return [o, refundRow]
      })
    } catch (e) {
      if (!(e instanceof Moved)) throw e
      return no(409, 'Someone else just changed this order, return or stock, so the exchange was not made. Reload and try again.', 'order_changed')
    }
    await log(companyId, { action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `Return ${ret0.returnNumber} exchanged: order ${made.orderNumber} sent at no charge${difference ? `, ${formatCents(difference, order.currency)} of the difference ${credit === difference ? 'as store credit' : 'refunded'}` : ''}`, returnId: id, exchangeOrderId: orderId } }, c)
    let pending = false
    if (difference > 0) {
      const { money } = await refunds.sendPart(order, row, c ?? null, 'Exchange difference')
      pending = money.kind === 'failed'
    }
    void tell(order, (await returnOf(id, companyId))!, 'Your exchange is on its way', `your exchange for return ${ret0.returnNumber} is being packed as order ${made.orderNumber}. You have not been charged.`)
    return { ok: true, ret: (await returnOf(id, companyId))!, order: made, pending }
  }

  // ── Reading ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function list(companyId: string, q: { status?: string; contactId?: string; orderId?: string } = {}): Promise<Return[]> {
    const where = [eq(storeReturn.companyId, companyId), ...(q.status ? [eq(storeReturn.status, q.status)] : []), ...(q.contactId ? [eq(storeReturn.contactId, q.contactId)] : []), ...(q.orderId ? [eq(storeReturn.orderId, q.orderId)] : [])]
    const rows: Return[] = await db.select().from(storeReturn).where(and(...where)).orderBy(desc(storeReturn.createdAt), desc(storeReturn.id)).limit(200)
    return Promise.all(rows.map((r) => (r.status === 'received' && r.refundRowId ? reconcile(companyId, null, r.id).then((x) => x ?? r) : r)))
  }

  /** One return with what the screen shows: the order, the lines by name, the refund row, the exchange order. */
  async function detail(companyId: string, ret: Return) {
    const order = await orderOf(ret.orderId, companyId)
    const items = order ? await refunds.itemsOf(order.id) : []
    const byId = new Map(items.map((i) => [i.id, i]))
    const [row] = ret.refundRowId ? await db.select().from(storeOrderRefund).where(eq(storeOrderRefund.id, ret.refundRowId)).limit(1) : []
    const [ex] = ret.exchangeOrderId ? await db.select({ id: storeOrder.id, orderNumber: storeOrder.orderNumber }).from(storeOrder).where(eq(storeOrder.id, ret.exchangeOrderId)).limit(1) : []
    return {
      ...ret,
      reasonLabel: REASON_LABEL[ret.reason as ReturnReason] ?? ret.reason,
      order: order ? { id: order.id, orderNumber: order.orderNumber, customerName: order.customerName, customerEmail: order.customerEmail, totalCents: order.totalCents, currency: order.currency } : null,
      lines: ret.items.map((l) => ({ ...l, productName: byId.get(l.orderItemId)?.productName ?? 'Item', variantName: byId.get(l.orderItemId)?.variantName ?? '', unitPriceCents: byId.get(l.orderItemId)?.unitPriceCents ?? 0 })),
      refund: row ? { status: row.status, amountCents: row.amountCents, creditCents: row.creditCents, error: row.error } : null,
      exchangeOrder: ex ?? null,
    }
  }

  /** What a shopper is shown of their own return (never the staff's notes or who decided it). */
  async function forShopper(companyId: string, ret: Return) {
    const d2 = await detail(companyId, ret)
    return {
      id: ret.id, returnNumber: ret.returnNumber, status: ret.status, orderId: ret.orderId, orderNumber: d2.order?.orderNumber ?? null, resolution: ret.resolution, reason: ret.reason, reasonLabel: d2.reasonLabel,
      note: ret.note, wanted: ret.wanted, lines: d2.lines.map((l) => ({ productName: l.productName, variantName: l.variantName, quantity: l.quantity })), createdAt: ret.createdAt,
      declineReason: ret.status === 'declined' ? ret.declineReason : null, label: ret.labelUrl ? { url: ret.labelUrl, carrier: ret.labelCarrier, tracking: ret.labelTracking } : null,
      refundCents: ['refunded', 'exchanged'].includes(ret.status) ? ret.refundCents : null, creditCents: ['refunded', 'exchanged'].includes(ret.status) ? ret.creditCents : null,
      restockingFeeCents: ret.restockingFeeCents, returnShippingFeeCents: ret.returnShippingFeeCents, exchangeOrderNumber: d2.exchangeOrder?.orderNumber ?? null,
    }
  }

  return { policy, savePolicy, returnable, start, approve, decline, cancel, buyLabel, receive, refund, exchange, list, detail, forShopper, returnOf, reconcile }
}
export type StoreReturns = ReturnType<typeof createStoreReturns>
