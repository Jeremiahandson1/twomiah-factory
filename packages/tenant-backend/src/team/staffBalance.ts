import { sql } from 'drizzle-orm'
import { round2, money } from '../invoicing/money'
import { createAccountBalanceStore, balanceFrom } from '../clients/accountBalance'

/**
 * What a member of staff owes the business, and how it gets recovered.
 *
 * ── why this exists ────────────────────────────────────────────────────────────────────────────
 *
 * The expense sheet could record money ARRIVING back after an over-reimbursement (RR8/X6) and
 * nothing else. That leaves out the state a salon is actually in for the days or weeks between
 * finding the error and getting the money: "she was paid $50 for a $40 claim and owes $10". With no
 * balance there is nothing to see, nothing to chase, and no way to take it off a pay run — and if it
 * is never repaid there is nothing to write off either.
 *
 * Every established system models this as a RECEIVABLE: the over-payment becomes a balance the
 * moment it is found, the expense report itself is closed and stays closed, and the balance is
 * cleared one of three ways — cash back, netted off the next claim, or deducted from pay.
 *
 * ── the decisions, and why ─────────────────────────────────────────────────────────────────────
 *
 * **The same ledger as the client's account balance, not a second one.** A signed ledger, a balance
 * that is the SUM of its movements, and a lock on the subject's own row before any read-then-write.
 * That implementation already survived a live six-way race on real Postgres; a near-copy of it would
 * be the fifth forked component this session and the fourth to be wrong in the same way.
 *
 * **The same sign convention, so "balance" means one thing in this product.** Positive is money the
 * business holds FOR the person; negative is money they owe it. An over-reimbursement is negative,
 * every recovery is positive, and `describeBalance` already reads a negative as "owed by".
 *
 * **Nothing is ever raised automatically.** An over-payment is a judgement — was the claim wrong, or
 * was the payment? — so a person decides and this records what they decided, exactly as the client
 * ledger refuses to turn an overpayment into a credit on its own.
 *
 * **A payroll deduction is off unless the business turns it on.** Taking money out of someone's
 * wages is not the same kind of act as the other two, and in most US states it needs the employee's
 * written authorisation. So it is gated on a company setting the owner has to switch on, it refuses
 * without a recorded authorisation, and the refusal says which of the two is missing. The product
 * does not decide whether a shop may do this; it declines to do it silently.
 */

/** Where a staff-balance movement came from. Each answers a different question about the same dollar. */
export type StaffEntrySource =
  /** A reimbursed claim was paid too much — the person owes the difference. Negative. */
  | 'over_reimbursement'
  /** They handed the money back. Positive. */
  | 'cash_repayment'
  /** It came off what they were owed on another claim. Positive. */
  | 'claim_offset'
  /** It came off a pay run. Positive. */
  | 'payroll_deduction'
  /** The business decided to stop chasing it. Positive. */
  | 'write_off'
  /** Someone moved it by hand, either way. Signed. */
  | 'manual'

/** The ways a balance can be cleared. `cash` is the one that needs nothing else. */
export const SETTLE_ROUTES = ['cash', 'offset', 'payroll', 'write_off'] as const
export type SettleRoute = typeof SETTLE_ROUTES[number]

export const SOURCE_FOR_ROUTE: Record<SettleRoute, StaffEntrySource> = {
  cash: 'cash_repayment',
  offset: 'claim_offset',
  payroll: 'payroll_deduction',
  write_off: 'write_off',
}

/** The company setting that has to be ON before anything can come off someone's pay. */
export const PAYROLL_DEDUCTION_SETTING = 'allowPayrollDeductions'
export function payrollDeductionsAllowed(settings: any): boolean {
  return (settings || {})[PAYROLL_DEDUCTION_SETTING] === true
}

/** How much this person owes, as a positive number. 0 when they owe nothing. */
export function owedFrom(entries: Array<{ amount: any }>): number {
  const b = balanceFrom(entries)
  return b < -0.005 ? round2(-b) : 0
}

export function describeOwed(owed: number, name?: string | null): string {
  const o = round2(owed)
  if (o <= 0.005) return name ? `${name} owes nothing` : 'Nothing owed'
  return name ? `${name} owes ${money(o)}` : `${money(o)} owed`
}

/**
 * The store, bound to one template's `staff_account_entry` table. The anchor is the USER row, which
 * is the thing two people settling the same balance at once have to contend on.
 */
