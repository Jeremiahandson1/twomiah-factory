// Money rules shared by invoices and quotes in every CRM template. One implementation, vendored into
// each tenant (see ../index.ts). Nothing here knows a vertical; callers inject their Drizzle tables.
import { withinHorizon, MAX_PLAN_YEARS } from '../dateInput'
// drizzle-orm is imported lazily inside nextNumber() only, so the pure money helpers (invoiceBalance,
// recomputeStatus, calcTotals, …) can be imported and unit-tested without pulling drizzle-orm.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * A POSITIVE AMOUNT THAT STORES AS NOTHING. (T51 follow-up)
 *
 * The owner reported "0.001 amounts are accepted" twice — first on an event deposit instalment, then
 * on menu prices — because every money field in that vertical was validated with `< 0`, which admits
 * a value that is positive and then rounds to 0.00 when it is written to a 2-decimal column. The
 * price is silently free, and afterwards it cannot be told apart from a deliberate zero.
 *
 * Thirteen more fields across salon, RV and the dispensary had the same shape. This is the predicate
 * they all now use, so there is one answer to "is this a real amount" in the fleet instead of
 * fourteen.
 *
 * EXACT ZERO IS NOT CAUGHT, on purpose. A $0 line is meaningful in every vertical that has one — a
 * complimentary item on a banquet order, a service offered free, a unit whose cost has not been
 * entered — and refusing those would be the opposite fault: a rule that stops real work. What this
 * catches is only the range between nothing and a cent.
 */
export const roundsToNothing = (v: unknown): boolean => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && round2(n) === 0
}

/**
 * A dollar figure as a PERSON reads it — the other end of round2.
 *
 * `toFixed(2)` has no thousands separator, so a five-figure sum printed to someone came out as
 * "$12000.00": on 47 PDFs a customer receives, 10 HTML receipts, 7 SMS/email bodies and 19
 * in-product refusals across eleven templates. A number with no grouping is the one somebody
 * misreads by a factor of ten with a client on the phone, and it is the first thing that makes an
 * invoice look like it came out of a script. (T41)
 *
 * The locale is PINNED. These strings are built on the SERVER — into a PDF, an email, an SMS — so
 * they must not depend on the host's locale: one that resolved to de-DE would start mailing
 * customers "$12.000,00". Browser code uses the viewer's own locale deliberately; this is the other
 * case, and the two are not interchangeable.
 *
 * `money()` carries the sign, so write `${money(total)}`, never `$${money(total)}`.
 */
export function money(n: unknown): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '$0.00'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The same figure without the sign, for a column that carries its own currency heading. */
export function amount(n: unknown): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface LineInput { quantity: number; unitPrice: number }

/**
 * Subtotal → discount → tax on the discounted amount (US convention) → total, all in whole cents.
 * Quantity and price are clamped at zero and the discount is clamped to the subtotal so a total can
 * never go negative; `effectiveDiscount` is what was actually applied and is what gets persisted.
 */
export function calcTotals(items: LineInput[], taxRate: number, discount = 0) {
  const subtotal = round2(items.reduce((s, i) => s + Math.max(0, Number(i.quantity) || 0) * Math.max(0, Number(i.unitPrice) || 0), 0))
  const effectiveDiscount = round2(Math.min(Math.max(0, Number(discount) || 0), subtotal))
  const taxable = Math.max(0, subtotal - effectiveDiscount)
  const taxAmount = round2(taxable * (Math.max(0, Number(taxRate) || 0) / 100))
  const total = round2(subtotal - effectiveDiscount + taxAmount)
  return { subtotal, effectiveDiscount, taxAmount, total }
}

/** Raw subtotal used for the "discount cannot exceed the subtotal" check before anything is saved. */
export const rawSubtotal = (items: LineInput[]) => round2(items.reduce((s, i) => s + Math.max(0, Number(i.quantity) || 0) * Math.max(0, Number(i.unitPrice) || 0), 0))

/** Statuses that mean "billed and still collectable". 'open' is a salon in-chair sale (owed, never emailed). */
export const DEFAULT_OPEN_STATUSES = ['sent', 'open', 'viewed', 'partial']

