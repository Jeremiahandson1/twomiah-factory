// Money rules shared by invoices and quotes in every CRM template. One implementation, vendored into
// each tenant (see ../index.ts). Nothing here knows a vertical; callers inject their Drizzle tables.
import { eq, sql } from 'drizzle-orm'

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

/**
 * "Overdue" is derived, never stored: billed, not fully paid, past its due date. Computed at read
 * time so the list, the stats, the dashboard and Reports agree without a job flipping statuses.
 */
export function isOverdue(inv: { status: string; dueDate: Date | string | null; total: any; amountPaid: any }, openStatuses: string[] = DEFAULT_OPEN_STATUSES): boolean {
  if (!openStatuses.includes(inv.status) || !inv.dueDate) return false
  if (Number(inv.total) - Number(inv.amountPaid) <= 0.005) return false
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
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':' + prefix}))`)
  const rows: Array<{ number: string | null }> = await tx.select({ number: numberColumn }).from(table).where(eq(companyColumn, companyId))
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = seed
  for (const r of rows) { const m = String(r.number || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  const n = max + 1
  return `${prefix}-${pad > 0 ? String(n).padStart(pad, '0') : n}`
}

export type NumberingOptions = { prefix: string; pad?: number; seed?: number }
