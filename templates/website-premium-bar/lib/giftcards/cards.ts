/**
 * lib/giftcards/cards.ts — the bar's own gift cards.
 *
 * Codes read aloud over a bar: "AMBR-7K2Q-9XMP", Crockford-style (no I, L,
 * O, U, no 0/1 mix-ups), ~40 bits of randomness, so guessing is hopeless and
 * the balance lookup is rate-limited anyway. A pre-printed card's own number
 * can be used instead. No expiration, no fees.
 *
 * Every balance change goes through the ledger inside a transaction with the
 * card row locked (SELECT … FOR UPDATE), so two tablets can't spend the same
 * dollar twice.
 */
import crypto from 'crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { giftCardLedger, giftCards } from '../../db/schema'

export class GiftCardError extends Error { constructor(message: string, public status = 400) { super(message) } }

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // Crockford base32

export function generateCode(prefix = 'AMBR'): string {
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % 32]
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`
}

/** What people type → what's stored: upper case, look-alikes fixed (O→0, I/L→1), dashes normalised. */
export function normalizeCode(raw: string): string {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (/^AMBR[0-9A-Z]{8}$/.test(s)) return `AMBR-${s.slice(4, 8)}-${s.slice(8)}`
  return s   // a pre-printed card's own number, kept as digits/letters only
}

export const MIN_CARD_CENTS = 500
export const MAX_CARD_CENTS = 50000

export function validAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_CARD_CENTS && cents <= MAX_CARD_CENTS
}

type Tx = Parameters<Parameters<typeof DB.transaction>[0]>[0]

/** Create a card with its opening ledger row. `code` may be a pre-printed number. */
export async function issueCard(tx: Tx | typeof DB, input: {
  cents: number; soldVia: 'register' | 'online'; soldBy?: string | null; checkId?: string | null; code?: string | null
  purchaserName?: string | null; purchaserEmail?: string | null; recipientName?: string | null; recipientEmail?: string | null; message?: string | null
  squarePaymentId?: string | null; idempotencyKey?: string | null
}): Promise<typeof giftCards.$inferSelect> {
  if (!validAmount(input.cents)) throw new GiftCardError(`A gift card is $${MIN_CARD_CENTS / 100} to $${MAX_CARD_CENTS / 100}.`)
  let code = input.code ? normalizeCode(input.code) : generateCode()
  if (input.code && code.length < 6) throw new GiftCardError('That card number is too short.')
  if (input.code) {
    const [taken] = await tx.select({ id: giftCards.id }).from(giftCards).where(eq(giftCards.code, code)).limit(1)
    if (taken) throw new GiftCardError('That card number is already in use.', 409)
  } else {
    for (let n = 0; n < 5; n++) {
      const [taken] = await tx.select({ id: giftCards.id }).from(giftCards).where(eq(giftCards.code, code)).limit(1)
      if (!taken) break
      code = generateCode()
    }
  }
  const [card] = await tx.insert(giftCards).values({
    code, initialCents: input.cents, balanceCents: input.cents, soldVia: input.soldVia, soldBy: input.soldBy || null, checkId: input.checkId || null,
    purchaserName: input.purchaserName || null, purchaserEmail: input.purchaserEmail || null, recipientName: input.recipientName || null,
    recipientEmail: input.recipientEmail || null, message: input.message || null, squarePaymentId: input.squarePaymentId || null, idempotencyKey: input.idempotencyKey || null,
  }).returning()
  await tx.insert(giftCardLedger).values({ cardId: card.id, amountCents: input.cents, kind: 'issue', checkId: input.checkId || null, by: input.soldBy || input.soldVia })
  return card
}

export async function findCard(db: Tx | typeof DB, raw: string): Promise<typeof giftCards.$inferSelect | null> {
  const code = normalizeCode(raw)
  if (!code) return null
  const [card] = await db.select().from(giftCards).where(eq(giftCards.code, code)).limit(1)
  return card || null
}

/** Take up to `wantCents` off a card inside the caller's transaction. Returns what was actually taken. */
export async function spend(tx: Tx, cardId: string, wantCents: number, ref: { checkId: string; paymentId?: string | null; by: string }): Promise<number> {
  const locked = await tx.execute(sql`select id, balance_cents, status from gift_cards where id = ${cardId} for update`)
  const row: any = (locked as any).rows?.[0] ?? (locked as any)[0]
  if (!row) throw new GiftCardError('That card is gone.', 404)
  if (row.status !== 'active') throw new GiftCardError('That card was voided.', 409)
  const take = Math.min(wantCents, Number(row.balance_cents))
  if (take <= 0) throw new GiftCardError('That card has nothing left on it.', 409)
  await tx.update(giftCards).set({ balanceCents: sql`${giftCards.balanceCents} - ${take}` }).where(eq(giftCards.id, cardId))
  await tx.insert(giftCardLedger).values({ cardId, amountCents: -take, kind: 'redeem', checkId: ref.checkId, paymentId: ref.paymentId || null, by: ref.by })
  return take
}

/** Put money back on a card (a voided gift-card payment). */
export async function refundTo(tx: Tx, cardId: string, cents: number, ref: { checkId?: string | null; paymentId?: string | null; by: string; note?: string }): Promise<void> {
  await tx.update(giftCards).set({ balanceCents: sql`${giftCards.balanceCents} + ${cents}` }).where(eq(giftCards.id, cardId))
  await tx.insert(giftCardLedger).values({ cardId, amountCents: cents, kind: 'refund', checkId: ref.checkId || null, paymentId: ref.paymentId || null, by: ref.by, note: ref.note || null })
}

export async function cardHistory(db: typeof DB, cardId: string) {
  return db.select().from(giftCardLedger).where(eq(giftCardLedger.cardId, cardId)).orderBy(desc(giftCardLedger.at)).limit(100)
}

/** Correct a balance by hand (a card that got wet, a comp). Logged with who and why; never below zero. */
export async function adjustCard(db: typeof DB, cardId: string, deltaCents: number, reason: string, by: string): Promise<typeof giftCards.$inferSelect> {
  const why = String(reason || '').trim().slice(0, 120)
  if (!why) throw new GiftCardError('Say why.')
  const delta = Math.round(Number(deltaCents))
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_CARD_CENTS) throw new GiftCardError('Enter an amount to add or take off.')
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select balance_cents, status from gift_cards where id = ${cardId} for update`)
    const row: any = (locked as any).rows?.[0] ?? (locked as any)[0]
    if (!row) throw new GiftCardError('That card is gone.', 404)
    if (row.status !== 'active') throw new GiftCardError('That card was voided.', 409)
    const next = Number(row.balance_cents) + delta
    if (next < 0) throw new GiftCardError('That would take the card below zero.', 409)
    if (next > MAX_CARD_CENTS) throw new GiftCardError(`A card can't hold more than ${MAX_CARD_CENTS / 100}.`, 409)
    const [card] = await tx.update(giftCards).set({ balanceCents: next }).where(eq(giftCards.id, cardId)).returning()
    await tx.insert(giftCardLedger).values({ cardId, amountCents: delta, kind: 'adjust', by, note: why })
    return card
  })
}

export async function voidCard(db: typeof DB, cardId: string, reason: string, by: string): Promise<void> {
  const why = String(reason || '').trim().slice(0, 120)
  if (!why) throw new GiftCardError('Say why.')
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(giftCards).where(and(eq(giftCards.id, cardId), eq(giftCards.status, 'active'))).limit(1)
    if (!c) throw new GiftCardError('That card is not active.', 409)
    await tx.update(giftCards).set({ status: 'void', voidedAt: new Date(), voidReason: `${why} (${by})`, balanceCents: 0 }).where(eq(giftCards.id, cardId))
    await tx.insert(giftCardLedger).values({ cardId, amountCents: -c.balanceCents, kind: 'void', by, note: why })
  })
}