export function createStaffBalanceStore(table: any, tableName = 'staff_account_entry', anchorTableName = 'user') {
  const store = createAccountBalanceStore(table, tableName, anchorTableName, { column: 'user_id', field: 'userId' })
  // Quoted for the same reason the store quotes its own: `user` is reserved, and an unquoted
  // identifier in one place and a quoted one in another is how half a feature works.
  if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) throw new Error(`staffBalance: bad table name ${tableName}`)
  const quotedTable = sql.raw(`"${tableName}"`)

  /** What this person owes right now, positive. `forUpdate` locks their row first. */
  async function owed(tx: any, companyId: string, userId: string, forUpdate = false): Promise<number> {
    const balance = await store.balance(tx, companyId, userId, forUpdate)
    return balance < -0.005 ? round2(-balance) : 0
  }

  /** Raise a debt: the person was paid more than the claim was worth. */
  async function raise(tx: any, input: { companyId: string; userId: string; amount: number; reason: string; expenseId?: string | null; createdBy?: string | null }) {
    return store.add(tx, {
      companyId: input.companyId, subjectId: input.userId,
      amount: -Math.abs(round2(input.amount)), source: 'over_reimbursement',
      reason: input.reason, expenseId: input.expenseId ?? null, createdBy: input.createdBy ?? null,
    })
  }

  /**
   * Clear some of it. Refuses to clear more than is owed — a ledger that can be over-settled starts
   * holding money the business does not have, which is the client-balance bug in a mirror.
   */
  async function settle(tx: any, input: { companyId: string; userId: string; amount: number; route: SettleRoute; reason: string; expenseId?: string | null; createdBy?: string | null }): Promise<
    { ok: true; settled: number; owedBefore: number; owedAfter: number } | { ok: false; error: string; owed: number }
  > {
    const amount = round2(input.amount)
    if (amount <= 0.005) return { ok: false, error: 'A settlement has to be for something.', owed: 0 }
    const before = await owed(tx, input.companyId, input.userId, true)
    if (before <= 0.005) return { ok: false, error: 'This person does not owe anything.', owed: 0 }
    if (amount > before + 0.005) {
      return { ok: false, owed: before, error: `They owe ${money(before)}, which is less than ${money(amount)}.` }
    }
    await store.add(tx, {
      companyId: input.companyId, subjectId: input.userId,
      amount, source: SOURCE_FOR_ROUTE[input.route],
      reason: input.reason, expenseId: input.expenseId ?? null, createdBy: input.createdBy ?? null,
    })
    return { ok: true, settled: amount, owedBefore: before, owedAfter: round2(before - amount) }
  }

  /**
   * What came off pay runs in a window — the deductions line a payroll summary shows. Grouped by
   * person, because that is how a pay run is read.
   */
  async function deductionsBetween(db: any, companyId: string, start: Date, end: Date): Promise<Record<string, number>> {
    const rows: any = await db.execute(sql`
      SELECT user_id, SUM(amount) AS total
      FROM ${quotedTable}
      WHERE company_id = ${companyId}
        AND source = 'payroll_deduction'
        AND created_at >= ${start} AND created_at <= ${end}
      GROUP BY user_id
    `)
    const out: Record<string, number> = {}
    for (const r of ((rows as any).rows || rows) as any[]) out[String(r.user_id)] = round2(Number(r.total) || 0)
    return out
  }

  /** Everyone who owes something, most owed first. */
  async function allOwed(db: any, companyId: string): Promise<Array<{ userId: string; owed: number }>> {
    const rows: any = await db.execute(sql`
      SELECT user_id, SUM(amount) AS balance
      FROM ${quotedTable}
      WHERE company_id = ${companyId}
      GROUP BY user_id
      HAVING SUM(amount) < -0.005
      ORDER BY SUM(amount) ASC
    `)
    return (((rows as any).rows || rows) as any[]).map((r) => ({ userId: String(r.user_id), owed: round2(-(Number(r.balance) || 0)) }))
  }

  /** Every movement for one person, newest first — the balance explaining itself. */
  async function historyFor(db: any, companyId: string, userId: string, limit = 50) {
    const rows: any = await db.execute(sql`
      SELECT id, amount, source, reason, expense_id, created_by, created_at
      FROM ${quotedTable}
      WHERE company_id = ${companyId} AND user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${Math.min(200, Math.max(1, limit))}
    `)
    return (((rows as any).rows || rows) as any[]).map((r) => ({
      id: String(r.id),
      amount: round2(Number(r.amount) || 0),
      source: String(r.source),
      reason: r.reason == null ? null : String(r.reason),
      expenseId: r.expense_id == null ? null : String(r.expense_id),
      createdBy: r.created_by == null ? null : String(r.created_by),
      createdAt: r.created_at,
    }))
  }

  return { owed, raise, settle, deductionsBetween, allOwed, historyFor, balance: store.balance, add: store.add }
}

export type StaffBalanceStore = ReturnType<typeof createStaffBalanceStore>
