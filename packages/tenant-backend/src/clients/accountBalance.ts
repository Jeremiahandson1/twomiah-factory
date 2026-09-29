import { sql, and, eq } from 'drizzle-orm'
// The same rounding the invoice totals use. Money that rounds two ways does not reconcile.
import { round2 } from '../invoicing/money'

/**
 * Money a client has ON ACCOUNT with the business.
 *
 * Every established salon platform has this and we did not. The gap showed up as a real hole in the
 * salon retest: a client paid $37.98 against a bill a reward later took down to $32.55, and the $5.43
 * difference existed nowhere except as a disagreement between two columns on one invoice. The front
 * desk could not see it, could not give it back, and could not spend it. Mangomint calls it the client
 * Account Balance — it never expires, it is offered as a payment method at checkout, and a refund can
 * be sent to it instead of to the card.
 *
 * What this is NOT: `applyInvoiceCredit` in invoicing/invoices.ts, which lowers the price of ONE
 * invoice and "can take off at most what is still owed". That is a discount by another name and it
 * cannot hold an overpayment, because on an overpaid invoice nothing is still owed. This is money,
 * held at the CLIENT, spendable against any future sale.
 *
 * ── The decisions, and why ──────────────────────────────────────────────────────────────────────
 *
 * **A ledger, not a column.** The balance is the SUM of its movements, never a number someone
 * increments. A balance that cannot explain itself is a liability that cannot be audited, and these
 * balances do not expire — the entry that created one may be two years old when it is spent. Every
 * movement carries why, who, and which invoice.
 *
 * **One signed column.** Positive puts money on account, negative takes it off. No separate "type"
 * field that can drift out of step with the sign of the number it describes.
 *
 * **It is the CLIENT'S money.** In accounting terms a customer credit is a liability until it is
 * applied, not revenue. So nothing here ever creates a balance on its own: an overpayment does not
 * quietly become a credit, because whether the client wants it back or wants it kept is their
 * decision and the salon's to ask. A person moves it, and this records what they decided. That is the
 * same line the loyalty retest drew (LYR N2) when a redemption against a settled bill was made to
 * refuse rather than silently turn into a credit.
 *
 * **Negative balances are allowed.** A client can owe the shop — Mangomint's IOU. Spending is what is
 * guarded, not the sign: `spend` refuses when the money is not there, and only a deliberate
 * adjustment can take a balance below zero.
 */

/** The `payment.method` that means "paid from the client's account balance". */
export const ACCOUNT_BALANCE_METHOD = 'account_balance'

/**
 * Where a movement came from. Kept deliberately small — each value answers a different question a
 * bookkeeper will ask about the same dollar.
 */
export type AccountEntrySource =
  /** Someone at the desk put money on, or took it off, by hand. */
  | 'manual'
  /** A refund the client chose to keep on account instead of back on their card. */
  | 'refund_to_account'
  /** They had paid more than the bill came to, and chose to leave it on account. */
  | 'overpayment'
  /** Spent against a sale. */
  | 'spend'
  /** Paid out to the client in cash or back to a card — the balance leaves the business. */
  | 'payout'

export interface AccountEntry {
  amount: any
}

/** The balance a set of ledger rows adds up to. The ONLY definition of "balance" in the product. */
export function balanceFrom(entries: AccountEntry[]): number {
  return round2(entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0))
}

/** Money on account reads as a credit; a negative balance is money the client owes. */
export function describeBalance(balance: number, clientWord = 'client'): string {
  const b = round2(balance)
  if (b > 0.005) return `$${b.toFixed(2)} on account`
  if (b < -0.005) return `$${Math.abs(b).toFixed(2)} owed by this ${clientWord}`
  return 'Nothing on account'
}

export interface AddEntryInput {
  companyId: string
  contactId: string
  /** Signed: positive adds to the balance, negative takes from it. */
  amount: number
  source: AccountEntrySource
  /** Why, in words a person will read back months later. Required — an unexplained movement is a bug. */
  reason: string
  /** The sale this movement is about, when there is one. */
  invoiceId?: string | null
  createdBy?: string | null
}

export type SpendOutcome =
  | { ok: true; spent: number; balanceBefore: number; balanceAfter: number }
  | { ok: false; error: string; balance: number }

/**
 * The store, bound to one template's table. Every method takes the caller's `tx` so a spend and the
 * payment it pays for commit or fail together — a balance debited outside the payment's transaction
 * is money that can vanish when the payment rolls back.
 */
export function createAccountBalanceStore(table: any, tableName = 'client_account_entry') {
  // FOR UPDATE has no drizzle builder here, so the locking read is raw and the table name is NAMED
  // rather than dug out of drizzle's internals, which are not API and have moved between versions.
  // It is a constant chosen by the template, never request input, and it is checked anyway — the same
  // sql.raw-for-an-identifier pattern tasks.ts already uses for its sort column. The two VALUES are
  // interpolated normally, so they are still bound parameters.
  if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) throw new Error(`accountBalance: bad table name ${tableName}`)
  const from = sql.raw(tableName)

  /**
   * The balance, computed. Row-locked when asked for inside a transaction that is about to spend it,
   * so two tills cannot both read $50 and both spend it.
   */
  async function balance(tx: any, companyId: string, contactId: string, forUpdate = false): Promise<number> {
    if (forUpdate) {
      const rows: any = await tx.execute(
        sql`SELECT amount FROM ${from} WHERE company_id = ${companyId} AND contact_id = ${contactId} FOR UPDATE`,
      )
      return balanceFrom(((rows as any).rows || rows) as AccountEntry[])
    }
    const rows = await tx.select({ amount: table.amount }).from(table)
      .where(and(eq(table.companyId, companyId), eq(table.contactId, contactId)))
    return balanceFrom(rows as AccountEntry[])
  }

  /** Write one movement. No rules here beyond "it is written down" — the rules live in the callers. */
  async function add(tx: any, input: AddEntryInput) {
    const [row] = await tx.insert(table).values({
      companyId: input.companyId,
      contactId: input.contactId,
      amount: round2(input.amount).toString(),
      source: input.source,
      reason: input.reason,
      invoiceId: input.invoiceId ?? null,
      createdBy: input.createdBy ?? null,
    } as any).returning()
    return row
  }

  /**
   * Take money off the balance, refusing when it is not there.
   *
   * The read is FOR UPDATE and the write is in the same transaction, so a client with $20 on account
   * cannot pay for two $20 services at two tills at the same moment.
   */
  async function spend(tx: any, input: { companyId: string; contactId: string; amount: number; invoiceId?: string | null; reason?: string; createdBy?: string | null }): Promise<SpendOutcome> {
    const amount = round2(input.amount)
    if (amount <= 0.005) return { ok: false, error: 'A payment from an account balance has to be for something.', balance: 0 }
    const before = await balance(tx, input.companyId, input.contactId, true)
    if (amount > before + 0.005) {
      return {
        ok: false,
        balance: before,
        error: before <= 0.005
          ? 'This client has nothing on account.'
          : `This client has $${before.toFixed(2)} on account, which is less than $${amount.toFixed(2)}.`,
      }
    }
    await add(tx, {
      companyId: input.companyId, contactId: input.contactId, amount: -amount, source: 'spend',
      reason: input.reason || 'Paid from account balance', invoiceId: input.invoiceId ?? null, createdBy: input.createdBy ?? null,
    })
    return { ok: true, spent: amount, balanceBefore: before, balanceAfter: round2(before - amount) }
  }

  return { balance, add, spend }
}

export type AccountBalanceStore = ReturnType<typeof createAccountBalanceStore>
