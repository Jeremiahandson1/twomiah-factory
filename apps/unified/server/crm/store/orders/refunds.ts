// Money back on an order: a whole refund or a cancel, a part refund (reserve → ask the provider → settle), the 5-minute
// resume of a refund that was interrupted, a refund made in the provider's own dashboard, and the provider's word on a
// refund it was holding. Moved from templates/crm-store/backend/src/routes/orders.ts (returnPayment, refundStanding,
// settleRefund(Once), finishRefund, resumePendingRefunds, resumePendingParts, applyProviderRefund, applyRefundUpdate,
// quoteRefund, settlePart, abandonPart, sendPart, notifyRefund, notifyLastRefund), where they were module functions over
// a module-level `db`; here they are built once from the app's dependencies and the store core.
//
// Changes from the template:
//   · every order is the company's: each function takes the company's id and every order query filters by it; a line or
//     a refund row is reached through an order of that company (applyRefundUpdate joins the refund to its order);
//   · the background resume works on the shop's company (core.shop(), one company per tenant database, as the core's
//     supplier sweep does), and is registered with d.services.addJob by orders/index.ts — not started at import;
//   · applyProviderRefund and applyRefundUpdate take the company's id first (the webhook knows which shop it is for);
//   · every raw sql fragment (the atomic increments and releases, the conditional "no part in flight", the sums) is a
//     named function in server/data/storeOrders.ts, each keeping its atomic/conditional guarantee;
//   · the payment provider is the company's connected one (core.getActiveProvider(companyId));
//   · the shopper's refund email goes through core.mail ('storeRefundIssued'), with the company's email as the support
//     address and the reply-to; the shop's name in it is the company row's (the email service's brand);
//   · audit rows go through the engine's audit (d.audit.log), with the company's id on a row written without a request
//     (the resume, a webhook); "who refunded" (createdBy / createdByName) is the person's first and last name, or their
//     email (the unified user has no single `name`), from the shared createActorName.
import { and, asc, desc, eq, isNull, lt, isNotNull } from 'drizzle-orm'
import { createActorName } from '@twomiah/tenant-backend'
import type { Context } from 'hono'
import { user } from '../../../db/schema/index.ts'
import { storeOrder, storeOrderItem, storeOrderRefund, type RefundLine } from '../../../db/schema/store.ts'
import {
  clearRefundStamp, restockVariant, shippingRefundedCents, closeFullyRefunded, releasePartMoney, releaseLineUnits, moveOrderFrom,
} from '../../../data/storeOrders.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import { RefundRefused } from '../payments/types.ts'
import { cardShareOfRefund, createStoreGiftCards } from '../giftCards.ts'
import { COUNTED } from './rules.ts'

type Order = typeof storeOrder.$inferSelect
type OrderItem = typeof storeOrderItem.$inferSelect
type RefundRow = typeof storeOrderRefund.$inferSelect
export type Who = { userId?: string | null; name?: string | null; reason?: string | null }

/**
 * WHAT HAPPENED TO THE SHOPPER'S MONEY when a paid order was refunded or cancelled. (Owner's decision, 10/12)
 *
 * 'Mark refunded' only ever changed the order's status: the order said refunded and the shopper's money stayed
 * taken. Shopify's Refund sends the money back through the payment provider, and so does this now — for a provider
 * that is connected now (Stripe, Square or PayPal). For an order paid through any other, the owner is told plainly that
 * this only RECORDS it:
 *   refunded      the provider sent it back (or it already had — refunded from the provider's own dashboard)
 *   manual        paid through a provider that is not the one connected now — refund there
 *   none_on_file  no card payment on record (an order marked paid by hand) — return it the way it was paid
 *   failed        the provider refused (refused: true — nothing was sent), or did not answer (refused: false — it may
 *                 have gone through, so a part refund stays pending and is asked again with the same key)
 */
export type MoneyBack =
  | { kind: 'not_paid' }
  // awaiting: the provider holds it and has not sent the money yet (PayPal's PENDING) — see holdsRefund below.
  | { kind: 'refunded'; refundId: string | null; status: string; amountCents: number | null; alreadyRefunded?: boolean; awaiting?: boolean }
  | { kind: 'manual'; note: string }
  | { kind: 'none_on_file'; note: string }
  | { kind: 'failed'; reason: string; refused: boolean }

export const PROVIDER_LABEL: Record<string, string> = { stripe: 'Stripe', square: 'Square', paypal: 'PayPal' }