// ── Refund model (the professional / QuickBooks / Stripe convention) ─────────────────────────────
// amountPaid and amountRefunded are both GROSS ledgers. What the customer still owes is the total
// minus the money you actually KEPT (paid − refunded). A refund therefore returns money AND the
// invoice's total stays owed — so refunding a *deposit* correctly reopens the balance, while a sale
// that is refunded *in full* (refunded ≥ total) is a closed return and owes nothing. "Customer backed
// out" is a void; "give money back without reopening" is a credit/price reduction (lower the total).
export const netCollected = (inv: { amountPaid: any; amountRefunded?: any }) =>
  round2(Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0))

/**
 * What the customer still owes. The rule has TWO halves and both must hold:
 *  - A DEPOSIT refunded on a not-fully-paid invoice REOPENS the balance (the work is still owed):
 *      total $200, paid $50, refunded $50 → owes $200;  paid $50, refunded $20 → owes $170.
 *  - A refund on an invoice that was FULLY PAID is a return/goodwill and NEVER creates a balance
 *      (the customer already settled; money handed back is the business's choice):
 *      total $200, paid $200, refunded $50 → owes $0.
 * So the key is whether it was ever fully paid (amountPaid ≥ total), NOT net-of-refunds alone.
 * Void or a fully-returned sale (refunded ≥ total) owe nothing.
 */
export function invoiceBalance(inv: { status?: string; total: any; amountPaid: any; amountRefunded?: any }): number {
  if (inv.status === 'void') return 0
  const total = Number(inv.total) || 0
  const paid = Number(inv.amountPaid || 0)
  const refunded = round2(Number(inv.amountRefunded || 0))
  if (total > 0 && refunded >= total - 0.005) return 0   // whole sale returned
  if (paid >= total - 0.005) return 0                     // fully paid: a later refund is a return, never reopens
  return round2(Math.max(0, total - (paid - refunded)))  // deposit/partial: a refund reopens what's owed
}

/**
 * Stored status after a payment or refund. 'refunded' is terminal and means the WHOLE invoice value
 * was returned — not merely that all collected money went back (a returned deposit still owes for the
 * work, so it drops back to 'sent'). Never overrides void or draft.
 */
export function recomputeStatus(inv: { total: any; amountPaid: any; amountRefunded?: any }, prevStatus: string, openFallback = 'sent'): string {
  if (prevStatus === 'void' || prevStatus === 'draft') return prevStatus
  const total = Number(inv.total) || 0
  const paid = Number(inv.amountPaid || 0)
  const refunded = round2(Number(inv.amountRefunded || 0))
  const net = netCollected(inv)
  if (total > 0 && refunded >= total - 0.005) return 'refunded' // the whole sale was returned
  if (paid >= total - 0.005 && total > 0) return 'paid'         // fully paid; a partial refund does not un-pay it
  if (net > 0.005) return 'partial'
  return openFallback // only a deposit was collected and then refunded — billed and owed again
}

/**
 * "Overdue" is derived, never stored: billed, not fully paid, past its due date. Computed at read
 * time so the list, the stats, the dashboard and Reports agree without a job flipping statuses.
 */
export function isOverdue(inv: { status: string; dueDate: Date | string | null; total: any; amountPaid: any; amountRefunded?: any }, openStatuses: string[] = DEFAULT_OPEN_STATUSES): boolean {
  if (!openStatuses.includes(inv.status) || !inv.dueDate) return false
  if (invoiceBalance(inv) <= 0.005) return false
  // The customer has the WHOLE of the due day. Comparing the stored instant made an invoice due today
  // overdue from the moment of day it happened to be stamped with — and it disagreed with the screens,
  // which have always waited for the day to end (isPastDay). (Contractor T14 M17)
  const due = new Date(inv.dueDate as any)
  const endOfDueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), 23, 59, 59, 999)
  return endOfDueDay < Date.now()
}
export const deriveStatus = (inv: any, openStatuses: string[] = DEFAULT_OPEN_STATUSES) => (isOverdue(inv, openStatuses) ? 'overdue' : inv.status)

