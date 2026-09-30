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
  /** Whose balance this moves. `contactId` for a client ledger, `subjectId` for any other. */
  contactId?: string
  subjectId?: string
  /** Signed: positive adds to the balance, negative takes from it. */
  amount: number
  source: AccountEntrySource | string
  /** Why, in words a person will read back months later. Required — an unexplained movement is a bug. */
  reason: string
  /** The sale this movement is about, when there is one. */
  invoiceId?: string | null
  /** The expense this movement is about, on a ledger that hangs off expenses. */
  expenseId?: string | null
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
export function createAccountBalanceStore(
  table: any,
  tableName = 'client_account_entry',
  /**
   * The table holding one row per client. Spending locks THAT row, not the ledger — see lockClient.
   */
  anchorTableName = 'contact',
  /**
   * Whose ledger this is: the column on the ledger table, and the drizzle field that writes it.
   *
   * There is a second ledger in the product now — what a STAFF member owes the business after an
   * over-reimbursement — and it is the same object with a different anchor: a signed ledger, a
   * balance that is the sum of its movements, and a lock on the subject's own row. Copying these
   * forty lines to get `user_id` instead of `contact_id` would have made a second implementation of
   * money, and this session has already shown what a forked component costs: five copies of one
   * table, four of them wrong in the same two ways. One implementation, two anchors.
   */
  subject: { column: string; field: string } = { column: 'contact_id', field: 'contactId' },
) {
  // FOR UPDATE has no drizzle builder here, so the locking read is raw and the table name is NAMED
  // rather than dug out of drizzle's internals, which are not API and have moved between versions.
  // It is a constant chosen by the template, never request input, and it is checked anyway — the same
  // sql.raw-for-an-identifier pattern tasks.ts already uses for its sort column. The two VALUES are
  // interpolated normally, so they are still bound parameters.
  if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) throw new Error(`accountBalance: bad table name ${tableName}`)
  if (!/^[a-z_][a-z0-9_]*$/.test(anchorTableName)) throw new Error(`accountBalance: bad anchor table ${anchorTableName}`)
  if (!/^[a-z_][a-z0-9_]*$/.test(subject.column)) throw new Error(`accountBalance: bad subject column ${subject.column}`)
  /**
   * QUOTED, because one of the anchors is `user`.
   *
   * `SELECT id FROM user … FOR UPDATE` does not read the user TABLE: `user` is reserved in Postgres
   * and parses as the current-user function, so the lock came back "column id does not exist" — a
   * 500 on every staff-balance write, and the sort of thing that only shows up the first time the
   * second anchor is used. The names are validated above, so quoting them is safe and changes
   * nothing for `contact`.
   */
  const quoted = (n: string) => sql.raw(`"${n}"`)
  const from = quoted(tableName)
  const anchor = quoted(anchorTableName)
  const subjectCol = quoted(subject.column)

  /**
   * Take the lock that makes a spend safe: ONE row, the client's own.
   *
   * The first version locked the LEDGER — `SELECT … FROM client_account_entry … FOR UPDATE` — and
   * that does not do what it looks like it does. FOR UPDATE locks the rows that exist when it runs;
   * it takes no predicate lock, so another transaction INSERTING a new debit is not blocked by it at
   * all. And a client with no entries yet locks nothing whatsoever. Two tills read $40, both pass
   * the check, both insert.
   *
   * A live retest proved it on real Postgres: six simultaneous payments against a $40.00 balance,
   * two of them settled, balance left at −$35.96. No test in this repo could have caught it — PGlite
   * runs one connection — and the guard I wrote to cover that gap only checked that the words FOR
   * UPDATE appeared, which they did, on the wrong table.
   *
   * Locking the client row instead serialises every spender for that client through one place. The
   * row always exists, so there is always something to contend on, and the balance read that follows
   * happens with every other spender waiting. If the client cannot be found there is nothing to
   * serialise on, and the spend is refused rather than quietly running unlocked.
   */
  async function lockClient(tx: any, companyId: string, contactId: string): Promise<boolean> {
    const rows: any = await tx.execute(
      sql`SELECT id FROM ${anchor} WHERE id = ${contactId} AND company_id = ${companyId} FOR UPDATE`,
    )
    return (((rows as any).rows || rows) as any[]).length > 0
  }

  /**
   * The balance, computed. `forUpdate` takes the client lock FIRST, so the sum that comes back
   * cannot change under the caller before it writes.
   */
  async function balance(tx: any, companyId: string, contactId: string, forUpdate = false): Promise<number> {
    if (forUpdate) await lockClient(tx, companyId, contactId)
    const rows: any = await tx.execute(
      sql`SELECT amount FROM ${from} WHERE company_id = ${companyId} AND ${subjectCol} = ${contactId}`,
    )
    return balanceFrom(((rows as any).rows || rows) as AccountEntry[])
  }

  /** Write one movement. No rules here beyond "it is written down" — the rules live in the callers. */
  async function add(tx: any, input: AddEntryInput) {
    const who = input.subjectId ?? input.contactId
    if (!who) throw new Error('accountBalance.add: no subject')
    const [row] = await tx.insert(table).values({
      companyId: input.companyId,
      [subject.field]: who,
      amount: round2(input.amount).toString(),
      source: input.source,
      reason: input.reason,
      ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
      ...(input.expenseId !== undefined ? { expenseId: input.expenseId } : {}),
      createdBy: input.createdBy ?? null,
    } as any).returning()
    return row
  }

  /**
   * Take money off the balance, refusing when it is not there.
   *
   * The client row is locked first and the write happens in the same transaction, so a client with
   * $20 on account cannot pay for two $20 services at two tills at the same moment: the second till
   * waits on the lock, and by the time it reads, the first till's debit is already in the sum.
   */
  async function spend(tx: any, input: { companyId: string; contactId: string; amount: number; invoiceId?: string | null; reason?: string; createdBy?: string | null }): Promise<SpendOutcome> {
    const amount = round2(input.amount)
    if (amount <= 0.005) return { ok: false, error: 'A payment from an account balance has to be for something.', balance: 0 }

    // The lock comes FIRST, and nothing proceeds without it. Everything below — the read, the check
    // and the write — happens with every other spender for this client waiting behind it.
    if (!await lockClient(tx, input.companyId, input.contactId)) {
      return { ok: false, balance: 0, error: 'That client could not be found, so their balance cannot be spent.' }
    }
    const before = await balance(tx, input.companyId, input.contactId, false)
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