/**
 * A REFUND THE PROVIDER IS HOLDING. PayPal answers PENDING for an eCheck refund — funded from the merchant's bank, and it
 * can still FAIL — so the money has not gone back yet. The store does not settle it on that word (nothing restocked, the
 * reservation kept, the order page reads "waiting on the provider") and asks again by the refund's OWN id, never by
 * sending another: PayPal's webhook (PAYMENT.CAPTURE.REFUNDED / PAYMENT.REFUND.FAILED, applyRefundUpdate) or the
 * 5-minute resume (refundStanding) settles it, or gives the reservation back exactly as a refusal does.
 *   part refund   order_refunds row stays 'pending' with providerRefundId set
 *   whole refund  the order keeps refundPendingAt with refundId set and no refundError
 */
export const holdsRefund = (m: MoneyBack): boolean => m.kind === 'refunded' && !!m.awaiting

/** The part refund's own idempotency key. */
export const PART_KEY = (refundId: string) => `refund-${refundId}`
const retryAfter = (order: Order) => order.refundError && order.refundId && order.refundPendingAt ? `-after-${order.refundId}` : ''

export type RefundQuote = {
  suggestedCents: number
  // What can still be sent back, and the shipping still unrefunded.
  maxCents: number
  shippingLeftCents: number
  lines: { orderItemId: string; productName: string; variantName: string; quantity: number; refundedQuantity: number; unitPriceCents: number }[]
}

/**
 * What the chosen units are worth back. A unit's share of what the shopper paid for goods — the total less shipping,
 * so the discount and the tax come off in the same proportion as they went on — plus the shipping chosen. Choosing
 * everything that is left suggests exactly what is left, so rounding can never strand a cent.
 */
export function quoteRefund(
  order: Pick<Order, 'subtotalCents' | 'shippingCents' | 'totalCents' | 'refundedCents'>,
  items: Pick<OrderItem, 'id' | 'productName' | 'variantName' | 'quantity' | 'refundedQuantity' | 'unitPriceCents'>[],
  shippingRefundedCentsSoFar: number,
  input: { items: { orderItemId: string; quantity: number }[]; shippingCents: number },
): { ok: true; quote: RefundQuote } | { ok: false; error: string } {
  const maxCents = Math.max(0, order.totalCents - order.refundedCents)
  const shippingLeftCents = Math.max(0, order.shippingCents - shippingRefundedCentsSoFar)
  const lines = items.map((it) => ({ orderItemId: it.id, productName: it.productName, variantName: it.variantName, quantity: it.quantity, refundedQuantity: it.refundedQuantity, unitPriceCents: it.unitPriceCents }))
  const byId = new Map(items.map((it) => [it.id, it]))
  const asked = new Map<string, number>()
  for (const l of input.items) asked.set(l.orderItemId, (asked.get(l.orderItemId) || 0) + l.quantity)
  const goodsPaid = Math.max(0, order.totalCents - order.shippingCents)
  let suggested = 0
  for (const [id, qty] of asked) {
    const it = byId.get(id)
    if (!it) return { ok: false, error: 'One of the items is not on this order.' }
    const left = it.quantity - it.refundedQuantity
    if (qty > left) return { ok: false, error: left > 0 ? `Only ${left} of ${it.productName} can still be refunded.` : `${it.productName} has already been refunded.` }
    suggested += order.subtotalCents > 0 ? Math.round((it.unitPriceCents * qty * goodsPaid) / order.subtotalCents) : 0
  }
  if (input.shippingCents > shippingLeftCents) return { ok: false, error: `Only ${formatCents(shippingLeftCents)} of the shipping can still be refunded.` }
  suggested += input.shippingCents
  const everything = items.every((it) => (asked.get(it.id) || 0) === it.quantity - it.refundedQuantity) && input.shippingCents === shippingLeftCents
  if (everything) suggested = maxCents
  return { ok: true, quote: { suggestedCents: Math.min(suggested, maxCents), maxCents, shippingLeftCents, lines } }
}

