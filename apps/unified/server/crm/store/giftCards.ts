// The store's gift cards (2026-10-24, the store upgrade): sold as a product (kind 'gift_card'), emailed as a code once the
// order is paid, redeemed at checkout for part or all of an order, and refunded back to the card it came off.
//
// ONE LEDGER PER COMPANY. The cards and their ledger are the bar's (server/crm/bar/barGiftCards.ts, tables bar_gift_card
// and bar_gift_card_ledger): the same codes, the same Crockford alphabet, the same rule that every balance change is a
// ledger row written with the card row locked. The store adds what an online order needs — the order a card was sold on
// or spent against (order_id), and a key per put-back (idempotency_key), so a refund retried, or a hold given back by two
// sweeps at once, moves the money once.
//
// THE HOLD. A card is spent when checkout starts, not when the order is paid: two checkouts at once against one $50 card
// must not both take $50 off what the provider charges. A checkout that is never paid gives the hold back — when it
// fails to start, when the owner cancels the pending order, and when the sweep writes the cart off (holdExpiryMs, a
// little past Stripe's 24-hour session) — keyed `release-<order id>`, so it is given back once.
import { and, desc, eq, inArray } from 'drizzle-orm'
import { barGiftCard, barGiftCardLedger } from '../../db/schema/index.ts'
import { storeOrder, storeOrderItem, storeProduct } from '../../db/schema/store.ts'
import { createBarGiftCards, GiftCardError, MAX_CARD_CENTS, MIN_CARD_CENTS, validAmount } from '../bar/barGiftCards.ts'
import type { CrmDeps } from '../deps.ts'
import type { StoreCore } from './core.ts'

export { GiftCardError, MIN_CARD_CENTS, MAX_CARD_CENTS }
/** A gift card's line never pays tax (Stripe Tax's code for a non-taxable item): it is money, not goods. */
export const GIFT_CARD_TAX_CODE = 'txcd_00000000'
/** A pending checkout holding a card's money is written off a little after its Stripe session (24 hours) expires. */
export const HOLD_EXPIRY_MS = 25 * 60 * 60 * 1000
/** Stripe's smallest charge: a card that would leave less than this to pay leaves exactly this. */
export const MIN_PROVIDER_CHARGE_CENTS = 50

type Order = typeof storeOrder.$inferSelect

/** A gift card's line is sold at an amount a card can hold ($5 to $500): anything else is refused at checkout. */
export const sellableCardAmount = (cents: number) => validAmount(cents)

/**
 * How much of a card goes on an order: what is left to pay (never the gift cards in the same cart — a card does not buy
 * another card), at most the balance, and never leaving a sliver below the provider's smallest charge.
 */
export function cardShare(balanceCents: number, payableCents: number, providerMinimum = MIN_PROVIDER_CHARGE_CENTS): number {
  let take = Math.max(0, Math.min(balanceCents, payableCents))
  const left = payableCents - take
  if (left > 0 && left < providerMinimum) take = Math.max(0, payableCents - providerMinimum)
  return take
}

/**
 * The card's share of a part refund: in proportion to how the order was paid (a $100 order paid $20 by card and $80 by
 * Visa gets a fifth of each refund back on the card). Rounded, and never more than the card paid. A whole refund gives
 * the card everything it has not had back (refunds.ts).
 */
export function cardShareOfRefund(order: Pick<Order, 'totalCents' | 'giftCardCents'>, amountCents: number): number {
  if (!(order.giftCardCents > 0) || !(order.totalCents > 0)) return 0
  return Math.min(order.giftCardCents, Math.round((amountCents * order.giftCardCents) / order.totalCents))
}

