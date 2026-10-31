// The store core's raw SQL (RULEBOOK §2), for server/crm/store/core.ts: a shopper found by email whatever its case, a
// reward's use counted in the statement that writes it, and the loyalty member locked for the one pass that spends and
// earns an order's points (templates/crm-store/backend/src/services/loyalty.ts settleLoyaltyForPaidOrder).
import { and, asc, eq, notInArray, sql } from 'drizzle-orm'
import { contact, loyaltyReward } from '../db/schema/index.ts'
import { storeOrder } from '../db/schema/store.ts'

/** The company's contact with this email, compared lower-cased (the address is stored as typed). Oldest first. */
export async function contactByEmail(db: any, companyId: string, emailLower: string): Promise<any | null> {
  const [row] = await db.select().from(contact)
    .where(and(eq(contact.companyId, companyId), sql`lower(${contact.email}) = ${emailLower}`))
    .orderBy(asc(contact.createdAt), asc(contact.id)).limit(1)
  return row || null
}

/** One more use of a reward, counted by the database (two orders settling at once both count). */
export async function countRewardUse(tx: any, rewardId: string, companyId: string): Promise<void> {
  await tx.update(loyaltyReward).set({ usageCount: sql`${loyaltyReward.usageCount} + 1`, updatedAt: new Date() } as any)
    .where(and(eq(loyaltyReward.id, rewardId), eq(loyaltyReward.companyId, companyId)))
}

const rowsOf = (r: any): any[] => ((r as any)?.rows || r) as any[]

export interface LockedMember { pointsBalance: number; lifetimePoints: number; qualifyingVisits: number; punchRewardsEarned: number }

/**
 * The member's figures, read under a row lock held to the end of the caller's transaction. Every movement is decided
 * from these, never from a copy read earlier: two orders paid at the same moment both read 400, both spent 200 and both
 * wrote 200 back (the salon's LY0928 B1/B2, found again in the store's own wiring). Null when there is no such member.
 */
export async function lockLoyaltyMember(tx: any, memberId: string, companyId: string): Promise<LockedMember | null> {
  const r = await tx.execute(sql`
    SELECT points_balance, lifetime_points, qualifying_visits, punch_rewards_earned
    FROM loyalty_members WHERE id = ${memberId} AND company_id = ${companyId} FOR UPDATE
  `)
  const row = rowsOf(r)[0]
  if (!row) return null
  return {
    pointsBalance: Number(row.points_balance) || 0,
    lifetimePoints: Number(row.lifetime_points) || 0,
    qualifyingVisits: Number(row.qualifying_visits) || 0,
    punchRewardsEarned: Number(row.punch_rewards_earned) || 0,
  }
}

/** How many sales this customer has made (an unfinished checkout and a cancelled order are not sales; a refunded one was). */
export async function countedOrdersOf(db: any, companyId: string, contactId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(storeOrder)
    .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.contactId, contactId), notInArray(storeOrder.status, ['pending', 'cancelled'])))
  return Number(row?.n ?? 0)
}
