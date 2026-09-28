// The store's loyalty programme — earning, spending, and what a shopper can claim today.
//
// The RULES are shared (src/shared → packages/tenant-backend/src/loyalty) with crm-salon. Only this
// wiring is store-specific, because the two shapes disagree about nearly everything: salon is
// multi-tenant with contacts and decimal dollars, this is single-tenant with uuid keys and cents.
//
// Identity is the email address, because this storefront has no shopper login — checkout is guest.
// Two consequences run through everything below:
//   · the address is lowercased everywhere, or Ada@x.com and ada@x.com become one customer with
//     half their points
//   · rewards are money off, never free goods. Whoever types the address can spend the balance,
//     which is a fair risk for a coupon and a poor one for a free product.
//
// WHEN points move matters as much as how much. Nothing is earned or spent at checkout — an
// abandoned cart must never burn a customer's balance — so both happen at finalizeOrder, the one
// place an order actually becomes paid, and both are keyed to the order id by a unique index so a
// webhook that fires twice cannot pay or charge twice.
import { db } from '../../db/index.ts'
import { loyaltyMembers, loyaltyTransactions, loyaltyRewards, storeSettings, orders } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { loyaltyConfig, pointsForSale, punchCardProgress, rewardDiscountCents, canRedeem, type LoyaltyConfig } from '../shared/index.ts'

export const normalizeEmail = (email: string | null | undefined): string =>
  String(email || '').trim().toLowerCase()

/** A guest checkout with no address yet is not a member of anything. */
const isRealEmail = (email: string) => !!email && email.includes('@') && email !== 'pending@checkout'

export async function loyaltySettings(): Promise<LoyaltyConfig> {
  const [row] = await db.select({ loyalty: storeSettings.loyalty }).from(storeSettings).limit(1)
  return loyaltyConfig({ loyalty: row?.loyalty })
}

export async function findMember(email: string) {
  const e = normalizeEmail(email)
  if (!isRealEmail(e)) return null
  const [m] = await db.select().from(loyaltyMembers).where(eq(loyaltyMembers.email, e)).limit(1)
  return m || null
}

async function ensureMember(email: string) {
  const e = normalizeEmail(email)
  if (!isRealEmail(e)) return null
  const existing = await findMember(e)
  if (existing) return existing
  try {
    const [created] = await db.insert(loyaltyMembers).values({ email: e }).returning()
    return created
  } catch {
    return await findMember(e) // lost the race; the other row is the one that counts
  }
}

export interface AvailableReward {
  id: string
  name: string
  description: string | null
  pointsCost: number
  /** What it would take off THIS cart, in cents. */
  discountCents: number
  /** Can it be used right now, and if not, why not. */
  available: boolean
  reason?: string
  /** True when a full punch card is paying rather than points. */
  onTheHouse: boolean
}

/**
 * What this shopper could claim against this cart.
 *
 * Priced against the cart in front of them, not a figure remembered when the reward was created —
 * a percentage reward has no fixed value, and a minimum-spend rule cannot be judged without it.
 */
export async function availableRewards(email: string, subtotalCents: number): Promise<{
  pointsBalance: number
  punchCard: ReturnType<typeof punchCardProgress>
  rewards: AvailableReward[]
}> {
  const cfg = await loyaltySettings()
  const member = await findMember(email)
  const balance = member?.pointsBalance ?? 0
  const progress = punchCardProgress(
    { qualifyingVisits: member?.qualifyingOrders ?? 0, rewardsEarned: member?.punchRewardsEarned ?? 0 },
    cfg,
  )
  if (!cfg.enabled) return { pointsBalance: balance, punchCard: progress, rewards: [] }

  const rows = await db.select().from(loyaltyRewards)
    .where(eq(loyaltyRewards.active, true)).orderBy(loyaltyRewards.pointsCost)

  const cart = [{ itemId: 'cart', lineTotalCents: Math.max(0, subtotalCents) }]

  const rewards = rows.map((r) => {
    const onTheHouse = r.pointsCost === 0 && progress.unclaimed > 0
    const discountCents = rewardDiscountCents(
      { pointsCost: r.pointsCost, type: r.type as any, value: r.valueCents }, cart,
    )
    let available = true
    let reason: string | undefined

    if (r.pointsCost === 0 && !onTheHouse) {
      available = false
      reason = progress.enabled
        ? `Earned with a full card — ${progress.remaining} more order${progress.remaining === 1 ? '' : 's'} to go.`
        : 'Earned with a punch card, which this shop does not run.'
    } else if (subtotalCents < r.minSubtotalCents) {
      available = false
      reason = `Spend at least ${(r.minSubtotalCents / 100).toFixed(2)} to use this.`
    } else {
      const gate = canRedeem(
        { pointsCost: onTheHouse ? 0 : r.pointsCost, type: r.type as any, value: r.valueCents }, balance, cart,
      )
      available = gate.ok
      reason = gate.reason
    }

    return { id: r.id, name: r.name, description: r.description, pointsCost: onTheHouse ? 0 : r.pointsCost, discountCents, available, reason, onTheHouse }
  })

  return { pointsBalance: balance, punchCard: progress, rewards }
}

