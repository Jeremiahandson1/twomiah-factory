// The gift cards a shopper holds, for their account page (parity row 5, 2026-10-31): the cards they BOUGHT (their email is the
// purchaser's) and the cards they were GIVEN (their email is the recipient's), with the balance and the code that spends it.
// Store credit from a return (sold_via 'store_credit') is shown apart, by the store's own credit list, so it is left out here.
// A card voided by the shop is not shown. A spent card (balance 0) still is: "used up" tells the shopper it is not lost.
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { barGiftCard } from '../db/schema/bar.ts'

export interface ShopperGiftCard { code: string; balanceCents: number; initialCents: number; relation: 'bought' | 'given'; createdAt: Date }

export async function giftCardsForEmail(db: any, companyId: string, email: string, limit = 50): Promise<ShopperGiftCard[]> {
  const mine = email.trim().toLowerCase()
  if (!mine) return []
  const rows = await db.select().from(barGiftCard).where(and(
    eq(barGiftCard.companyId, companyId), eq(barGiftCard.status, 'active'), ne(barGiftCard.soldVia, 'store_credit'),
    sql`(lower(trim(${barGiftCard.purchaserEmail})) = ${mine} or lower(trim(${barGiftCard.recipientEmail})) = ${mine})`,
  )).orderBy(desc(barGiftCard.createdAt), desc(barGiftCard.id)).limit(limit)
  return rows.map((r: any) => ({
    code: r.code, balanceCents: r.balanceCents, initialCents: r.initialCents, createdAt: r.createdAt,
    relation: String(r.purchaserEmail || '').trim().toLowerCase() === mine ? 'bought' : 'given',
  }))
}
