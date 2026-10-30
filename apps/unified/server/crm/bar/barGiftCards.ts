// The bar's own gift cards: sold on the register (a gift-card line on a check, issued when the check is paid),
// spent as a tender, looked up, corrected and voided by a manager. Routes: barGiftCards routes, and the register's
// pay/sell actions (barRegister.ts).
//
// Codes are read aloud over a bar: "AMBE-7K2Q-9XMP" — Crockford-style (no I, L, O or U, so no 0/O or 1/I/L
// mix-ups), 40 bits of randomness, so guessing is hopeless (and lookups are rate-limited anyway). The prefix is
// the bar's own, taken from its name the first time a card is issued and kept on bar_settings. A pre-printed
// card's own number can be used instead. No expiry and no fees, ever.
//
// Every balance change goes through the ledger inside a transaction with the card row locked (FOR UPDATE), so
// two tablets cannot spend the same dollar twice. Moved from templates/crm-bar/backend/src/services/barGiftCards.ts
// (ported there from website-premium-bar's lib/giftcards/cards.ts, Amber Inn 9/27), made with the app's database;
// the balance arithmetic in SQL is server/data/bar.ts.
import crypto from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { barGiftCard, barGiftCardLedger, barSettings, company } from '../../db/schema/index.ts'
import { keepGiftCardPrefix, putBackOnCard, takeFromCard } from '../../data/bar.ts'
import type { BarDb } from './db.ts'

type Tx = any
export type GiftCard = typeof barGiftCard.$inferSelect

export class GiftCardError extends Error { constructor(message: string, public status = 400) { super(message) } }

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // Crockford base32: no I, L, O, U

export const MIN_CARD_CENTS = 500
export const MAX_CARD_CENTS = 50000

export function validAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_CARD_CENTS && cents <= MAX_CARD_CENTS
}

/** Four letters from the bar's name that read back unambiguously ("Amber Inn" → "AMBE"); padded with X. */
export function prefixFromName(name: string): string {
  const letters = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/[ILOU]/g, '')
  return (letters + 'XXXX').slice(0, 4)
}