/** Company default sales-tax rate (Settings → Company). An explicit rate on the request still wins. */
export function defaultTaxRateFrom(settings: any): number {
  const r = Number(settings?.defaultTaxRate)
  return Number.isFinite(r) && r >= 0 && r <= 100 ? r : 0
}

/** Settings → Company → Invoice Payment Terms. 0 means "due on receipt" and must survive; unset means net-30. */
export function paymentTermsDaysFrom(settings: any): number {
  const d = Number(settings?.paymentTermsDays)
  return Number.isFinite(d) && d >= 0 ? Math.floor(d) : 30
}

/**
 * A due date, an issue date and a quote expiry are CALENDAR DAYS, not instants: "due 16 October" means the
 * whole of the 16th, wherever the reader is. They are stored at midnight UTC so the day cannot drift, and
 * so two invoices raised the same way cannot differ — 43 of 58 on one tenant carried the time of day they
 * happened to be created at, while 15 were clean midnights. (Contractor T14 M17)
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * TODAY, on the BUSINESS's calendar — still stored at midnight UTC like every other date here.
 *
 * Storing a calendar day at UTC midnight (above) is right and stays. Deciding WHICH day is today by
 * asking UTC is not: Render runs UTC, so from 19:00 Central a new invoice was stamped with tomorrow's
 * date and its due date landed a day late. Every US zone loses the tail of the evening this way — two
 * hours for Central, three for Mountain, four for Pacific. (Salon T27 H1)
 *
 * The zone is optional and there is no default beyond UTC: a template that does not tell this module
 * where it trades keeps exactly the behaviour it has today, so this cannot change a vertical that has
 * not opted in. An unrecognised zone falls back the same way rather than throwing on a money path.
 */
export function businessToday(timeZone?: string | null, now: Date = new Date()): Date {
  if (!timeZone) return startOfUtcDay(now)
  try {
    // en-CA formats as YYYY-MM-DD, which is the calendar date in that zone.
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now).split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  } catch {
    return startOfUtcDay(now)
  }
}

/**
 * The cut-off a SQL query compares a due date against: a day BEFORE today is overdue, today is not. Keeps
 * the filtered list, the stats and Reports on the same rule as isOverdue, which waits for the day to end.
 */
export function overdueCutoff(now: Date = new Date()): Date {
  return startOfUtcDay(now)
}

/** Due date = today + payment terms (whole days), on the calendar day boundary in UTC like the rest of the app. */
export function dueDateFromTerms(settings: any, from: Date = new Date()): Date {
  return startOfUtcDay(new Date(from.getTime() + paymentTermsDaysFrom(settings) * 86400000))
}

/** How long a quote stands, in whole days. Settings → Company can set it; thirty days is the trade default. */
export function quoteValidityDaysFrom(settings: any): number {
  const d = Number(settings?.quoteValidityDays)
  return Number.isFinite(d) && d >= 0 ? Math.floor(d) : 30
}

/**
 * When a quote stops standing = today + the validity period.
 *
 * A quote used to be created with `expiryDate: exp.value ?? null` — no fallback at all, where an invoice has
 * always fallen back to the company's payment terms. So a blank field (which is what the form sends: `expiryDate:
 * form.expiryDate || null`) produced a quote that never expires. That is not a missing date, it is an open-ended
 * price: the portal prints "Valid until …" only when there IS an expiry, so the customer is shown no limit, the
 * status can never turn `expired`, and the quote stays convertible to an invoice for ever at a price that may be
 * months old. 39 of 42 quotes on the test tenant had none. (Field Service T26 L2)
 */
export function quoteExpiryFromTerms(settings: any, from: Date = new Date()): Date {
  return startOfUtcDay(new Date(from.getTime() + quoteValidityDaysFrom(settings) * 86400000))
}

/**
 * Normalise a date field coming from a form. '' / null clear the field (→ null); undefined leaves it
 * alone; anything else must parse. Returns { error } for garbage so the route can answer 400 instead
 * of handing Postgres an empty string (which was a 500).
 */