/**
 * Price a reward for checkout — the server's own answer, never the client's.
 *
 * Returns 0 when the shopper cannot actually have it, so a tampered request simply gets no discount
 * rather than an error the storefront has to handle mid-payment.
 */
export async function quoteRewardForCheckout(email: string, rewardId: string, subtotalCents: number): Promise<number> {
  const quote = await availableRewards(email, subtotalCents)
  const found = quote.rewards.find((r) => r.id === rewardId)
  return found?.available ? found.discountCents : 0
}

export interface SettleResult {
  earned: number
  spent: number
}

/**
 * Move the points for an order that has just become paid.
 *
 * Called from finalizeOrder, which is already guarded so only one path wins the flip. Each half is
 * additionally keyed to the order id, so even a double-call moves nothing twice. Never throws:
 * loyalty must not be able to fail a payment that has already gone through.
 */
export async function settleLoyaltyForPaidOrder(orderId: string): Promise<SettleResult> {
  const none: SettleResult = { earned: 0, spent: 0 }
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return none

  const cfg = await loyaltySettings()
  if (!cfg.enabled) return none

  const member = await ensureMember(order.customerEmail)
  if (!member) return none

  // ── spend first, so a balance can never be earned and immediately re-spent on the same order ──
  let spent = 0
  if (order.loyaltyRewardId && order.loyaltyDiscountCents > 0) {
    const [reward] = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, order.loyaltyRewardId)).limit(1)
    if (reward) {
      const progress = punchCardProgress(
        { qualifyingVisits: member.qualifyingOrders, rewardsEarned: member.punchRewardsEarned }, cfg,
      )
      const onTheHouse = reward.pointsCost === 0 && progress.unclaimed > 0
      // Clamped: a shopper who opened several checkouts against one balance cannot drive it
      // negative. They keep a small discount they could not quite afford, which is bounded and
      // preferable to refusing a payment that has already been taken.
      spent = onTheHouse ? 0 : Math.min(member.pointsBalance, reward.pointsCost)

      try {
        await db.insert(loyaltyTransactions).values({
          memberId: member.id, type: onTheHouse ? 'punch_reward' : 'redeem',
          points: -spent, balanceAfter: Math.max(0, member.pointsBalance - spent),
          description: reward.name, orderId: order.id,
        })
        await db.update(loyaltyMembers).set({
          pointsBalance: Math.max(0, member.pointsBalance - spent),
          punchRewardsEarned: onTheHouse ? member.punchRewardsEarned + 1 : member.punchRewardsEarned,
          updatedAt: new Date(),
        }).where(eq(loyaltyMembers.id, member.id))
        await db.update(loyaltyRewards)
          .set({ usedCount: reward.usedCount + 1, updatedAt: new Date() })
          .where(eq(loyaltyRewards.id, reward.id))
      } catch {
        spent = 0 // already settled for this order
      }
    }
  }

  // ── then earn, on what the customer actually paid for goods ──
  // The goods, not the invoice: shipping and tax are not the shop's revenue and a programme that
  // pays points on postage is paying customers to ship.
  // discountCents is the TOTAL taken off (code + loyalty); loyaltyDiscountCents is the share of it,
  // recorded separately for the books. Subtracting both would deduct the loyalty part twice.
  const basis = Math.max(0, order.subtotalCents - order.discountCents)
  const points = pointsForSale(basis, cfg)
  const counts = cfg.punchCard.visitsRequired > 0

  let earned = 0
  if (points > 0 || counts) {
    const [current] = await db.select().from(loyaltyMembers).where(eq(loyaltyMembers.id, member.id)).limit(1)
    try {
      await db.insert(loyaltyTransactions).values({
        memberId: member.id, type: 'earn', points,
        balanceAfter: (current?.pointsBalance ?? 0) + points,
        description: `Order ${order.orderNumber || order.id.slice(0, 8)}`, orderId: order.id,
      })
      await db.update(loyaltyMembers).set({
        pointsBalance: (current?.pointsBalance ?? 0) + points,
        lifetimePoints: (current?.lifetimePoints ?? 0) + points,
        qualifyingOrders: counts ? (current?.qualifyingOrders ?? 0) + 1 : (current?.qualifyingOrders ?? 0),
        lastActivityAt: new Date(), updatedAt: new Date(),
      }).where(eq(loyaltyMembers.id, member.id))
      earned = points
    } catch {
      earned = 0 // already earned for this order
    }
  }

  return { earned, spent }
}

/** A member's ledger, for the admin screen. */
export async function memberHistory(memberId: string) {
  return db.select().from(loyaltyTransactions)
    .where(eq(loyaltyTransactions.memberId, memberId))
    .orderBy(desc(loyaltyTransactions.createdAt)).limit(50)
}