export function createOrderRefunds(d: CrmDeps, core: StoreCore) {
  const { db, audit, logger } = d
  const actorName = createActorName({ db, tables: { user } })
  const giftCards = createStoreGiftCards(d, core)
  /** One audit row; a row written with no request in hand (the resume, a webhook) names the company itself. */
  const log = (companyId: string, row: Record<string, unknown>, c?: Context | null) => audit.log({ ...row, companyId, ...(c ? { req: c } : {}) })

  const orderOf = async (orderId: string, companyId: string): Promise<Order | null> =>
    (await db.select().from(storeOrder).where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId))).limit(1))[0] ?? null
  const itemsOf = (orderId: string): Promise<OrderItem[]> => db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, orderId))

  /** Who is pressing the button, for the refund history's "who refunded". */
  async function whoIs(c: Context): Promise<{ userId: string | null; name: string | null }> {
    const u = (c as any).get('user') as { userId?: string; companyId?: string; email?: string } | undefined
    if (!u?.userId) return { userId: null, name: null }
    return { userId: u.userId, name: await actorName(u as any) }
  }

  /**
   * Send money back for an order. With no `part`, it is everything not already sent back: after part refunds that is
   * totalCents − refundedCents; with none, the provider's own "the rest" (which also allows for anything refunded in its
   * dashboard). A part names its amount and its own idempotency key (refund-<order_refunds.id>).
   */
  async function returnPayment(order: Order, part?: { amountCents: number; idempotencyKey: string; reason?: string | null }): Promise<MoneyBack> {
    /**
     * PAID PARTLY (OR WHOLLY) BY GIFT CARD: the money goes back the way it came. A part refund gives the card its share
     * in proportion to what it paid (giftCards.cardShareOfRefund) and the provider the rest; a whole refund gives each
     * what it has not had back. The provider is asked first — a refusal sends nothing back anywhere — and the card's
     * share is put back once per refund key, so a retry or the 5-minute resume never pays the card twice.
     */
    const onCard = order.giftCardId && order.giftCardCents > 0
    const cardLeft = onCard ? Math.max(0, order.giftCardCents - order.giftCardRefundedCents) : 0
    const wholeKey = order.refundedCents > 0 ? `order-refund-${order.id}-${order.refundedCents}${retryAfter(order)}` : `order-refund-${order.id}${retryAfter(order)}`
    const cardCents = !onCard ? 0 : part ? cardShareOfRefund(order, part.amountCents) : cardLeft
    const toCard = async (): Promise<number> => (cardCents > 0 ? giftCards.refundToCard(order, cardCents, part ? part.idempotencyKey : wholeKey, 'Refund') : 0)
    if (onCard && !order.providerPaymentId && order.giftCardCents >= order.totalCents) {
      const back = await toCard()
      return { kind: 'refunded', refundId: null, status: 'succeeded', amountCents: back }
    }
    if (!order.providerPaymentId) {
      return { kind: 'none_on_file', note: 'No card payment is on record for this order, so no money was sent back here. Return it the way it was paid.' }
    }
    const label = PROVIDER_LABEL[order.provider] || order.provider
    const provider = await core.getActiveProvider(order.companyId).catch(() => null)
    if (!provider || provider.name !== order.provider) {
      return { kind: 'manual', note: `This order was paid through ${label}. Refund it in your ${label} dashboard — here it is only recorded as refunded.` }
    }
    // What goes back through the provider: the part less the card's share, or for the whole all the provider has not
    // sent back (its own "the rest" when nothing has gone back yet).
    const viaProvider = part ? part.amountCents - cardCents : order.totalCents - order.refundedCents - cardLeft
    if (onCard && viaProvider <= 0) {
      const back = await toCard()
      return { kind: 'refunded', refundId: null, status: 'succeeded', amountCents: back }
    }
    try {
      const r = await provider.refund(part
        ? { providerPaymentId: order.providerPaymentId, idempotencyKey: part.idempotencyKey, amountCents: viaProvider, currency: order.currency, ...(part.reason ? { reason: part.reason } : {}) }
        // After part refunds the key names how much had gone back, so it is a different request from a refund of the whole
        // tried (and refused) earlier — a provider refuses a key reused with a different amount.
        // A whole refund the provider HELD and then failed (refundId kept beside refundError) is a new request too: the old
        // key would only hand back the failed refund.
        : order.refundedCents > 0
          ? { providerPaymentId: order.providerPaymentId, idempotencyKey: wholeKey, amountCents: viaProvider, currency: order.currency }
          : { providerPaymentId: order.providerPaymentId, idempotencyKey: wholeKey, currency: order.currency })
      const back = await toCard()
      return { kind: 'refunded', ...r, ...(back > 0 && r.amountCents != null ? { amountCents: r.amountCents + back } : {}) }
    } catch (e: any) {
      return { kind: 'failed', reason: `${label} said: ${String(e?.message || 'no reason given').slice(0, 300)}`, refused: e instanceof RefundRefused }
    }
  }

  /** Where a held refund stands, by its own id — refundStatus. Unknown (no answer, wrong provider connected) stays held. */
  async function refundStanding(order: Order, refundId: string): Promise<MoneyBack> {
    const label = PROVIDER_LABEL[order.provider] || order.provider
    const provider = await core.getActiveProvider(order.companyId).catch(() => null)
    if (!provider || provider.name !== order.provider || !provider.refundStatus) return { kind: 'failed', reason: `${label} could not be asked where this refund stands.`, refused: false }
    try {
      return { kind: 'refunded', ...(await provider.refundStatus(refundId)) }
    } catch (e: any) {
      return { kind: 'failed', reason: `${label} said: ${String(e?.message || 'no reason given').slice(0, 300)}`, refused: e instanceof RefundRefused }
    }
  }

  /**
   * A status change in the audit log, with what it was worth: a refund or a cancel is money going back and stock coming
   * back, so the row says how much of each. (Store T3: refunds are a manager's power; the owner can see who used it.)
   */
  async function logStatusChange(c: Context, prev: Order, updated: Order, restocked: number, back: MoneyBack = { kind: 'not_paid' }) {
    const money = formatCents(updated.totalCents, updated.currency)
    const sent = back.kind === 'refunded' ? (back.alreadyRefunded ? ', already refunded at the provider' : back.awaiting ? ', sent to the provider — it is holding the refund, so nothing is restocked until it confirms' : ', sent back to the card') : back.kind === 'manual' || back.kind === 'none_on_file' ? ', recorded only — no money sent back here' : ''
    const what = updated.status === 'refunded' ? `Refunded — ${money}${sent}` : updated.status === 'cancelled' ? `Cancelled — ${money}${sent}` : `Marked ${updated.status}`
    await log(updated.companyId, {
      action: 'status_change', entity: 'order', entityId: updated.id, entityName: updated.orderNumber,
      changes: { status: { old: prev.status, new: updated.status } },
      metadata: { description: restocked ? `${what}, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : what, totalCents: updated.totalCents, restocked, ...(back.kind === 'refunded' ? { refundId: back.refundId, refundStatus: back.status } : back.kind === 'not_paid' ? {} : { moneyBack: back.kind }) },
    }, c)
  }

  /**
   * THE REFUND IS DONE: the stamp comes off and the stock goes back, as ONE write. (Owner, 10/12: "the professional
   * thing to do".) Clearing refundPendingAt is conditional on it still being set, so whoever finishes a refund — the
   * request, resumePendingRefunds after a crash, a retry — restocks exactly once, however many of them get here.
   * Restocking: payment (finalizeOrder) took the units off for tracked variants; untracked (inventoryQty IS NULL =
   * unlimited) are skipped by the WHERE guard. Everything inside reads through `tx` — an outer `db` read inside the
   * transaction would wait on itself.
   *
   * After part refunds, "the rest" is what is left: only the units not refunded yet go back on the shelf (a part refund
   * restocked its own, or chose not to), and the order's refundedCents becomes its total. The rest is written to the
   * order's refund history as one row, like a part refund.
   */
  async function settleRefund(orderId: string, companyId: string, money: MoneyBack, by?: Who): Promise<number> {
    return (await settleRefundOnce(orderId, companyId, money, by)).restocked
  }
  /** settleRefund, saying whether THIS call was the one that settled it (only that one tells the shopper). */
  async function settleRefundOnce(orderId: string, companyId: string, money: MoneyBack, by?: Who): Promise<{ restocked: number; settled: boolean }> {
    return db.transaction(async (tx: any) => {
      const [before] = await tx.select({ refundedCents: storeOrder.refundedCents }).from(storeOrder)
        .where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId))).limit(1)
      const cleared = await clearRefundStamp(tx, orderId, companyId, money.kind === 'refunded' ? { refundId: money.refundId, refundedAt: new Date() } : {})
      if (!cleared) return { restocked: 0, settled: false }
      let restocked = 0
      const items: OrderItem[] = await tx.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, orderId))
      const lines: RefundLine[] = []
      for (const it of items) {
        const left = it.quantity - it.refundedQuantity
        if (left <= 0) continue
        lines.push({ orderItemId: it.id, quantity: left })
        await tx.update(storeOrderItem).set({ refundedQuantity: it.quantity }).where(eq(storeOrderItem.id, it.id))
        if (!it.variantId) continue
        restocked += left
        await restockVariant(tx, it.variantId, left)
      }
      const amount = cleared.totalCents - (before?.refundedCents ?? 0)
      if (amount > 0 || lines.length) {
        const shipped = await shippingRefundedCents(tx, orderId)
        await tx.insert(storeOrderRefund).values({
          orderId, amountCents: Math.max(0, amount), shippingCents: Math.max(0, cleared.shippingCents - shipped),
          items: lines, restock: true, reason: by?.reason ?? (cleared.status === 'cancelled' ? 'Order cancelled' : null),
          status: money.kind === 'refunded' ? 'refunded' : 'recorded', moneyBack: money.kind,
          providerRefundId: money.kind === 'refunded' ? money.refundId : null,
          createdBy: by?.userId ?? null, createdByName: by?.name ?? null, settledAt: new Date(),
        })
      }
      return { restocked, settled: true }
    })
  }

  /**
   * FINISH WHAT WAS INTERRUPTED. A refund left stamped (refundPendingAt) for more than a couple of minutes — the server
   * restarted between moving the order and hearing from the provider — is asked of the provider again. The per-order
   * idempotency key hands back the SAME refund if the first request did reach it, so this never refunds twice; the
   * settle above never restocks twice. A refusal is kept on the order (refundError) for the order page to show, with a
   * Try again button; the order stays refunded/cancelled and nothing is restocked until the money has gone back.
   */
  async function finishRefund(order: Order, why: string, told?: MoneyBack, c?: Context | null): Promise<MoneyBack> {
    const companyId = order.companyId
    const mine = and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId), isNotNull(storeOrder.refundPendingAt))
    // A refund the provider is holding is asked after by its own id — never sent again (see holdsRefund). `told` is the
    // provider's own word on it, from its webhook.
    const held = !!order.refundPendingAt && !!order.refundId && !order.refundError
    const money = told ?? (held ? await refundStanding(order, order.refundId!) : await returnPayment(order))
    if (money.kind === 'failed') {
      // A held refund the provider could not be asked about is still held; only its "no" ends it.
      if (held && !money.refused) return money
      await db.update(storeOrder).set({ refundError: money.reason, updatedAt: new Date() }).where(mine)
      if (held) await log(companyId, {
        action: 'status_change', entity: 'order', entityId: order.id, entityName: order.orderNumber,
        metadata: { description: `${why} — the provider did not complete the refund it was holding: ${money.reason}. Nothing was sent back and nothing restocked.`, refundId: order.refundId },
      }, c)
      return money
    }
    if (holdsRefund(money)) {
      if (money.kind === 'refunded' && money.refundId !== order.refundId) await db.update(storeOrder).set({ refundId: money.refundId, refundError: null, updatedAt: new Date() }).where(mine)
      return money
    }
    const { restocked, settled } = await settleRefundOnce(order.id, companyId, money)
    if (held && !settled) return money
    const after = await orderOf(order.id, companyId)
    if (settled && after && money.kind === 'refunded' && !money.alreadyRefunded) void notifyLastRefund(order.id, companyId, after.status === 'cancelled')
    if (after) {
      const amount = formatCents(after.totalCents, after.currency)
      await log(companyId, {
        action: 'status_change', entity: 'order', entityId: after.id, entityName: after.orderNumber,
        metadata: {
          description: `${why} — ${money.kind === 'refunded' ? `${amount} sent back to the card` : 'recorded only, no money sent back here'}${restocked ? `, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : ''}`,
          ...(money.kind === 'refunded' ? { refundId: money.refundId, refundStatus: money.status } : { moneyBack: money.kind }),
        },
      }, c)
    }
    return money
  }

  /** Whole refunds and part refunds left waiting more than `olderThanMs`, on the shop's company, finished. How many were found. */
  async function resumePendingRefunds(olderThanMs = 2 * 60_000): Promise<number> {
    const co = await core.shop()
    if (!co) return 0
    const stuck: Order[] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, co.id), isNotNull(storeOrder.refundPendingAt), lt(storeOrder.refundPendingAt, new Date(Date.now() - olderThanMs))))
    for (const o of stuck) {
      try { await finishRefund(o, 'Refund completed after an interruption') } catch (e: any) { logger.error('[orders] resuming a refund failed', { orderId: o.id, error: e?.message }) }
    }
    return stuck.length + await resumePendingParts(co.id, olderThanMs)
  }

  /** Part refunds left pending by a restart or a provider that did not answer: asked again, same key. */
  async function resumePendingParts(companyId: string, olderThanMs = 2 * 60_000): Promise<number> {
    const stuck: { row: RefundRow; order: Order }[] = await db.select({ row: storeOrderRefund, order: storeOrder }).from(storeOrderRefund)
      .innerJoin(storeOrder, eq(storeOrder.id, storeOrderRefund.orderId))
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrderRefund.status, 'pending'), lt(storeOrderRefund.createdAt, new Date(Date.now() - olderThanMs))))
    for (const { row, order } of stuck) {
      try { await sendPart(order, row, null, 'Part refund completed after an interruption') } catch (e: any) { logger.error('[orders] resuming a part refund failed', { refundRowId: row.id, error: e?.message }) }
    }
    return stuck.length
  }

  /**
   * A REFUND MADE IN THE PROVIDER'S OWN DASHBOARD. (Owner, 10/12.) Stripe sends charge.refunded; the order is found by its
   * payment id, and `refundedCents` is everything refunded off that payment so far (Stripe's amount_refunded, Square's
   * refunded_money).
   *   ours          — no more than the order has already sent back (refundedCents counts a part refund from the moment
   *                   it is reserved, before the provider is asked): nothing to do. A whole refund of ours has moved
   *                   the order off paid before the provider was asked, so it is left alone too.
   *   all of it     — the order is marked refunded and the rest restocked, exactly once (WHERE status = what was read).
   *   part of it    — the extra is written to the order's refund history as money back with no items: the store cannot
   *                   know which units it was for, so nothing is restocked.
   */
  async function applyProviderRefund(companyId: string, provider: string, providerPaymentId: string, refundedCents: number, chargeCents: number): Promise<'refunded' | 'partial' | 'ignored'> {
    const [o]: Order[] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.provider, provider), eq(storeOrder.providerPaymentId, providerPaymentId))).limit(1)
    if (!o || !COUNTED.includes(o.status)) return 'ignored'
    if (refundedCents <= o.refundedCents) return 'ignored'
    const amount = (cents: number) => formatCents(cents, o.currency)
    const where = `${PROVIDER_LABEL[provider] || provider}'s dashboard`
    if (refundedCents < chargeCents) {
      const extra = refundedCents - o.refundedCents
      const recorded = await db.transaction(async (tx: any) => {
        const [moved] = await tx.update(storeOrder).set({ refundedCents, updatedAt: new Date() })
          .where(and(eq(storeOrder.id, o.id), eq(storeOrder.companyId, companyId), eq(storeOrder.status, o.status), eq(storeOrder.refundedCents, o.refundedCents), isNull(storeOrder.refundPendingAt)))
          .returning({ id: storeOrder.id })
        if (!moved) return false
        await tx.insert(storeOrderRefund).values({ orderId: o.id, amountCents: extra, items: [], restock: false, reason: `Refunded in ${where}`, status: 'refunded', moneyBack: 'provider_dashboard', settledAt: new Date() })
        return true
      })
      if (!recorded) return 'ignored'
      await log(companyId, {
        action: 'update', entity: 'order', entityId: o.id, entityName: o.orderNumber,
        metadata: { description: `Partly refunded in ${where}: ${amount(extra)} (${amount(refundedCents)} of ${amount(chargeCents)} back so far) — no units restocked` },
      })
      return 'partial'
    }
    const moved = await moveOrderFrom(db, { orderId: o.id, companyId, from: o.status, patch: { status: 'refunded', refundPendingAt: new Date(), updatedAt: new Date() }, whenNoPartInFlight: true })
    if (!moved) return 'ignored'
    const restocked = await settleRefund(o.id, companyId, { kind: 'refunded', refundId: null, status: 'succeeded', amountCents: refundedCents, alreadyRefunded: true }, { reason: `Refunded in ${where}` })
    await log(companyId, {
      action: 'status_change', entity: 'order', entityId: o.id, entityName: o.orderNumber,
      changes: { status: { old: o.status, new: 'refunded' } },
      metadata: { description: `Refunded in ${PROVIDER_LABEL[provider] || provider}'s dashboard — ${amount(refundedCents)}${restocked ? `, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : ''}`, restocked },
    })
    return 'refunded'
  }

  /**
   * THE PROVIDER'S WORD ON ONE REFUND, by its id — a webhook naming a refund (PayPal's PAYMENT.CAPTURE.REFUNDED /
   * PAYMENT.REFUND.FAILED). Checked BEFORE applyProviderRefund's running total, so the store's own refund echoing back is
   * matched to the row (or order) it came from and never counted a second time:
   *   a part the provider was holding     completed → settled (units restocked, shopper told); failed → reservation given
   *                                       back, the row reads failed — exactly as a refused part refund
   *   a whole refund it was holding       completed → settled; failed → refundError, Try again (a new request, see retryAfter)
   *   one of ours already settled/failed  'ours' — nothing to do
   *   not ours                            'unknown' — the caller treats it as a dashboard refund
   */
  async function applyRefundUpdate(companyId: string, provider: string, refundId: string, outcome: 'completed' | 'failed', reason?: string): Promise<'settled' | 'released' | 'ours' | 'unknown'> {
    const label = PROVIDER_LABEL[provider] || provider
    const told: MoneyBack = outcome === 'completed'
      ? { kind: 'refunded', refundId, status: 'succeeded', amountCents: null }
      : { kind: 'failed', reason: `${label} did not complete the refund${reason ? ` (${reason})` : ''}`, refused: true }
    const [hit]: { row: RefundRow; order: Order }[] = await db.select({ row: storeOrderRefund, order: storeOrder }).from(storeOrderRefund)
      .innerJoin(storeOrder, eq(storeOrder.id, storeOrderRefund.orderId))
      .where(and(eq(storeOrderRefund.providerRefundId, refundId), eq(storeOrder.companyId, companyId))).limit(1)
    if (hit) {
      const { row, order } = hit
      if (order.provider !== provider) return 'unknown'
      if (row.status !== 'pending') return 'ours'
      const why = outcome === 'completed' ? `Part refund confirmed by ${label}` : `Part refund failed at ${label}`
      const { money, settled } = await sendPart(order, row, null, why, told)
      return money.kind === 'failed' ? 'released' : settled ? 'settled' : 'ours'
    }
    const [o]: Order[] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.provider, provider), eq(storeOrder.refundId, refundId))).limit(1)
    if (!o) return 'unknown'
    if (!o.refundPendingAt || o.refundError) return 'ours'
    const money = await finishRefund(o, outcome === 'completed' ? `Refund confirmed by ${label}` : `Refund failed at ${label}`, told)
    return money.kind === 'failed' ? 'released' : 'settled'
  }

  // ── Part refunds ─────────────────────────────────────────────────────────────
  /** Is a part refund of this order still on its way to the provider? */
  async function partInFlight(orderId: string): Promise<boolean> {
    const [row] = await db.select({ id: storeOrderRefund.id }).from(storeOrderRefund)
      .where(and(eq(storeOrderRefund.orderId, orderId), eq(storeOrderRefund.status, 'pending'))).limit(1)
    return !!row
  }

  /** The order with its lines and its refund history (oldest first), or null when it is not this company's. */
  async function orderWithRefunds(orderId: string, companyId: string): Promise<(Order & { items: OrderItem[]; refunds: RefundRow[] }) | null> {
    const order = await orderOf(orderId, companyId)
    if (!order) return null
    const items = await itemsOf(orderId)
    const refunds: RefundRow[] = await db.select().from(storeOrderRefund).where(eq(storeOrderRefund.orderId, orderId)).orderBy(asc(storeOrderRefund.createdAt), asc(storeOrderRefund.id))
    return { ...order, items, refunds }
  }

  /** Settle a part refund the provider has answered (or that is only recorded). Exactly once: WHERE status = 'pending'. */
  async function settlePart(refundId: string, money: MoneyBack): Promise<{ restocked: number; closed: boolean } | null> {
    return db.transaction(async (tx: any) => {
      const [row]: RefundRow[] = await tx.update(storeOrderRefund).set({
        status: money.kind === 'refunded' ? 'refunded' : 'recorded', moneyBack: money.kind, error: null, settledAt: new Date(),
        providerRefundId: money.kind === 'refunded' ? money.refundId : null,
      }).where(and(eq(storeOrderRefund.id, refundId), eq(storeOrderRefund.status, 'pending'))).returning()
      if (!row) return null
      let restocked = 0
      if (row.restock) {
        for (const l of row.items) {
          const [it] = await tx.select({ variantId: storeOrderItem.variantId }).from(storeOrderItem)
            .where(and(eq(storeOrderItem.id, l.orderItemId), eq(storeOrderItem.orderId, row.orderId))).limit(1)
          if (!it?.variantId) continue
          if (await restockVariant(tx, it.variantId, l.quantity)) restocked += l.quantity
        }
      }
      // Nothing left to send back: the order is refunded, as a whole refund would have left it.
      const closed = await closeFullyRefunded(tx, row.orderId, money.kind === 'refunded' ? { refundId: money.refundId, refundedAt: new Date() } : {})
      return { restocked, closed }
    })
  }

  /** A refusal: the reservation is given back and the row reads failed. Exactly once: WHERE status = 'pending'. */
  async function abandonPart(refundId: string, reason: string): Promise<boolean> {
    return db.transaction(async (tx: any) => {
      const [row]: RefundRow[] = await tx.update(storeOrderRefund).set({ status: 'failed', error: reason, settledAt: new Date() })
        .where(and(eq(storeOrderRefund.id, refundId), eq(storeOrderRefund.status, 'pending'))).returning()
      if (!row) return false
      await releasePartMoney(tx, row.orderId, row.amountCents)
      for (const l of row.items) await releaseLineUnits(tx, l.orderItemId, row.orderId, l.quantity)
      return true
    })
  }

  const partDescription = (row: RefundRow, items: { id: string; productName: string }[], currency: string) => {
    const names = new Map(items.map((i) => [i.id, i.productName]))
    const what = [
      ...row.items.map((l) => `${l.quantity} × ${names.get(l.orderItemId) || 'item'}`),
      ...(row.shippingCents > 0 ? [`shipping ${formatCents(row.shippingCents, currency)}`] : []),
    ]
    return `${formatCents(row.amountCents, currency)}${what.length ? ` (${what.join(', ')})` : ''}`
  }

  /** Ask the provider for a reserved part refund, then settle, give back, or leave it pending. The shared tail. */
  async function sendPart(order: Order, row: RefundRow, c: Context | null, why: string, told?: MoneyBack): Promise<{ money: MoneyBack; settled: { restocked: number; closed: boolean } | null }> {
    const companyId = order.companyId
    // A part the provider is holding (providerRefundId set while pending) is asked after by its own id — never sent again.
    // `told` is the provider's own word on it, from its webhook.
    const held = row.status === 'pending' && !!row.providerRefundId
    const money = told ?? (held ? await refundStanding(order, row.providerRefundId!) : await returnPayment(order, { amountCents: row.amountCents, idempotencyKey: PART_KEY(row.id), reason: row.reason }))
    const items = await itemsOf(order.id)
    const what = partDescription(row, items, order.currency)
    if (money.kind === 'failed') {
      if (money.refused) {
        // Exactly as any refusal: the reservation goes back, the row reads failed. (abandonPart is once-only.)
        if (await abandonPart(row.id, money.reason)) {
          await log(companyId, { action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `${why} refused — ${what}: ${money.reason}. Nothing was sent back.`, refundRowId: row.id } }, c)
        }
      } else if (!held) {
        await db.update(storeOrderRefund).set({ error: money.reason }).where(and(eq(storeOrderRefund.id, row.id), eq(storeOrderRefund.status, 'pending')))
      }
      return { money, settled: null }
    }
    if (holdsRefund(money)) {
      // Held by the provider: still reserved, nothing restocked; its id is kept to ask after it.
      if (!held && money.kind === 'refunded' && money.refundId) {
        const kept = await db.update(storeOrderRefund).set({ providerRefundId: money.refundId, error: null })
          .where(and(eq(storeOrderRefund.id, row.id), eq(storeOrderRefund.status, 'pending'))).returning({ id: storeOrderRefund.id })
        if (kept.length) await log(companyId, { action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `${why} — ${what} sent to ${PROVIDER_LABEL[order.provider] || order.provider}, which is holding it: nothing restocked until it confirms`, refundRowId: row.id, refundId: money.refundId, refundStatus: money.status } }, c)
      }
      return { money, settled: null }
    }
    const settled = await settlePart(row.id, money)
    if (settled) {
      const sent = money.kind === 'refunded' ? (money.alreadyRefunded ? ', already refunded at the provider' : ', sent back to the card') : ', recorded only — no money sent back here'
      await log(companyId, {
        action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber,
        ...(settled.closed ? { changes: { status: { old: order.status, new: 'refunded' } } } : {}),
        metadata: {
          description: `${why} — ${what}${sent}${settled.restocked ? `, ${settled.restocked} unit${settled.restocked === 1 ? '' : 's'} back in stock` : ''}${settled.closed ? '; nothing left to refund, so the order is refunded' : ''}`,
          amountCents: row.amountCents, refundRowId: row.id, restocked: settled.restocked,
          ...(money.kind === 'refunded' ? { refundId: money.refundId, refundStatus: money.status } : { moneyBack: money.kind }),
        },
      }, c)
      if (money.kind === 'refunded' && !money.alreadyRefunded) void notifyRefund(order, row, items)
    }
    return { money, settled }
  }

  // Tell the shopper what came back. Non-blocking (core.mail never throws); only when money was actually sent here.
  async function notifyRefund(order: Order, row: { amountCents: number; shippingCents: number; items: RefundLine[] }, items: OrderItem[], cancelled = false) {
    try {
      const co = await core.shop()
      const byId = new Map(items.map((i) => [i.id, i]))
      await core.mail(order.customerEmail, 'storeRefundIssued', {
        order: { orderNumber: order.orderNumber, customerName: order.customerName, currency: order.currency },
        lines: row.items.map((l) => ({ productName: byId.get(l.orderItemId)?.productName || 'Item', variantName: byId.get(l.orderItemId)?.variantName || '', quantity: l.quantity })),
        shippingCents: row.shippingCents, amountCents: row.amountCents, cancelled, supportEmail: co?.email,
      }, co?.email)
    } catch { /* non-blocking */ }
  }

  // A whole refund (or a cancel) settled: the shopper is told about the row settleRefund just wrote.
  async function notifyLastRefund(orderId: string, companyId: string, cancelled: boolean) {
    try {
      const order = await orderOf(orderId, companyId)
      if (!order) return
      const [row]: RefundRow[] = await db.select().from(storeOrderRefund).where(eq(storeOrderRefund.orderId, orderId)).orderBy(desc(storeOrderRefund.createdAt), desc(storeOrderRefund.id)).limit(1)
      if (!row || row.amountCents <= 0) return
      await notifyRefund(order, row, await itemsOf(orderId), cancelled)
    } catch { /* non-blocking */ }
  }

  return {
    whoIs, returnPayment, logStatusChange, settleRefund, settleRefundOnce, finishRefund, resumePendingRefunds, resumePendingParts,
    applyProviderRefund, applyRefundUpdate, partInFlight, orderWithRefunds, sendPart, notifyLastRefund, orderOf, itemsOf,
  }
}
export type OrderRefunds = ReturnType<typeof createOrderRefunds>