/**
 * Does the DATE PART of this string name a day that exists?
 *
 * `new Date('2027-02-30T15:00Z')` is not an error — it is 2 March, silently. normalizeDateInput below
 * already refuses that for date-only fields, but its check is gated on a `YYYY-MM-DD` shape, so a
 * TIMESTAMP walked straight past it: an appointment booked for 30 February 2027 came back 201 and sat
 * on 2 March, five weeks from where anyone would look for it. (Salon T27 N8)
 *
 * Returns true for anything that is not a date-led string, so a caller can use it as a veto rather
 * than a parser.
 */
export function isRealCalendarDay(v: unknown): boolean {
  if (typeof v !== 'string') return true
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return true
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function normalizeDateInput(v: unknown): { value?: Date | null; error?: string } {
  if (v === undefined) return {}
  if (v === null || v === '') return { value: null }
  // A date-only string must name a real calendar day: JS parses 2026-02-30 as March 2, so a Feb 30 due
  // date used to slide forward silently (and then fail as "before the issue date"). (T16 L5)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { error: `${v} is not a real calendar date.` }
  }
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return { error: 'Enter a valid date.' }
  // Every one of these is a PLAN — when payment is due, when an offer lapses — so the future is the point and
  // only the year has to be plausible. A quote expiring in 2099 and an invoice due in 9999 both saved, and then
  // sat outside every window that would have shown them. One bound here covers due date, issue date and quote
  // expiry together. (Contractor T30 L1)
  if (!withinHorizon(d)) return { error: `That date is too far ahead — pick one within ${MAX_PLAN_YEARS} years. Check the year.` }
  // Every caller is a calendar-day field (due date, issue date, quote expiry), so the day is what is kept:
  // a picker sends 2026-10-16 and a client that sends a full timestamp must not store a different value for
  // the same day. (Contractor T14 M17)
  return { value: startOfUtcDay(d) }
}

/**
 * Next document number for a company: highest existing `PREFIX-<n>` + 1, under a per-company advisory
 * lock so two creates at the same instant cannot pick the same number. Must run inside the caller's
 * transaction (the lock is released at commit). Numbers written by other paths that do not match
 * `PREFIX-<digits>` exactly (e.g. INV-AGR-<timestamp>) are ignored instead of hijacking the sequence.
 */
/**
 * A DELETED NUMBER IS NOT A FREE NUMBER. (T58j)
 *
 *   owner: "field-service deleted invoice numbers are reused."
 *
 * They were, and so were quote, job, agreement and repair-order numbers, because "highest existing
 * + 1" is a function of the rows that still EXIST. Delete the newest invoice and the next one is
 * issued the number the deleted one had. That is wrong for a document: INV-00042 may already be in
 * somebody's inbox, in their accounts, or quoted in an email, and a second, different INV-00042
 * makes the two impossible to tell apart. Numbering must only ever go forwards.
 *
 * THE HIGH-WATER MARK lives in `company.settings.docSeq[PREFIX]` — deliberately NOT a new table.
 * Every CRM template already has `company.settings`, so this needs no migration and no schema.ts
 * change in thirteen places, and this round has already shown what a migration costs when it goes
 * wrong. It is read and advanced inside the advisory lock that was already held, in one statement,
 * so two concurrent creates still cannot pick the same number.
 *
 * `GREATEST(mark + 1, max + 1)` — one past whichever is higher. Which gives the property that makes
 * this safe to ship: on a database where nothing has been deleted the mark equals the max, so the
 * number handed out is byte-for-byte the one today's code would have handed out. Behaviour changes
 * only AFTER a delete, which is the bug. Every existing assertion about numbering still holds.
 *
 * IT CANNOT BREAK A CREATE. A failed statement poisons the whole transaction, so nothing here is
 * allowed to fail: `to_regclass` (which returns NULL rather than erroring) proves the table is there
 * before it is touched, and a stored value that is not digits is read as 0 rather than cast. If
 * anything is missing the mark is skipped and numbering falls back to exactly today's behaviour —
 * degraded, never broken. Issuing a number is not the place to be clever.
 */
