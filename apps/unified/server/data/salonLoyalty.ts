// The salon loyalty programme's raw SQL (RULEBOOK §2): balances moved in one statement, the card and the points
// claimed by a conditional UPDATE, the reward reaching the bill, and the repair of bills older builds wrote. From
// templates/crm-salon/backend/src (routes/loyalty.ts, services/loyaltyAward.ts).
import { and, eq, sql } from 'drizzle-orm'
import { loyaltyMember, loyaltyTransaction, loyaltyReward } from '../db/schema/index.ts'

const rowsOf = (r: any): any[] => ((r as any)?.rows || r) as any[]

/** Has this member had a birthday bonus this calendar year? */
export async function birthdayBonusThisYear(db: any, memberId: string): Promise<boolean> {
  const already = await db.select({ id: loyaltyTransaction.id }).from(loyaltyTransaction)
    .where(and(
      eq(loyaltyTransaction.memberId, memberId),
      eq(loyaltyTransaction.type, 'bonus'),
      sql`${loyaltyTransaction.description} LIKE 'Birthday bonus%'`,
      sql`${loyaltyTransaction.createdAt} >= date_trunc('year', NOW())`,
    )).limit(1)
  return already.length > 0
}

/** One balance write for everything a visit granted — the earn and both bonuses — and its punch. */
export async function creditMember(db: any, memberId: string, points: number, punch: boolean): Promise<void> {
  await db.update(loyaltyMember).set({
    pointsBalance: sql`${loyaltyMember.pointsBalance} + ${points}`,
    lifetimePoints: sql`${loyaltyMember.lifetimePoints} + ${points}`,
    qualifyingVisits: punch ? sql`${loyaltyMember.qualifyingVisits} + 1` : loyaltyMember.qualifyingVisits,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, memberId))
}

/** Take back what a cancelled visit earned, never below zero. */
export async function debitMember(db: any, memberId: string, points: number, punch: boolean): Promise<void> {
  await db.update(loyaltyMember).set({
    pointsBalance: sql`GREATEST(0, ${loyaltyMember.pointsBalance} - ${points})`,
    lifetimePoints: sql`GREATEST(0, ${loyaltyMember.lifetimePoints} - ${points})`,
    qualifyingVisits: punch ? sql`GREATEST(0, ${loyaltyMember.qualifyingVisits} - 1)` : loyaltyMember.qualifyingVisits,
    updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, memberId))
}

/**
 * Consume a full punch card in the statement that checks it is full: floor(visits / required) is how many cards the
 * member has completed; it has to exceed the number already paid out (LY0928 B2). Null when there is no card to claim.
 */
export async function claimPunchCard(tx: any, memberId: string, companyId: string, visitsRequired: number): Promise<number | null> {
  const r = await tx.execute(sql`
    UPDATE loyalty_members
    SET punch_rewards_earned = punch_rewards_earned + 1,
        last_activity_at = NOW(), updated_at = NOW()
    WHERE id = ${memberId}
      AND company_id = ${companyId}
      AND floor(qualifying_visits::numeric / ${visitsRequired}) > punch_rewards_earned
    RETURNING points_balance
  `)
  const row = rowsOf(r)[0]
  return row ? Number(row.points_balance) : null
}

/** Spend points where the balance check IS the WHERE clause (LY0928 B1). Null when they could not afford it. */
export async function spendPoints(tx: any, memberId: string, companyId: string, points: number): Promise<number | null> {
  const r = await tx.execute(sql`
    UPDATE loyalty_members
    SET points_balance = points_balance - ${points},
        last_activity_at = NOW(), updated_at = NOW()
    WHERE id = ${memberId}
      AND company_id = ${companyId}
      AND points_balance >= ${points}
    RETURNING points_balance
  `)
  const row = rowsOf(r)[0]
  return row ? Number(row.points_balance) : null
}

/**
 * The discount reaches the bill, recomputed from the stored figures; the tax moves with it at the bill's own rate
 * (LYR N1); a bill taken to nothing is paid (FULL0929 F4). `discount` is in dollars, as text.
 */
export async function discountInvoice(tx: any, invoiceId: string, companyId: string, discount: string): Promise<void> {
  await tx.execute(sql`
    UPDATE invoice
    SET discount = LEAST(COALESCE(discount, 0) + ${discount}, COALESCE(subtotal, 0)),
        tax_amount = ROUND(
          GREATEST(0, COALESCE(subtotal, 0) - LEAST(COALESCE(discount, 0) + ${discount}, COALESCE(subtotal, 0)))
          * (COALESCE(tax_rate, 0) / 100), 2),
        total = GREATEST(0, COALESCE(subtotal, 0) - LEAST(COALESCE(discount, 0) + ${discount}, COALESCE(subtotal, 0)))
          + ROUND(
            GREATEST(0, COALESCE(subtotal, 0) - LEAST(COALESCE(discount, 0) + ${discount}, COALESCE(subtotal, 0)))
            * (COALESCE(tax_rate, 0) / 100), 2),
        status = CASE
          WHEN GREATEST(0, COALESCE(subtotal, 0) - LEAST(COALESCE(discount, 0) + ${discount}, COALESCE(subtotal, 0)))
               + ROUND(
                 GREATEST(0, COALESCE(subtotal, 0) - LEAST(COALESCE(discount, 0) + ${discount}, COALESCE(subtotal, 0)))
                 * (COALESCE(tax_rate, 0) / 100), 2) <= 0.005
            THEN 'paid'
          ELSE status
        END,
        updated_at = NOW()
    WHERE id = ${invoiceId} AND company_id = ${companyId}
  `)
}

export async function countRewardUse(tx: any, rewardId: string): Promise<void> {
  await tx.update(loyaltyReward).set({ usageCount: sql`${loyaltyReward.usageCount} + 1`, updatedAt: new Date() } as any)
    .where(eq(loyaltyReward.id, rewardId))
}

// ─── Putting right what the old builds left (POST /api/loyalty/repair-legacy-invoices) ─────────────────────────────

export async function liveBillsWithVisitStatus(db: any, companyId: string) {
  const r = await db.execute(sql`
    SELECT i.id, i.number, i.subtotal, i.discount, i.tax_rate, i.tax_amount, i.total,
           i.amount_paid, i.amount_refunded, i.status, i.notes, a.status AS appointment_status
    FROM invoice i
    LEFT JOIN appointment a ON a.id = i.appointment_id
    WHERE i.company_id = ${companyId} AND i.status NOT IN ('void', 'refunded')
    ORDER BY i.number
  `)
  return rowsOf(r).map((b) => ({
    id: b.id as string, number: b.number as string, subtotal: b.subtotal, discount: b.discount, taxRate: b.tax_rate,
    taxAmount: b.tax_amount, total: b.total, amountPaid: b.amount_paid, amountRefunded: b.amount_refunded,
    status: b.status as string, notes: b.notes as string | null, appointmentStatus: b.appointment_status as string | null,
  }))
}

export async function voidBillWithNote(db: any, id: string, companyId: string, notes: string): Promise<void> {
  await db.execute(sql`UPDATE invoice SET status = 'void', notes = ${notes}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}

export async function setBillTax(db: any, id: string, companyId: string, taxAmount: string, total: string): Promise<void> {
  await db.execute(sql`UPDATE invoice SET tax_amount = ${taxAmount}, total = ${total}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}

export async function markBillPaid(db: any, id: string, companyId: string): Promise<void> {
  await db.execute(sql`UPDATE invoice SET status = 'paid', updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}
