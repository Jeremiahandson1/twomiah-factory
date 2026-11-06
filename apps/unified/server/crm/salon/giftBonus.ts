// The free promotional part of a gift card (salon parity row 19; owner decision 2026-10-31): "buy $100, get $20".
//
//   · What the client PAID never expires, and no setting can make it. Only the free bonus may carry a last day, printed on the card and in the email.
//   · The bonus is part of the card's balance. It is spent FIRST (while it is live) so a client never loses it by spending the paid money first.
//   · After its last day the bonus can no longer be spent and comes off the balance (a ledger line says so); the paid part stays spendable.
// Pure arithmetic and the offers the salon sets; the card's own rows are in ./giftCards.ts.

export const OFFERS_KEY = 'salonGiftOffers'
export const MAX_OFFERS = 8
export const MIN_BUY_CENTS = 500
export const MAX_BUY_CENTS = 100_000
export const MAX_VALID_DAYS = 730

export interface GiftOffer { id: string; buyCents: number; bonusCents: number; validDays: number | null }

export interface BonusCard { balanceCents: number; bonusCents: number; bonusExpiresOn: string | null }

/** Whether the card's bonus has run out of time on `today` (the salon's day, YYYY-MM-DD). */
export const bonusExpired = (c: BonusCard, today: string): boolean => c.bonusCents > 0 && !!c.bonusExpiresOn && c.bonusExpiresOn < today

/** What can be spent today: the whole balance, less a bonus whose last day has passed. */
export const spendableCents = (c: BonusCard, today: string): number => Math.max(0, c.balanceCents - (bonusExpired(c, today) ? c.bonusCents : 0))

/** Spending `cents` today: the live bonus first, then the paid part. Null when there is not that much to spend. */
export function splitSpend(c: BonusCard, cents: number, today: string): { fromBonus: number; fromPaid: number } | null {
  if (!Number.isInteger(cents) || cents <= 0 || cents > spendableCents(c, today)) return null
  const live = bonusExpired(c, today) ? 0 : c.bonusCents
  const fromBonus = Math.min(live, cents)
  return { fromBonus, fromPaid: cents - fromBonus }
}

/** The salon's offers, as saved (anything malformed is dropped, never thrown). */
export function readOffers(settings: unknown): GiftOffer[] {
  const raw = (settings as any)?.[OFFERS_KEY]
  const parsed = Array.isArray(raw) ? parseOffers(raw) : null
  return parsed && 'offers' in parsed ? parsed.offers : []
}

/** Offers typed or sent: each is buy $X, get $Y free, optionally spendable for N days. The first sentence of trouble, else the clean list with ids. */
export function parseOffers(raw: unknown): { offers: GiftOffer[] } | { problem: string } {
  if (!Array.isArray(raw)) return { problem: 'Send the offers as a list.' }
  if (raw.length > MAX_OFFERS) return { problem: `At most ${MAX_OFFERS} offers.` }
  const seen = new Set<number>()
  const out: GiftOffer[] = []
  for (const o of raw as any[]) {
    const buy = Number(o?.buyCents), bonus = Number(o?.bonusCents)
    if (!Number.isInteger(buy) || buy < MIN_BUY_CENTS || buy > MAX_BUY_CENTS) return { problem: 'Each offer is bought for $5 to $1,000.' }
    if (!Number.isInteger(bonus) || bonus <= 0 || bonus > buy) return { problem: 'The free bonus is more than nothing and no more than the amount bought.' }
    if (buy + bonus > MAX_BUY_CENTS) return { problem: 'A card cannot hold more than $1,000, bonus included.' }
    if (seen.has(buy)) return { problem: 'Each amount can have one offer.' }
    seen.add(buy)
    const v = o?.validDays == null || o.validDays === '' ? null : Number(o.validDays)
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > MAX_VALID_DAYS)) return { problem: `The bonus can be kept for 1 to ${MAX_VALID_DAYS} days, or not expire.` }
    out.push({ id: `b${buy}`, buyCents: buy, bonusCents: bonus, validDays: v })
  }
  return { offers: out.sort((a, b) => a.buyCents - b.buyCents) }
}

/** The last day of an offer's bonus bought on `today`: today plus validDays, or null. */
export function lastDayOf(offer: GiftOffer, today: string, shift: (day: string, days: number) => string): string | null {
  return offer.validDays == null ? null : shift(today, offer.validDays)
}

/** "Includes $20 free bonus, spend by 12/31/2026. The $100 you paid does not expire." — the sentence printed on the email and shown with the card. */
export function bonusSentence(c: { initialCents: number; bonusGrantedCents: number; bonusExpiresOn: string | null }, fmt: (cents: number) => string, fmtDay: (day: string) => string): string {
  if (!(c.bonusGrantedCents > 0)) return 'It has no expiry date.'
  const paid = `The ${fmt(c.initialCents)} paid for it does not expire.`
  return c.bonusExpiresOn ? `It includes a free ${fmt(c.bonusGrantedCents)} bonus to spend by ${fmtDay(c.bonusExpiresOn)}. ${paid}` : `It includes a free ${fmt(c.bonusGrantedCents)} bonus. ${paid}`
}