let companyTablePresent: boolean | null = null

/**
 * `scope` and `markKey` exist for a sequence that is NOT one per company. (T58k)
 *
 * Contractor change orders are numbered per PROJECT — CO-001, CO-002 within each project — so the
 * rows to look at are the project's, and the high-water mark has to be the project's too. Given only
 * a company-wide mark, every project after the first would start above the last project's highest
 * number and the per-project sequence would be meaningless.
 *
 *   · `scope`      an extra condition ANDed into the row query (e.g. the project)
 *   · `markKey`    the docSeq key and the lock key, defaulting to the prefix (e.g. `CO:<projectId>`)
 */
export async function nextNumber(
  tx: any, table: any, numberColumn: any, companyColumn: any, companyId: string,
  opts: { prefix: string; pad?: number; seed?: number; scope?: any; markKey?: string },
): Promise<string> {
  const { prefix, pad = 5, seed = 0, scope, markKey } = opts
  const key = markKey || prefix
  const { eq, and, sql } = await import('drizzle-orm')
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':' + key}))`)
  const where = scope ? and(eq(companyColumn, companyId), scope) : eq(companyColumn, companyId)
  const rows: Array<{ number: string | null }> = await tx.select({ number: numberColumn }).from(table).where(where)
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = seed
  for (const r of rows) { const m = String(r.number || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }

  let n = max + 1
  if (companyTablePresent === null) {
    // Cannot error: to_regclass answers NULL for a name that does not resolve.
    const probe: any = await tx.execute(sql`SELECT to_regclass('company') IS NOT NULL AS present`)
    companyTablePresent = !!(probe?.rows?.[0]?.present ?? probe?.[0]?.present)
  }
  if (companyTablePresent) {
    /**
     * MERGED, not `jsonb_set`. jsonb_set does not create a missing INTERMEDIATE key: on a company
     * whose settings had no `docSeq` object yet — which is every company — `jsonb_set(settings,
     * ARRAY['docSeq','INV'], …)` returns the settings unchanged, so the mark was silently never
     * written and every number came back 0. Concatenation builds the path it needs.
     * (Caught by scripts/check-numbers-never-reused.ts on its first run, not by reading it.)
     */
    /**
     * EVERY PARAMETER IS CAST. `jsonb_build_object` is variadic "any" and `->>` is overloaded
     * (jsonb->>text and jsonb->>int), so a bare placeholder in either position leaves Postgres with
     * no way to infer a type and the whole statement fails with "could not determine data type of
     * parameter $1" — which, because this runs inside the create, 500'd every invoice. The suites
     * caught it; the PGlite guard had not, because there the first use of the parameter sat inside
     * ARRAY['docSeq', $2] where the element type is inferable from its neighbour.
     */
    const marked: any = await tx.execute(sql`
      UPDATE company SET settings = (
        COALESCE(settings::jsonb, '{}'::jsonb) || jsonb_build_object('docSeq',
          COALESCE(settings::jsonb -> 'docSeq', '{}'::jsonb) || jsonb_build_object(${key}::text, GREATEST(
            CASE WHEN (settings::jsonb -> 'docSeq' ->> ${key}::text) ~ '^[0-9]+$'
                 THEN ((settings::jsonb -> 'docSeq' ->> ${key}::text)::bigint + 1)
                 ELSE 0 END,
            ${n}::bigint
          ))
        )
      )::json
      WHERE id = ${companyId}::text
      RETURNING (settings::jsonb -> 'docSeq' ->> ${key}::text) AS seq
    `)
    const seq = marked?.rows?.[0]?.seq ?? marked?.[0]?.seq
    // A company row that is not there leaves `n` exactly as it was — today's behaviour.
    if (seq !== undefined && seq !== null && /^\d+$/.test(String(seq))) n = Number(seq)
  }

  return `${prefix}-${pad > 0 ? String(n).padStart(pad, '0') : n}`
}

export type NumberingOptions = { prefix: string; pad?: number; seed?: number }