export function createStoreGiftCards(d: Pick<CrmDeps, 'db' | 'logger'>, core: StoreCore) {
  const { db, logger } = d
  const cards = createBarGiftCards(db as any)

  /** What a shopper sees for a code they typed: its balance, or that it cannot be used. Never who bought it. */
  async function balanceOf(companyId: string, code: string): Promise<{ ok: true; balanceCents: number; code: string } | { ok: false; error: string }> {
    const card = await cards.findCard(companyId, code)
    if (!card) return { ok: false, error: 'That gift card number was not found.' }
    if (card.status !== 'active') return { ok: false, error: 'That gift card is no longer active.' }
    if (card.balanceCents <= 0) return { ok: false, error: 'That gift card has nothing left on it.' }
    return { ok: true, balanceCents: card.balanceCents, code: card.code }
  }

  /**
   * Hold up to `wantCents` of the card for a pending order, writing what was taken on the order in the same transaction.
   * The card row is locked (the bar's spend), so two checkouts at once never take the same dollar. Returns what was held.
   */
  async function hold(companyId: string, orderId: string, cardId: string, wantCents: number): Promise<number> {
    if (!(wantCents > 0)) return 0
    return db.transaction(async (tx: any) => {
      const taken = await cards.spend(tx, companyId, cardId, wantCents, { orderId, byName: 'Online checkout' })
      await tx.update(storeOrder).set({ giftCardId: cardId, giftCardCents: taken, updatedAt: new Date() })
        .where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId)))
      return taken
    })
  }

  /** Give a pending order's hold back (it was never paid). Once per order, whoever asks. */
  async function release(order: Pick<Order, 'id' | 'companyId' | 'giftCardId' | 'giftCardCents'>, why: string): Promise<boolean> {
    if (!order.giftCardId || !(order.giftCardCents > 0)) return false
    try {
      return await db.transaction((tx: any) => cards.putBackOnce(tx, order.companyId, order.giftCardId!, order.giftCardCents, {
        key: `release-${order.id}`, orderId: order.id, byName: 'Online checkout', note: why, kind: 'release',
      }))
    } catch (e: any) {
      logger.warn('[store] gift card hold not given back', { order: order.id, error: e?.message })
      return false
    }
  }

  /**
   * Money back on the card an order was paid with, once per key: the card's balance and the order's
   * giftCardRefundedCents move together, never past what the card paid. What was put back (0 when the key was used).
   */
  async function refundToCard(order: Pick<Order, 'id' | 'companyId' | 'giftCardId' | 'giftCardCents'>, cents: number, key: string, byName: string): Promise<number> {
    if (!order.giftCardId || !(cents > 0)) return 0
    return db.transaction(async (tx: any) => {
      const [now] = await tx.select({ refunded: storeOrder.giftCardRefundedCents }).from(storeOrder)
        .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, order.companyId))).limit(1).for('update')
      const back = Math.min(cents, Math.max(0, order.giftCardCents - (now?.refunded ?? 0)))
      if (!(back > 0)) return 0
      const moved = await cards.putBackOnce(tx, order.companyId, order.giftCardId!, back, { key: `gc-${key}`, orderId: order.id, byName, note: 'Order refunded' })
      if (!moved) return 0
      await tx.update(storeOrder).set({ giftCardRefundedCents: (now?.refunded ?? 0) + back, updatedAt: new Date() })
        .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, order.companyId)))
      return back
    })
  }

  /**
   * STORE CREDIT: money owed back to a shopper that stays with the shop, as a gift card in their name (any amount; the
   * same code, balance and ledger as any card, spent at checkout the same way). Once per key: a retry hands back the card
   * it made. `created` says whether THIS call made it (only that one tells the shopper).
   */
  async function issueCredit(order: Pick<Order, 'id' | 'companyId' | 'customerEmail' | 'customerName'>, cents: number, key: string, byName: string): Promise<{ id: string; code: string; cents: number; created: boolean }> {
    return db.transaction(async (tx: any) => {
      const [had] = await tx.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, order.companyId), eq(barGiftCard.idempotencyKey, key))).limit(1)
      if (had) return { id: had.id, code: had.code, cents: had.initialCents, created: false }
      const card = await cards.issueCard(tx, order.companyId, {
        cents, soldVia: 'store_credit', soldByName: byName, orderId: order.id, idempotencyKey: key, credit: true,
        purchaserName: order.customerName, purchaserEmail: order.customerEmail, message: 'Store credit from a return',
      })
      return { id: card.id, code: card.code, cents: card.initialCents, created: true }
    })
  }

  /** The store credit a shopper holds (cards issued to their email for a return that still have a balance). */
  async function creditOf(companyId: string, email: string): Promise<Array<{ code: string; balanceCents: number; initialCents: number }>> {
    const rows: Array<typeof barGiftCard.$inferSelect> = await db.select().from(barGiftCard)
      .where(and(eq(barGiftCard.companyId, companyId), eq(barGiftCard.soldVia, 'store_credit'), eq(barGiftCard.status, 'active')))
      .orderBy(desc(barGiftCard.createdAt))
    const mine = email.trim().toLowerCase()
    return rows.filter((r) => (r.purchaserEmail || '').trim().toLowerCase() === mine && r.balanceCents > 0)
      .map((r) => ({ code: r.code, balanceCents: r.balanceCents, initialCents: r.initialCents }))
  }

  /**
   * The cards a paid order bought: one per unit of each gift-card line, at the line's price, emailed to the buyer with
   * their codes. Each is keyed to its order line and unit, so a second finalize issues nothing twice.
   */
  async function issueForOrder(order: Order): Promise<number> {
    const items: Array<typeof storeOrderItem.$inferSelect> = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
    const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))]
    if (!productIds.length) return 0
    const kinds: Array<{ id: string; kind: string }> = await db.select({ id: storeProduct.id, kind: storeProduct.kind }).from(storeProduct)
      .where(and(inArray(storeProduct.id, productIds), eq(storeProduct.companyId, order.companyId)))
    const giftProducts = new Set(kinds.filter((k) => k.kind === 'gift_card').map((k) => k.id))
    const lines = items.filter((i) => i.productId && giftProducts.has(i.productId))
    if (!lines.length) return 0
    const issued: Array<{ code: string; cents: number }> = []
    for (const line of lines) {
      for (let n = 1; n <= line.quantity; n++) {
        const key = `order-${order.id}-${line.id}-${n}`
        try {
          const card = await db.transaction(async (tx: any) => {
            const [had] = await tx.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, order.companyId), eq(barGiftCard.idempotencyKey, key))).limit(1)
            if (had) return null
            return cards.issueCard(tx, order.companyId, {
              cents: line.unitPriceCents, soldVia: 'online', soldByName: 'Online store', orderId: order.id, idempotencyKey: key,
              purchaserName: order.customerName, purchaserEmail: order.customerEmail,
            })
          })
          if (card) issued.push({ code: card.code, cents: card.initialCents })
        } catch (e: any) {
          logger.error('[store] gift card not issued', { order: order.id, line: line.id, error: e?.message })
        }
      }
    }
    if (issued.length) {
      const co = await core.shop()
      void core.mail(order.customerEmail, 'storeGiftCard', { orderNumber: order.orderNumber, currency: order.currency, cards: issued, supportEmail: co?.email }, co?.email)
    }
    return issued.length
  }

  /** The cards an order bought, for its page (the codes are the buyer's; the screen shows them to who may refund). */
  async function cardsOfOrder(companyId: string, orderId: string) {
    return db.select({ id: barGiftCard.id, code: barGiftCard.code, initialCents: barGiftCard.initialCents, balanceCents: barGiftCard.balanceCents, status: barGiftCard.status })
      .from(barGiftCard).where(and(eq(barGiftCard.companyId, companyId), eq(barGiftCard.orderId, orderId)))
  }

  /** A card's movements, newest first, with the order each was for. */
  async function history(companyId: string, cardId: string) {
    return db.select().from(barGiftCardLedger)
      .where(and(eq(barGiftCardLedger.companyId, companyId), eq(barGiftCardLedger.cardId, cardId)))
      .orderBy(desc(barGiftCardLedger.at), desc(barGiftCardLedger.id)).limit(100)
  }

  return { cards, balanceOf, hold, release, refundToCard, issueCredit, creditOf, issueForOrder, cardsOfOrder, history }
}
export type StoreGiftCards = ReturnType<typeof createStoreGiftCards>
