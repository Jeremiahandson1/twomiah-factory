// Money rules shared by invoices and quotes in every CRM template. One implementation, vendored into
// each tenant (see ../index.ts). Nothing here knows a vertical; callers inject their Drizzle tables.
// drizzle-orm is imported lazily inside nextNumber() only, so the pure money helpers (invoiceBalance,
// recomputeStatus, calcTotals, …) can be imported and unit-tested without pulling drizzle-orm.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

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
  return new Date(inv.dueDate as any) < new Date()
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

/** Due date = today + payment terms (whole days), on the calendar day boundary in UTC like the rest of the app. */
export function dueDateFromTerms(settings: any, from: Date = new Date()): Date {
  return new Date(from.getTime() + paymentTermsDaysFrom(settings) * 86400000)
}

/**
 * Normalise a date field coming from a form. '' / null clear the field (→ null); undefined leaves it
 * alone; anything else must parse. Returns { error } for garbage so the route can answer 400 instead
 * of handing Postgres an empty string (which was a 500).
 */
export function normalizeDateInput(v: unknown): { value?: Date | null; error?: string } {
  if (v === undefined) return {}
  if (v === null || v === '') return { value: null }
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return { error: 'Enter a valid date.' }
  return { value: d }
}

/**
 * Next document number for a company: highest existing `PREFIX-<n>` + 1, under a per-company advisory
 * lock so two creates at the same instant cannot pick the same number. Must run inside the caller's
 * transaction (the lock is released at commit). Numbers written by other paths that do not match
 * `PREFIX-<digits>` exactly (e.g. INV-AGR-<timestamp>) are ignored instead of hijacking the sequence.
 */
export async function nextNumber(tx: any, table: any, numberColumn: any, companyColumn: any, companyId: string, opts: { prefix: string; pad?: number; seed?: number }): Promise<string> {
  const { prefix, pad = 5, seed = 0 } = opts
  const { eq, sql } = await import('drizzle-orm')
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':' + prefix}))`)
  const rows: Array<{ number: string | null }> = await tx.select({ number: numberColumn }).from(table).where(eq(companyColumn, companyId))
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = seed
  for (const r of rows) { const m = String(r.number || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  const n = max + 1
  return `${prefix}-${pad > 0 ? String(n).padStart(pad, '0') : n}`
}

export type NumberingOptions = { prefix: string; pad?: number; seed?: number }
