// The bar's queries that carry SQL expressions (templates/crm-bar/backend/src/services: barGiftCards, barLoyalty,
// barRegister, barStock): counters that only go forwards, balances moved in the database, a phone matched on its
// digits, a count of lines. One named function per query, each returning camelCase objects; the rules around them
// stay in server/crm/bar/*.
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm'
import { barGiftCard, barSettings, barStockCount, barStockCountLine, contact, loyaltyMember, loyaltyReward } from '../db/schema/index.ts'

// ─── Counters (bar_settings): a number that only goes forwards, never MAX+1 ──────────────────────────────

/** The next check number for this company, inside the caller's transaction. */
export async function nextCheckNumber(tx: any, companyId: string): Promise<number> {
  await tx.insert(barSettings).values({ companyId }).onConflictDoNothing({ target: barSettings.companyId })
  const [r] = await tx.update(barSettings).set({ checkSeq: sql`${barSettings.checkSeq} + 1` }).where(eq(barSettings.companyId, companyId)).returning({ n: barSettings.checkSeq })
  return r.n
}

/** The next purchase-order number for this company, inside the caller's transaction. */
export async function nextPoNumber(tx: any, companyId: string): Promise<number> {
  await tx.insert(barSettings).values({ companyId }).onConflictDoNothing({ target: barSettings.companyId })
  const [r] = await tx.update(barSettings).set({ poSeq: sql`${barSettings.poSeq} + 1` }).where(eq(barSettings.companyId, companyId)).returning({ n: barSettings.poSeq })
  return r.n
}

// ─── Gift cards ─────────────────────────────────────────────────────────────────────────────────────

/** Keep the bar's gift-card prefix once set: write it only where none is stored yet. */
export async function keepGiftCardPrefix(tx: any, companyId: string, prefix: string): Promise<void> {
  await tx.update(barSettings).set({ giftCardPrefix: sql`coalesce(${barSettings.giftCardPrefix}, ${prefix})` }).where(eq(barSettings.companyId, companyId))
}

/** Take cents off a card's balance in the database (the row is locked by the caller). */
export async function takeFromCard(tx: any, cardId: string, cents: number): Promise<void> {
  await tx.update(barGiftCard).set({ balanceCents: sql`${barGiftCard.balanceCents} - ${cents}` }).where(eq(barGiftCard.id, cardId))
}

/** Put cents back on a card's balance in the database (the row is locked by the caller). */
export async function putBackOnCard(tx: any, cardId: string, cents: number): Promise<void> {
  await tx.update(barGiftCard).set({ balanceCents: sql`${barGiftCard.balanceCents} + ${cents}` }).where(eq(barGiftCard.id, cardId))
}

// ─── The Regulars ───────────────────────────────────────────────────────────────────────────────────

/** A contact whose phone or mobile, digits only, contains these digits. */
const phoneHasDigits = (digits: string) => or(
  sql`regexp_replace(coalesce(${contact.phone}, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}`,
  sql`regexp_replace(coalesce(${contact.mobile}, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}`,
)

/** The register's guest search: by phone digits, or by name or email; eight at most, by name. */
export async function guestSearchRows(db: any, companyId: string, term: string, digits: string, byPhone: boolean) {
  return db.select({ id: contact.id, name: contact.name, phone: contact.phone, mobile: contact.mobile, email: contact.email, tags: contact.tags })
    .from(contact)
    .where(and(eq(contact.companyId, companyId), byPhone ? phoneHasDigits(digits) : or(ilike(contact.name, `%${term}%`), ilike(contact.email, `%${term}%`))))
    .orderBy(contact.name).limit(8) as Promise<Array<{ id: string; name: string; phone: string | null; mobile: string | null; email: string | null; tags: unknown }>>
}

/** Everyone on the programme with their points, newest activity first (never-active last), optionally searched. */
export async function regularsRows(db: any, companyId: string, term: string, digits: string, byPhone: boolean) {
  const match = !term ? undefined : byPhone ? phoneHasDigits(digits) : or(ilike(contact.name, `%${term}%`), ilike(contact.email, `%${term}%`))
  return db.select({
    contactId: contact.id, name: contact.name, phone: contact.phone, mobile: contact.mobile,
    pointsBalance: loyaltyMember.pointsBalance, lifetimePoints: loyaltyMember.lifetimePoints, joinedAt: loyaltyMember.joinedAt, lastActivityAt: loyaltyMember.lastActivityAt,
  }).from(loyaltyMember)
    .innerJoin(contact, and(eq(contact.id, loyaltyMember.contactId), eq(contact.companyId, companyId)))
    .where(and(eq(loyaltyMember.companyId, companyId), match))
    .orderBy(sql`${loyaltyMember.lastActivityAt} desc nulls last`, contact.name)
    .limit(200) as Promise<Array<{ contactId: string; name: string; phone: string | null; mobile: string | null; pointsBalance: number; lifetimePoints: number; joinedAt: Date; lastActivityAt: Date | null }>>
}

/** A reward used once more (redeemed on a check). */
export async function rewardUsedOnce(tx: any, rewardId: string): Promise<void> {
  await tx.update(loyaltyReward).set({ usageCount: sql`${loyaltyReward.usageCount} + 1`, updatedAt: new Date() }).where(eq(loyaltyReward.id, rewardId))
}

/** A redemption taken back: one use fewer, never below zero. */
export async function rewardUseTakenBack(tx: any, rewardId: string): Promise<void> {
  await tx.update(loyaltyReward).set({ usageCount: sql`greatest(${loyaltyReward.usageCount} - 1, 0)` }).where(eq(loyaltyReward.id, rewardId))
}

// ─── Stock counts ───────────────────────────────────────────────────────────────────────────────────

/** How many items a count has lines for. */
export async function countLineTotal(db: any, companyId: string, countId: string): Promise<number> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(barStockCountLine).where(and(eq(barStockCountLine.companyId, companyId), eq(barStockCountLine.countId, countId)))
  return n?.n ?? 0
}

/** The finished count before this moment, the latest first. */
export async function finishedCountBefore(db: any, companyId: string, before: Date) {
  const [prev] = await db.select().from(barStockCount)
    .where(and(eq(barStockCount.companyId, companyId), eq(barStockCount.status, 'done'), lt(barStockCount.finishedAt, before))).orderBy(desc(barStockCount.finishedAt)).limit(1)
  return (prev ?? null) as typeof barStockCount.$inferSelect | null
}