export function generateCode(prefix: string): string {
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % 32]
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`
}

/** What people type → what's stored: upper case, look-alikes fixed (O→0, I/L→1), this bar's codes re-dashed. */
export function normalizeCode(raw: string, prefix: string): string {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (prefix && s.length === 12 && s.startsWith(prefix) && /^[0-9A-Z]{8}$/.test(s.slice(4))) return `${prefix}-${s.slice(4, 8)}-${s.slice(8)}`
  return s   // a pre-printed card's own number, kept as letters and digits only
}

export interface IssueInput {
  cents: number; soldVia: 'register' | 'online' | 'store_credit'; soldByName?: string | null; checkId?: string | null; code?: string | null
  purchaserName?: string | null; purchaserEmail?: string | null; recipientName?: string | null; recipientEmail?: string | null; message?: string | null
  providerPaymentId?: string | null; idempotencyKey?: string | null
  /** The store's order that paid for it (a gift-card product sold online). */
  orderId?: string | null
  /** Store credit given back on a return (soldVia 'store_credit'): any positive amount, not only what a card is sold at. */
  credit?: boolean
}

export function createBarGiftCards(db: BarDb) {
  /** This bar's prefix: kept once set, so renaming the bar never changes the codes people hold. */
  async function cardPrefix(companyId: string, tx: Tx = db): Promise<string> {
    const [s] = await tx.select({ prefix: barSettings.giftCardPrefix }).from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    if (s?.prefix) return s.prefix
    const [co] = await tx.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const prefix = prefixFromName(co?.name || '')
    await tx.insert(barSettings).values({ companyId, giftCardPrefix: prefix }).onConflictDoNothing({ target: barSettings.companyId })
    await keepGiftCardPrefix(tx, companyId, prefix)
    const [again] = await tx.select({ prefix: barSettings.giftCardPrefix }).from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    return again?.prefix || prefix
  }

  /** Create a card with its opening ledger row, inside `tx`. `code` may be a pre-printed number. */
  async function issueCard(tx: Tx, companyId: string, input: IssueInput): Promise<GiftCard> {
    if (input.credit ? !(Number.isInteger(input.cents) && input.cents > 0) : !validAmount(input.cents)) throw new GiftCardError(`A gift card is $${MIN_CARD_CENTS / 100} to $${MAX_CARD_CENTS / 100}.`)
    const prefix = await cardPrefix(companyId, tx)
    let code = input.code ? normalizeCode(input.code, prefix) : generateCode(prefix)
    if (input.code && code.length < 6) throw new GiftCardError('That card number is too short.')
    const taken = async (c: string) => (await tx.select({ id: barGiftCard.id }).from(barGiftCard).where(and(eq(barGiftCard.companyId, companyId), eq(barGiftCard.code, c))).limit(1)).length > 0
    if (input.code) {
      if (await taken(code)) throw new GiftCardError('That card number is already in use.', 409)
    } else {
      for (let n = 0; n < 5 && await taken(code); n++) code = generateCode(prefix)
    }
    const [card] = await tx.insert(barGiftCard).values({
      code, initialCents: input.cents, balanceCents: input.cents, soldVia: input.soldVia, soldByName: input.soldByName || null, checkId: input.checkId || null,
      purchaserName: input.purchaserName || null, purchaserEmail: input.purchaserEmail || null, recipientName: input.recipientName || null,
      recipientEmail: input.recipientEmail || null, message: input.message || null, providerPaymentId: input.providerPaymentId || null,
      idempotencyKey: input.idempotencyKey || null, orderId: input.orderId || null, companyId,
    }).returning()
    await tx.insert(barGiftCardLedger).values({ cardId: card.id, amountCents: input.cents, kind: 'issue', checkId: input.checkId || null, orderId: input.orderId || null, byName: input.soldByName || input.soldVia, companyId })
    return card
  }

  async function findCard(companyId: string, raw: string, tx: Tx = db): Promise<GiftCard | null> {
    const code = normalizeCode(raw, await cardPrefix(companyId, tx))
    if (!code) return null
    const [card] = await tx.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, companyId), eq(barGiftCard.code, code))).limit(1)
    return card || null
  }

  async function lockCard(tx: Tx, companyId: string, cardId: string): Promise<GiftCard> {
    const [row] = await tx.select().from(barGiftCard).where(and(eq(barGiftCard.id, cardId), eq(barGiftCard.companyId, companyId))).limit(1).for('update')
    if (!row) throw new GiftCardError('That card is gone.', 404)
    return row
  }

  /** Take up to `wantCents` off a card inside the caller's transaction. Returns what was actually taken. */
  async function spend(tx: Tx, companyId: string, cardId: string, wantCents: number, ref: { checkId?: string | null; orderId?: string | null; paymentId?: string | null; byName: string }): Promise<number> {
    const row = await lockCard(tx, companyId, cardId)
    if (row.status !== 'active') throw new GiftCardError('That card was voided.', 409)
    const take = Math.min(wantCents, row.balanceCents)
    if (take <= 0) throw new GiftCardError('That card has nothing left on it.', 409)
    await takeFromCard(tx, cardId, take)
    await tx.insert(barGiftCardLedger).values({ cardId, amountCents: -take, kind: 'redeem', checkId: ref.checkId || null, orderId: ref.orderId || null, paymentId: ref.paymentId || null, byName: ref.byName, companyId })
    return take
  }

  /**
   * Put money back on a card ONCE for this key (a store order refunded to the card, or a checkout's hold given back),
   * inside the caller's transaction. A retry with the same key moves nothing. True when this call moved it.
   */
  async function putBackOnce(tx: Tx, companyId: string, cardId: string, cents: number, ref: { key: string; orderId?: string | null; byName: string; note?: string; kind?: 'refund' | 'release' }): Promise<boolean> {
    if (!(cents > 0)) return false
    await lockCard(tx, companyId, cardId)
    const [row] = await tx.insert(barGiftCardLedger).values({
      cardId, amountCents: cents, kind: ref.kind || 'refund', orderId: ref.orderId || null, byName: ref.byName, note: ref.note || null,
      idempotencyKey: ref.key, companyId,
    }).onConflictDoNothing().returning({ id: barGiftCardLedger.id })
    if (!row) return false
    await putBackOnCard(tx, cardId, cents)
    return true
  }

  /** Put money back on a card (a voided gift-card payment), inside the caller's transaction. */
  async function refundTo(tx: Tx, companyId: string, cardId: string, cents: number, ref: { checkId?: string | null; paymentId?: string | null; byName: string; note?: string }): Promise<void> {
    await lockCard(tx, companyId, cardId)
    await putBackOnCard(tx, cardId, cents)
    await tx.insert(barGiftCardLedger).values({ cardId, amountCents: cents, kind: 'refund', checkId: ref.checkId || null, paymentId: ref.paymentId || null, byName: ref.byName, note: ref.note || null, companyId })
  }

  async function cardHistory(companyId: string, cardId: string): Promise<Array<typeof barGiftCardLedger.$inferSelect>> {
    return db.select().from(barGiftCardLedger).where(and(eq(barGiftCardLedger.companyId, companyId), eq(barGiftCardLedger.cardId, cardId))).orderBy(desc(barGiftCardLedger.at)).limit(100)
  }

  /** Correct a balance by hand (a card that went through the wash, a comp). Who and why, never below zero. */
  async function adjustCard(companyId: string, cardId: string, deltaCents: unknown, reason: unknown, byName: string): Promise<GiftCard> {
    const why = String(reason || '').trim().slice(0, 120)
    if (!why) throw new GiftCardError('Say why.')
    const delta = Math.round(Number(deltaCents))
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_CARD_CENTS) throw new GiftCardError('Enter an amount to add or take off.')
    return db.transaction(async (tx: Tx) => {
      const row = await lockCard(tx, companyId, cardId)
      if (row.status !== 'active') throw new GiftCardError('That card was voided.', 409)
      const next = row.balanceCents + delta
      if (next < 0) throw new GiftCardError('That would take the card below zero.', 409)
      if (next > MAX_CARD_CENTS) throw new GiftCardError(`A card can't hold more than $${MAX_CARD_CENTS / 100}.`, 409)
      const [card] = await tx.update(barGiftCard).set({ balanceCents: next }).where(eq(barGiftCard.id, cardId)).returning()
      await tx.insert(barGiftCardLedger).values({ cardId, amountCents: delta, kind: 'adjust', byName, note: why, companyId })
      return card
    })
  }

  async function voidCard(companyId: string, cardId: string, reason: unknown, byName: string): Promise<void> {
    const why = String(reason || '').trim().slice(0, 120)
    if (!why) throw new GiftCardError('Say why.')
    await db.transaction(async (tx: Tx) => {
      const c = await lockCard(tx, companyId, cardId)
      if (c.status !== 'active') throw new GiftCardError('That card is not active.', 409)
      await tx.update(barGiftCard).set({ status: 'void', voidedAt: new Date(), voidReason: `${why} (${byName})`, balanceCents: 0 }).where(eq(barGiftCard.id, cardId))
      await tx.insert(barGiftCardLedger).values({ cardId, amountCents: -c.balanceCents, kind: 'void', byName, note: why, companyId })
    })
  }

  /** Every card, newest first, with the total still owed on them (what the bar owes its guests in food and drink). */
  async function listCards(companyId: string, q = '') {
    const prefix = await cardPrefix(companyId)
    const rows: GiftCard[] = await db.select().from(barGiftCard).where(eq(barGiftCard.companyId, companyId)).orderBy(desc(barGiftCard.createdAt)).limit(500)
    const t = q.trim().toLowerCase(), code = t ? normalizeCode(t, prefix) : ''
    const shown = t ? rows.filter((r) => r.code === code || r.code.toLowerCase().includes(t) || (r.recipientName || '').toLowerCase().includes(t) || (r.purchaserName || '').toLowerCase().includes(t)) : rows
    const outstandingCents = rows.filter((r) => r.status === 'active').reduce((s, r) => s + r.balanceCents, 0)
    return { cards: shown, outstandingCents, prefix }
  }

  return { cardPrefix, issueCard, findCard, lockCard, spend, putBackOnce, refundTo, cardHistory, adjustCard, voidCard, listCards }
}
export type BarGiftCards = ReturnType<typeof createBarGiftCards>
