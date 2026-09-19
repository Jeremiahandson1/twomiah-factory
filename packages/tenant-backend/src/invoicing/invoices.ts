// Invoices — ONE implementation for every CRM template, vendored into each tenant at generation.
// The template's route file passes its Drizzle db + tables, auth/permission middleware, socket
// emitter, email + PDF services and a small options object for the few things a vertical does
// differently (salon tips and its 'open' status, RV numbering). Everything else is the same
// product, so a fix here lands in all of them on their next deploy.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, count, desc, asc, sql, inArray, lt, gte, isNull } from 'drizzle-orm'
import { round2, calcTotals, rawSubtotal, DEFAULT_OPEN_STATUSES, isOverdue, overdueCutoff, startOfUtcDay, deriveStatus, invoiceBalance, recomputeStatus, defaultTaxRateFrom, dueDateFromTerms, normalizeDateInput, nextNumber, type NumberingOptions } from './money'
import { mailFailureReason } from '../integrations/mailError'

export interface InvoiceTables {
  invoice: any
  invoiceLineItem: any
  payment: any
  contact: any
  project: any
  quote: any
  company: any
}

export interface InvoiceOptions {
  /** Statuses that count as billed-and-collectable. Default includes salon's 'open'. */
  openStatuses?: string[]
  /** Document numbering. Default INV-00001. RV uses { prefix: 'INV', pad: 0, seed: 1000 } → INV-1001. */
  numbering?: NumberingOptions
  /** payment.tipAmount exists and gratuity is recorded on payments (salon). */
  tips?: boolean
  /** Require at least this many line items on create (landscaping used 1). */
  minLineItems?: number
  /** Maximum page size for the list. */
  maxLimit?: number
  /**
   * Runs inside the payment transaction, before the payment is written (the invoice row is locked). A
   * returned message refuses the payment (409). Events use it: a deposit on an enquiry books the date, or
   * is refused when the room is already held. Interactive payments only — a processor's money is already
   * taken, so the Stripe path has its own after-payment hook.
   */
  onPayment?: (tx: any, invoice: any, amount: number) => Promise<string | null>
  /**
   * Records an invoice can be raised against BEYOND the contact, project and quote every CRM has, as column
   * name → the table it points at. The vet passes { patientId: patient }: the owner pays the bill, but the
   * bill is FOR an animal, and in a multi-pet household nothing said which one. (Vet T12 M6)
   * The column is filterable (?patientId=), settable on create and on edit, and checked to exist in this
   * company before it is stored.
   */
  links?: Record<string, any>
}

export interface InvoiceDeps {
  db: any
  tables: InvoiceTables
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: Record<string, string>
  sendInvoiceEmail: (to: string, data: Record<string, unknown>) => Promise<unknown>
  /** Lazy so pdfkit is only loaded when a PDF is actually requested. */
  loadPdf: () => Promise<(invoice: any, company: any) => Promise<Buffer>>
  options?: InvoiceOptions
}

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0, 'Quantity cannot be negative').default(1),
  unitPrice: z.number().min(0, 'Price cannot be negative').default(0),
})
const optionalId = z.string().optional().transform(v => (v === '' ? undefined : v))
const invoiceSchema = z.object({
  contactId: optionalId,
  projectId: optionalId,
  // '' and null clear the date; the route validates the string (a blank used to reach Postgres as '' → 500)
  dueDate: z.union([z.string(), z.null()]).optional(),
  // Issue date is settable (defaults to today) so historical / backdated invoices can be entered; it is
  // never null (the column is notNull).
  issueDate: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  discount: z.number().min(0, 'Discount cannot be negative').default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
})
const PAYMENT_METHODS = ['card', 'cash', 'check', 'bank_transfer', 'stripe', 'other'] as const

const toRow = (items: z.infer<typeof lineItemSchema>[], invoiceId: string) => items.map((item, i) => ({
  description: item.description,
  quantity: item.quantity.toString(),
  unitPrice: item.unitPrice.toString(),
  total: round2(item.quantity * item.unitPrice).toString(),
  sortOrder: i,
  invoiceId,
}))

export type InvoiceLine = z.infer<typeof lineItemSchema>

/**
 * The one write path for a new invoice and its lines, used by POST / and by any record that raises its
 * own invoice (events). Runs inside the caller's transaction — numbering takes an advisory lock. The
 * caller has already validated the values; totals always come from calcTotals.
 */
export async function insertInvoice(
  tx: any, t: InvoiceTables, numbering: NumberingOptions,
  v: { companyId: string; contactId: string; projectId?: string; notes?: string; terms?: string; dueDate: Date; issueDate: Date; taxRate: number; discount?: number; status?: string; extra?: Record<string, any> },
  lineItems: InvoiceLine[],
) {
  const totals = calcTotals(lineItems, v.taxRate, v.discount ?? 0)
  // Normalised HERE rather than only in the route, so every path that raises an invoice agrees: snow
  // billing, agreements, wellness plans, a billed visit and an event deposit all call this. (T14 M17)
  const dueDate = startOfUtcDay(v.dueDate)
  const issueDate = startOfUtcDay(v.issueDate)
  const number = await nextNumber(tx, t.invoice, t.invoice.number, t.invoice.companyId, v.companyId, numbering)
  const [created] = await tx.insert(t.invoice).values({
    contactId: v.contactId, projectId: v.projectId, notes: v.notes, terms: v.terms,
    number, companyId: v.companyId, dueDate, issueDate,
    subtotal: totals.subtotal.toString(), taxRate: String(v.taxRate), taxAmount: totals.taxAmount.toString(),
    discount: totals.effectiveDiscount.toString(), total: totals.total.toString(), amountPaid: '0',
    ...(v.status ? { status: v.status } : {}),
    ...(v.extra || {}),
  }).returning()
  const items = lineItems.length ? await tx.insert(t.invoiceLineItem).values(toRow(lineItems, created.id)).returning() : []
  return { ...created, lineItems: items }
}

/**
 * New totals + status when an invoice's lines, tax rate or discount change. Refuses a total below the
 * money already collected (refund or void instead). Shared by PUT /:id and any record that keeps an
 * invoice in step with its own lines (events).
 */
export function retotalInvoice(existing: { amountPaid: any; status: string }, lines: InvoiceLine[], taxRate: number, discount: number): { error: string } | { fields: Record<string, string> } {
  const calc = calcTotals(lines, taxRate, discount)
  const paid = Number(existing.amountPaid)
  if (calc.total < paid - 0.005) return { error: `This invoice already has $${paid.toFixed(2)} in payments; the total can't be lowered below that. Refund or void instead.` }
  // amountPaid is gross (refunds live in amountRefunded), so a partially refunded, fully paid invoice stays 'paid'.
  return {
    fields: {
      subtotal: calc.subtotal.toString(), taxRate: String(taxRate), taxAmount: calc.taxAmount.toString(),
      discount: calc.effectiveDiscount.toString(), total: calc.total.toString(),
      status: paid >= calc.total - 0.005 ? 'paid' : paid > 0 ? 'partial' : existing.status,
    },
  }
}

/** Replace an invoice's lines inside the caller's transaction; returns the new rows. */
export async function replaceInvoiceLines(tx: any, t: InvoiceTables, invoiceId: string, lines: InvoiceLine[]) {
  await tx.delete(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, invoiceId))
  return lines.length ? await tx.insert(t.invoiceLineItem).values(toRow(lines, invoiceId)).returning() : []
}

export interface RecordPaymentInput {
  invoiceId: string
  /** Company scope. The invoice routes always pass it; a Stripe webhook names the invoice by id alone. */
  companyId?: string
  /** Whole cents (round2'd by the caller). */
  amount: number
  method: string
  reference?: string | null
  notes?: string | null
  /** Gratuity (salon) — written only when the template records tips. */
  tipAmount?: number
  /** When the money actually arrived (Stripe's timestamp). Omitted → the column default (now). */
  paidAt?: Date
  /**
   * Money a processor already collected (a Stripe webhook) is recorded even above the balance — the
   * model settles paid > total at a $0 balance. Interactive payments keep the balance ceiling.
   */
  allowOverpayment?: boolean
  /**
   * A processor retries deliveries: when a payment on this invoice already carries `reference`, return it
   * instead of inserting a second one. The invoice row lock serialises concurrent retries.
   */
  idempotentByReference?: boolean
  /** The template's InvoiceOptions.onPayment, passed by the route; a returned message refuses (409). */
  beforeWrite?: (tx: any, invoice: any, amount: number) => Promise<string | null>
}

export type RecordPaymentOutcome =
  | { ok: true; payment: any; row: any; newBalance: number; newStatus: string; duplicate: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string }

/**
 * The one way money is recorded on an invoice — POST /:id/payments and the Stripe webhook both come
 * through here. Balance check and write in ONE transaction with the invoice row locked: two payments
 * (or a payment and a refund) sent at the same instant cannot both pass the check.
 */
export async function recordInvoicePayment(db: any, t: { invoice: any; payment: any }, tips: boolean, input: RecordPaymentInput): Promise<RecordPaymentOutcome> {
  const { invoiceId: id, amount } = input
  let outcome: RecordPaymentOutcome = { ok: false, status: 400, error: 'Payment failed' }
  await db.transaction(async (tx: any) => {
    const locked: any = input.companyId
      ? await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${input.companyId} FOR UPDATE`)
      : await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} FOR UPDATE`)
    const row = (locked.rows || locked)[0]
    if (!row) { outcome = { ok: false, status: 404, error: 'Invoice not found' }; return }
    if (row.status === 'void') { outcome = { ok: false, status: 400, error: 'This invoice is void and cannot take payments.' }; return }
    if (row.status === 'refunded') { outcome = { ok: false, status: 400, error: 'This sale was refunded. Start a new invoice to charge the client again.' }; return }
    if (input.idempotentByReference && input.reference) {
      const [existing] = await tx.select().from(t.payment).where(and(eq(t.payment.invoiceId, id), eq(t.payment.reference, input.reference))).limit(1)
      if (existing) {
        const balance = invoiceBalance({ status: row.status, total: row.total, amountPaid: row.amount_paid, amountRefunded: row.amount_refunded })
        outcome = { ok: true, payment: existing, row, newBalance: balance, newStatus: row.status, duplicate: true }
        return
      }
    }
    // Owed is net of refunds: if a deposit was refunded the balance reopened, and a payment may cover it.
    const balanceDue = invoiceBalance({ status: row.status, total: row.total, amountPaid: row.amount_paid, amountRefunded: row.amount_refunded })
    if (!input.allowOverpayment && amount > balanceDue + 0.005) { outcome = { ok: false, status: 400, error: `Payment exceeds the balance due — $${balanceDue.toFixed(2)} remaining` }; return }
    if (input.beforeWrite) {
      const refusal = await input.beforeWrite(tx, row, amount)
      if (refusal) { outcome = { ok: false, status: 409, error: refusal }; return }
    }
    const values: any = { invoiceId: id, amount: amount.toString(), method: input.method, reference: input.reference, notes: input.notes }
    if (tips) values.tipAmount = (input.tipAmount ?? 0).toString()
    if (input.paidAt) values.paidAt = input.paidAt
    const [newPayment] = await tx.insert(t.payment).values(values).returning()
    const newAmountPaid = round2(Number(row.amount_paid) + amount)
    const newBalance = invoiceBalance({ status: row.status, total: row.total, amountPaid: newAmountPaid, amountRefunded: row.amount_refunded })
    // A draft may take a payment (a walk-in pays at the desk before anything is emailed); the payment issues it.
    const newStatus = recomputeStatus({ total: row.total, amountPaid: newAmountPaid, amountRefunded: row.amount_refunded }, row.status === 'draft' ? 'sent' : row.status)
    await tx.update(t.invoice).set({ amountPaid: newAmountPaid.toString(), status: newStatus, paidAt: newBalance <= 0.005 ? new Date() : null, updatedAt: new Date() }).where(eq(t.invoice.id, id))
    outcome = { ok: true, payment: newPayment, row, newBalance, newStatus, duplicate: false }
  })
  return outcome
}

export interface RecordRefundInput {
  invoiceId: string
  /** Company scope. The invoice routes always pass it; a Stripe webhook names the invoice by id alone. */
  companyId?: string
  /** Whole cents (round2'd by the caller). */
  amount: number
  /** Omitted → how the money came in (the most recent positive payment's method), else 'other'. */
  method?: string | null
  reference?: string | null
  notes?: string | null
  /** When the money actually went back (Stripe's timestamp). Omitted → the column default (now). */
  paidAt?: Date
  /**
   * A processor retries deliveries and may also report a refund this CRM issued itself: when a refund on
   * this invoice already carries `reference`, return it instead of inserting a second one.
   */
  idempotentByReference?: boolean
}

export type RecordRefundOutcome =
  | { ok: true; refund: any; invoice: any; row: any; newStatus: string; duplicate: boolean }
  | { ok: false; status: 400 | 404; error: string }

/**
 * The one way a refund is recorded on an invoice — POST /:id/refund and the Stripe refund paths (the
 * owner's refund call and the charge.refunded webhook) all come through here. A refund is its own
 * ledger event: a negative payment row plus amountRefunded. amountPaid stays gross, so the sale stays
 * paid and a refund never reopens a balance the client must settle again — except a refunded DEPOSIT
 * on a not-fully-paid invoice, which reopens what is still owed (recomputeStatus). Row-locked like
 * recordInvoicePayment so a payment and a refund at the same instant cannot both pass the check.
 */
export async function recordInvoiceRefund(db: any, t: { invoice: any; payment: any }, input: RecordRefundInput): Promise<RecordRefundOutcome> {
  const { invoiceId: id, amount } = input
  let outcome: RecordRefundOutcome = { ok: false, status: 400, error: 'Refund failed' }
  await db.transaction(async (tx: any) => {
    const locked: any = input.companyId
      ? await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${input.companyId} FOR UPDATE`)
      : await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} FOR UPDATE`)
    const row = (locked.rows || locked)[0]
    if (!row) { outcome = { ok: false, status: 404, error: 'Invoice not found' }; return }
    if (row.status === 'void') { outcome = { ok: false, status: 400, error: 'This invoice is void.' }; return }
    if (input.idempotentByReference && input.reference) {
      const [existing] = await tx.select().from(t.payment).where(and(eq(t.payment.invoiceId, id), eq(t.payment.reference, input.reference))).limit(1)
      if (existing) { outcome = { ok: true, refund: existing, invoice: null, row, newStatus: row.status, duplicate: true }; return }
    }
    const paid = round2(Number(row.amount_paid))
    const refunded = round2(Number(row.amount_refunded || 0))
    const net = round2(paid - refunded)
    if (paid <= 0.005) { outcome = { ok: false, status: 400, error: 'This invoice has no payments to refund.' }; return }
    if (net <= 0.005) { outcome = { ok: false, status: 400, error: 'Everything collected on this invoice has already been refunded.' }; return }
    if (amount > net + 0.005) { outcome = { ok: false, status: 400, error: `Refund exceeds what was collected — $${net.toFixed(2)} still refundable on this invoice.` }; return }
    // Default to how the money came in — the most recent positive payment's method.
    const [last] = await tx.select({ method: t.payment.method }).from(t.payment).where(and(eq(t.payment.invoiceId, id), sql`${t.payment.amount}::numeric > 0`)).orderBy(desc(t.payment.paidAt)).limit(1)
    const method = input.method || last?.method || 'other'
    const values: any = { invoiceId: id, amount: (-amount).toString(), method, reference: input.reference || null, notes: input.notes || 'Refund' }
    if (input.paidAt) values.paidAt = input.paidAt
    const [refund] = await tx.insert(t.payment).values(values).returning()
    const newRefunded = round2(refunded + amount)
    // 'refunded' (closed, $0 owed) only when the WHOLE sale is returned (refunded ≥ total). Refunding a
    // deposit (refunded ≥ paid but < total) reopens the balance — the work is still owed — so the invoice
    // drops back to its billed state, not 'refunded'. (professional refund model)
    const newStatus = recomputeStatus({ total: row.total, amountPaid: row.amount_paid, amountRefunded: newRefunded }, row.status)
    const [updated] = await tx.update(t.invoice).set({ amountRefunded: newRefunded.toString(), status: newStatus, updatedAt: new Date() }).where(eq(t.invoice.id, id)).returning()
    outcome = { ok: true, refund, invoice: updated, row, newStatus, duplicate: false }
  })
  return outcome
}

export interface ApplyCreditInput {
  invoiceId: string
  companyId: string
  /** Whole cents (round2'd by the caller) taken off the price, before tax — the same field as a discount. */
  amount: number
  /** Why — written onto the invoice notes as the record of the credit. */
  reason: string
  /** Who applied it, for that record. */
  by?: string | null
}

export type ApplyCreditOutcome =
  | { ok: true; invoice: any; balanceBefore: number; balanceAfter: number }
  | { ok: false; status: 400 | 404; error: string }

/**
 * A credit lowers what the client owes WITHOUT returning money — the other half of the refund model
 * (money.ts: "give money back without reopening is a credit/price reduction"). A refund returns money, so
 * on a part-paid invoice the balance rises; a credit forgives part of the price, so the balance falls.
 * It goes through the same rules as editing the discount (retotalInvoice: tax recalculated on the lower
 * price, never below the money already collected), under the invoice row lock, and adds to the invoice's
 * discount — the one price reduction every CRM and the events ledger already carry (an event invoice's
 * menu re-sync keeps it). The amount, the reason and who applied it are written onto the invoice notes.
 * It can take off at most what is still owed. (events T15–T17 B2)
 */
export async function applyInvoiceCredit(db: any, t: { invoice: any; invoiceLineItem: any }, input: ApplyCreditInput): Promise<ApplyCreditOutcome> {
  const { invoiceId: id, amount } = input
  let outcome: ApplyCreditOutcome = { ok: false, status: 400, error: 'Credit failed' }
  await db.transaction(async (tx: any) => {
    const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${input.companyId} FOR UPDATE`)
    const row = (locked.rows || locked)[0]
    if (!row) { outcome = { ok: false, status: 404, error: 'Invoice not found' }; return }
    if (row.status === 'void') { outcome = { ok: false, status: 400, error: 'This invoice is void.' }; return }
    if (row.status === 'refunded') { outcome = { ok: false, status: 400, error: 'This sale was refunded and can no longer be changed.' }; return }
    const money = { status: row.status, total: row.total, amountPaid: row.amount_paid, amountRefunded: row.amount_refunded }
    const balanceBefore = invoiceBalance(money)
    if (balanceBefore <= 0.005) { outcome = { ok: false, status: 400, error: 'Nothing is owed on this invoice, so there is nothing to credit.' }; return }
    const current = await tx.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder))
    const lines = current.map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }))
    const taxRate = Number(row.tax_rate) || 0
    const newDiscount = round2(Number(row.discount || 0) + amount)
    const subtotal = rawSubtotal(lines)
    if (newDiscount > subtotal + 0.005) { outcome = { ok: false, status: 400, error: `A credit can't take the price below $0 — at most $${round2(Math.max(0, subtotal - Number(row.discount || 0))).toFixed(2)} can be credited.` }; return }
    // A credit forgives what is owed — it never goes past it (that would be money to hand back: a refund).
    // Checked first, so the answer names the most that can be credited.
    const takesOff = (c: number) => round2(Number(row.total) - calcTotals(lines, taxRate, round2(Number(row.discount || 0) + c)).total)
    if (takesOff(amount) > balanceBefore + 0.005) {
      let most = Math.floor((balanceBefore / (1 + taxRate / 100)) * 100) / 100
      while (most > 0 && takesOff(most) > balanceBefore + 0.005) most = round2(most - 0.01)
      outcome = { ok: false, status: 400, error: `Only $${balanceBefore.toFixed(2)} is still owed — the most you can credit is $${most.toFixed(2)}${taxRate > 0 ? ' before tax' : ''}.` }
      return
    }
    const retotal = retotalInvoice({ amountPaid: row.amount_paid, status: row.status }, lines, taxRate, newDiscount)
    if ('error' in retotal) { outcome = { ok: false, status: 400, error: retotal.error }; return }
    const balanceAfter = invoiceBalance({ ...money, total: retotal.fields.total, status: retotal.fields.status })
    const note = `Credit $${amount.toFixed(2)} applied ${new Date().toISOString().slice(0, 10)}${input.by ? ` by ${input.by}` : ''}: ${input.reason}`
    const set: Record<string, any> = { ...retotal.fields, notes: row.notes ? `${row.notes}\n${note}` : note, updatedAt: new Date() }
    if (balanceAfter <= 0.005 && !row.paid_at) set.paidAt = new Date()
    const [updated] = await tx.update(t.invoice).set(set).where(eq(t.invoice.id, id)).returning()
    outcome = { ok: true, invoice: updated, balanceBefore, balanceAfter }
  })
  return outcome
}

// Once per process, heal invoices whose STORED status drifted during an earlier broken-refund build —
// a fully-refunded invoice must read 'refunded' and a fully-paid one 'paid', but that window left some
// stuck on 'partial'/'sent', mislabelling them in the list and the status filter. Only the unambiguous
// cases are corrected (never void/draft, never a genuinely partial or unpaid row), keyed off the amounts
// the way recomputeStatus() does, so it is safe and idempotent. Boot runs db/migrate.ts first (which
// waits for the DB), so the DB is reachable by the time these routes are constructed.
let invoiceStatusReconciled = false
async function reconcileInvoiceStatuses(db: any, invoice: any) {
  if (invoiceStatusReconciled) return
  await db.execute(sql`UPDATE ${invoice} SET status = 'refunded', updated_at = now()
    WHERE status NOT IN ('void', 'draft', 'refunded') AND total::numeric > 0 AND coalesce(amount_refunded, 0)::numeric >= total::numeric`)
  await db.execute(sql`UPDATE ${invoice} SET status = 'paid', updated_at = now()
    WHERE status NOT IN ('void', 'draft', 'paid', 'refunded') AND total::numeric > 0 AND amount_paid::numeric >= total::numeric AND coalesce(amount_refunded, 0)::numeric < total::numeric`)
  // …and the direction that was missing: a row stuck at 'refunded' when only PART of the money went back.
  // recomputeStatus never produces that — it says 'refunded' only once the whole sale is returned — so such
  // rows are drift from an older rule. They matter because 'refunded' is taken to mean "owes nothing" by the
  // stats tile and by Reports, so three of them hid $206 that was genuinely still owed. A deposit that was
  // refunded is billed and owed again: paid in full → 'paid', money still held → 'partial', else open.
  await db.execute(sql`UPDATE ${invoice} SET status = CASE
      WHEN amount_paid::numeric >= total::numeric THEN 'paid'
      WHEN (amount_paid::numeric - coalesce(amount_refunded, 0)::numeric) > 0.005 THEN 'partial'
      ELSE 'sent' END, updated_at = now()
    WHERE status = 'refunded' AND total::numeric > 0 AND coalesce(amount_refunded, 0)::numeric < total::numeric`)
  invoiceStatusReconciled = true
}

export function createInvoiceRoutes(deps: InvoiceDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, sendInvoiceEmail, loadPdf } = deps
  const openStatuses = deps.options?.openStatuses || DEFAULT_OPEN_STATUSES
  const numbering: NumberingOptions = deps.options?.numbering || { prefix: 'INV', pad: 5, seed: 0 }
  const tips = !!deps.options?.tips
  const maxLimit = deps.options?.maxLimit ?? 100
  const minLineItems = deps.options?.minLineItems ?? 0
  const derive = (inv: any) => deriveStatus(inv, openStatuses)

  const app = new Hono()
  // Self-heal drifted invoice statuses on boot (see reconcileInvoiceStatuses). Fire-and-forget so it
  // can never delay or fail server startup; idempotent, so re-running is a no-op once statuses are clean.
  void reconcileInvoiceStatuses(db, t.invoice).catch(() => {})
  app.use('*', authenticate)

  const companySettings = async (companyId: string) => {
    const [co] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return (co?.settings as any) || {}
  }
  const ownContact = async (companyId: string, id: string) => (await db.select({ id: t.contact.id }).from(t.contact).where(and(eq(t.contact.id, id), eq(t.contact.companyId, companyId))).limit(1))[0]
  const ownProject = async (companyId: string, id: string) => (await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, id), eq(t.project.companyId, companyId))).limit(1))[0]

  // Extra records an invoice can be raised against, per template (crm-vet: patientId). Taken from the RAW
  // body, because the zod schema drops what it does not name.
  const links: Record<string, any> = deps.options?.links || {}
  const linkCols = Object.keys(links)
  const linkLabel = (col: string) => col.replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  const linkValues = async (companyId: string, raw: any): Promise<{ values: Record<string, any> } | { error: string }> => {
    const values: Record<string, any> = {}
    if (!raw || typeof raw !== 'object') return { values }
    for (const col of linkCols) {
      if (raw[col] === undefined) continue
      const id = typeof raw[col] === 'string' && raw[col].trim() ? raw[col].trim() : null
      if (id) {
        const table = links[col]
        const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).limit(1)
        if (!row) return { error: `That ${linkLabel(col)} does not exist.` }
      }
      values[col] = id
    }
    return { values }
  }

  // ---------------------------------------------------------------- list
  app.get('/', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const contactId = c.req.query('contactId')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), maxLimit)

    const conditions: any[] = [eq(t.invoice.companyId, currentUser.companyId)]
    // 'overdue' is derived, never stored: translate the filter instead of matching a status that no row
    // has, and keep past-due rows out of the plain open-status filters so the page and its count agree.
    // …and the customer has the whole of the due day, so the cut-off is the start of TODAY, not this
    // instant — otherwise the filter disagreed with isOverdue by up to a day. (T14 M17)
    const now = overdueCutoff()
    if (status === 'overdue') { conditions.push(inArray(t.invoice.status, openStatuses)); conditions.push(lt(t.invoice.dueDate, now)) }
    else if (status && openStatuses.includes(status)) { conditions.push(eq(t.invoice.status, status)); conditions.push(or(isNull(t.invoice.dueDate), gte(t.invoice.dueDate, now))) }
    else if (status) conditions.push(eq(t.invoice.status, status))
    if (contactId) conditions.push(eq(t.invoice.contactId, contactId))
    for (const col of linkCols) { const v = c.req.query(col); if (v) conditions.push(eq(t.invoice[col], v)) }

    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.invoice).where(where).orderBy(desc(t.invoice.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.invoice).where(where),
    ])
    const invoiceIds: string[] = data.map((inv: any) => inv.id)
    const contactIds: string[] = [...new Set<string>(data.filter((inv: any) => inv.contactId).map((inv: any) => inv.contactId))]
    const [contacts, lineItems, payments] = await Promise.all([
      contactIds.length ? db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, currentUser.companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      invoiceIds.length ? db.select().from(t.invoiceLineItem).where(inArray(t.invoiceLineItem.invoiceId, invoiceIds)).orderBy(asc(t.invoiceLineItem.sortOrder)) : Promise.resolve([]),
      invoiceIds.length ? db.select().from(t.payment).where(inArray(t.payment.invoiceId, invoiceIds)).orderBy(desc(t.payment.paidAt)) : Promise.resolve([]),
    ])
    const contactMap = Object.fromEntries(contacts.map((ct: any) => [ct.id, ct]))
    const lineItemMap: Record<string, any[]> = {}; lineItems.forEach((li: any) => { (lineItemMap[li.invoiceId] ||= []).push(li) })
    const paymentMap: Record<string, any[]> = {}; payments.forEach((p: any) => { (paymentMap[p.invoiceId] ||= []).push(p) })

    const rows = data.map((inv: any) => ({ ...inv, status: derive(inv), balance: invoiceBalance(inv), contact: inv.contactId ? contactMap[inv.contactId] || null : null, lineItems: lineItemMap[inv.id] || [], payments: paymentMap[inv.id] || [] }))
    return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // ---------------------------------------------------------------- stats
  // One set of numbers for the dashboard, Reports and the invoice list:
  //   totalAmount    = gross billed: every invoice that is not draft / void, a refunded sale included (a refund
  //                    never takes a sale out of what was invoiced — Reports "invoiced" is the same; T14 H4)
  //   outstanding    = sum of balances over issued (not draft / void / refunded), floored per invoice. That
  //                    exclusion is safe ONLY because 'refunded' means the whole sale came back — a status a
  //                    partial refund must never carry (see reconcileInvoiceStatuses)
  //   paidAmount     = money actually kept: amountPaid − amountRefunded on every non-void invoice
  //   refundedAmount = money returned: amountRefunded on EVERY invoice, void included — void is only allowed once
  //                    the money is refunded, so that is where refunds sit, and Reports counts them (T29 L3)
  app.get('/stats', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const invoices = await db.select({ status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, amountRefunded: t.invoice.amountRefunded, dueDate: t.invoice.dueDate }).from(t.invoice).where(eq(t.invoice.companyId, currentUser.companyId))
    const stats: Record<string, number> = { total: invoices.length, draft: 0, sent: 0, paid: 0, overdue: 0, totalAmount: 0, paidAmount: 0, outstanding: 0, refundedAmount: 0 }
    for (const inv of invoices) {
      const s = derive(inv)
      stats[s] = (stats[s] || 0) + 1
      if (inv.status !== 'draft' && inv.status !== 'void') stats.totalAmount = round2(stats.totalAmount + Number(inv.total))
      if (inv.status !== 'draft' && inv.status !== 'void' && inv.status !== 'refunded') stats.outstanding = round2(stats.outstanding + invoiceBalance(inv))
      if (inv.status !== 'void') stats.paidAmount = round2(stats.paidAmount + Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0))
      // Money that went back went back, whatever became of the invoice afterwards — and voiding REQUIRES the
      // refund first ("Refund them first, then void"), so a void invoice is precisely where refunds end up. That
      // is why skipping them here disagreed with Reports, which counts the refund ledger and cannot see a status.
      // paidAmount still skips void, and does not need to: a void invoice's paid − refunded is 0 by that rule.
      // (Contractor T29 L3)
      stats.refundedAmount = round2(stats.refundedAmount + Number(inv.amountRefunded || 0))
    }
    return c.json(stats)
  })

  // ---------------------------------------------------------------- read one
  app.get('/:id', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [found] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, currentUser.companyId))).limit(1)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    const cid = currentUser.companyId
    const [ct, pr, qt, lineItems, payments] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, cid))).limit(1) : Promise.resolve([]),
      found.quoteId ? db.select().from(t.quote).where(and(eq(t.quote.id, found.quoteId), eq(t.quote.companyId, cid))).limit(1) : Promise.resolve([]),
      db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder)),
      db.select().from(t.payment).where(eq(t.payment.invoiceId, id)).orderBy(desc(t.payment.paidAt)),
    ])
    const balance = invoiceBalance(found)
    return c.json({ ...found, status: derive(found), balance, contact: ct[0] || null, project: pr[0] || null, quote: qt[0] || null, lineItems, payments })
  })

  // ---------------------------------------------------------------- create
  app.post('/', requirePermission('invoices:create'), async (c) => {
    const currentUser = c.get('user') as any
    const raw = await c.req.json()
    const data = invoiceSchema.parse(raw)
    const cid = currentUser.companyId
    const extra = await linkValues(cid, raw)
    if ('error' in extra) return c.json({ error: extra.error }, 404)
    if (!data.contactId) return c.json({ error: 'A client is required to create an invoice.' }, 400)
    if (!(await ownContact(cid, data.contactId))) return c.json({ error: 'That client does not exist.' }, 404)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    if (data.lineItems.length < minLineItems) return c.json({ error: 'Add at least one line item.' }, 400)
    const subtotalRaw = rawSubtotal(data.lineItems)
    if (data.discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
    const settings = await companySettings(cid)
    const taxRate = data.taxRate ?? defaultTaxRateFrom(settings)
    // Due date: what the form sent, else the company's payment terms (Settings → Company). Never null:
    // an invoice with no due date could never become overdue.
    const due = normalizeDateInput(data.dueDate)
    if (due.error) return c.json({ error: `Due date: ${due.error}` }, 400)
    const dueDate = due.value ?? dueDateFromTerms(settings)
    // Issue date defaults to today but is settable, so backdated / migrated invoices can be entered.
    const issue = normalizeDateInput(data.issueDate)
    if (issue.error) return c.json({ error: `Issue date: ${issue.error}` }, 400)
    // a calendar day, like the due date — not the instant the invoice happened to be raised (T14 M17)
    const issueDate = issue.value ?? startOfUtcDay(new Date())
    // A due date before the ISSUE date is always invalid — that is what the old rejectPastDueOnCreate guard
    // meant, but it compared against TODAY, so it wrongly rejected a legitimately overdue/backdated invoice
    // and accepted a genuinely backwards one (whose issue date it had silently stamped to today). Compare the
    // two dates the invoice actually carries. (RV due-date guard.)
    if (dueDate < issueDate) return c.json({ error: 'Due date cannot be before the issue date.' }, 400)

    const { lineItems, ...rest } = data
    const result = await db.transaction((tx: any) => insertInvoice(tx, t, numbering, {
      companyId: cid, contactId: data.contactId!, projectId: rest.projectId, notes: rest.notes, terms: rest.terms,
      dueDate, issueDate, taxRate, discount: data.discount, extra: extra.values,
    }, lineItems))
    emitToCompany(cid, EVENTS.INVOICE_CREATED, result)
    return c.json(result, 201)
  })

  // ---------------------------------------------------------------- update
  app.put('/:id', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const raw = await c.req.json()
    const data = invoiceSchema.partial().parse(raw)
    const extra = await linkValues(cid, raw)
    if ('error' in extra) return c.json({ error: extra.error }, 404)
    const [existing] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).limit(1)
    if (!existing) return c.json({ error: 'Invoice not found' }, 404)
    if (existing.status === 'void') return c.json({ error: 'This invoice is void and can no longer be edited.' }, 400)
    if (existing.status === 'refunded') return c.json({ error: 'This sale was refunded and can no longer be edited. Start a new invoice.' }, 400)
    if (data.contactId && !(await ownContact(cid, data.contactId))) return c.json({ error: 'That client does not exist.' }, 404)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    const due = normalizeDateInput(data.dueDate)
    if (due.error) return c.json({ error: `Due date: ${due.error}` }, 400)
    const issue = normalizeDateInput(data.issueDate)
    if (issue.error) return c.json({ error: `Issue date: ${issue.error}` }, 400)
    // Enforce due >= issue on edit too (PUT skipped the guard). Compare the dates the invoice WILL carry:
    // whichever of issue/due this edit changes, falling back to the stored value.
    const effIssue = issue.value ?? (existing.issueDate ? new Date(existing.issueDate as any) : null)
    const effDue = due.value !== undefined ? due.value : (existing.dueDate ? new Date(existing.dueDate as any) : null)
    if (effDue && effIssue && effDue < effIssue) return c.json({ error: 'Due date cannot be before the issue date.' }, 400)

    // Totals are recomputed whenever anything that feeds them changes — lines, tax rate or discount.
    // (Changing only the tax rate used to leave the stored total at the old rate.)
    const recompute = data.lineItems !== undefined || data.taxRate !== undefined || data.discount !== undefined
    let lines: z.infer<typeof lineItemSchema>[] | undefined = data.lineItems
    if (recompute && !lines) {
      const current = await db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder))
      lines = current.map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }))
    }
    const update: Record<string, any> = { updatedAt: new Date() }
    for (const k of ['contactId', 'projectId', 'notes', 'terms'] as const) if (data[k] !== undefined) update[k] = data[k]
    Object.assign(update, extra.values)
    if (due.value !== undefined) update.dueDate = due.value
    if (issue.value != null) update.issueDate = issue.value
    if (recompute && lines) {
      const taxRate = data.taxRate ?? Number(existing.taxRate)
      const discount = data.discount ?? Number(existing.discount)
      if (lines.length < minLineItems) return c.json({ error: 'Add at least one line item.' }, 400)
      const subtotalRaw = rawSubtotal(lines)
      if (discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
      const retotal = retotalInvoice(existing, lines, taxRate, discount)
      if ('error' in retotal) return c.json({ error: retotal.error }, 400)
      Object.assign(update, retotal.fields)
    }
    const result = await db.transaction(async (tx: any) => {
      const [updated] = await tx.update(t.invoice).set(update).where(eq(t.invoice.id, id)).returning()
      let items: any[]
      if (data.lineItems !== undefined) {
        items = await replaceInvoiceLines(tx, t, id, data.lineItems)
      } else items = await tx.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder))
      return { ...updated, lineItems: items }
    })
    emitToCompany(cid, EVENTS.INVOICE_UPDATED, result)
    return c.json(result)
  })

  // ---------------------------------------------------------------- delete
  app.delete('/:id', requirePermission('invoices:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, currentUser.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Invoice not found' }, 404)
    // Never delete an invoice that has taken money — it destroys the financial record. Void it instead.
    if (Number(existing.amountPaid) > 0 || existing.status === 'paid') return c.json({ error: 'Cannot delete an invoice with payments recorded. Void it instead.' }, 400)
    await db.delete(t.invoice).where(eq(t.invoice.id, id))
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- send
  app.post('/:id/send', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const [found] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).limit(1)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    if (found.status === 'void') return c.json({ error: 'This invoice is void and cannot be sent.' }, 400)
    if (found.status === 'refunded') return c.json({ error: 'This sale was refunded and cannot be sent.' }, 400)
    let recipientEmail: string | null = null
    let contactName = 'there'
    if (found.contactId) {
      const [ct] = await db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1)
      if (ct) { recipientEmail = ct.email || null; contactName = ct.name || contactName }
    }
    if (!recipientEmail) return c.json({ error: 'This invoice has no contact email address to send to. Add an email to the contact first.' }, 400)
    const [co] = await db.select().from(t.company).where(eq(t.company.id, cid)).limit(1)
    const balance = invoiceBalance(found)
    try {
      await sendInvoiceEmail(recipientEmail, {
        invoiceNumber: found.number, companyName: co?.name || 'Your provider', companyEmail: co?.email || '', contactName,
        total: found.total, balance, dueDate: found.dueDate ? new Date(found.dueDate as any).toLocaleDateString() : 'Upon receipt',
      })
    } catch (err: any) {
      // The provider's own reply goes to the log; the screen gets a reason the owner can act on. (T14 L4)
      console.error('[invoices] send failed', { invoice: found.number, to: recipientEmail, error: err?.message })
      return c.json({ error: `Could not send the invoice email. ${mailFailureReason(err)} It was not marked as sent.` }, 502)
    }
    // Sending never rewinds a paid/partial/open invoice to 'sent' — only a draft becomes 'sent'. sentAt is always stamped.
    const status = found.status === 'draft' ? 'sent' : found.status
    const [updated] = await db.update(t.invoice).set({ status, sentAt: new Date(), updatedAt: new Date() }).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).returning()
    emitToCompany(cid, EVENTS.INVOICE_SENT, { id: updated.id, number: updated.number })
    return c.json(updated)
  })

  // ---------------------------------------------------------------- payments
  app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const paymentSchema = z.object({ amount: z.number().positive(), method: z.enum(PAYMENT_METHODS), reference: z.string().optional(), notes: z.string().optional(), tipAmount: z.number().min(0).max(1000).optional() })
    const data = paymentSchema.parse(await c.req.json())
    const amount = round2(data.amount)
    if (amount <= 0) return c.json({ error: 'Payment amount must be at least $0.01' }, 400)
    const tipAmount = tips ? round2(data.tipAmount || 0) : 0
    if (tips && tipAmount > Math.max(amount * 5, 100)) return c.json({ error: `A $${tipAmount.toFixed(2)} tip on a $${amount.toFixed(2)} payment looks wrong — check the amount.` }, 400)

    // The locked, refund-aware write lives in recordInvoicePayment (shared with the Stripe webhook).
    const outcome = await recordInvoicePayment(db, t, tips, { invoiceId: id, companyId: currentUser.companyId, amount, method: data.method, reference: data.reference, notes: data.notes, tipAmount, beforeWrite: deps.options?.onPayment })
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
    emitToCompany(currentUser.companyId, EVENTS.PAYMENT_RECEIVED, { invoiceId: id, invoiceNumber: outcome.row.number, amount, newBalance: outcome.newBalance, status: outcome.newStatus })
    if (outcome.newStatus === 'paid') emitToCompany(currentUser.companyId, EVENTS.INVOICE_PAID, { id, number: outcome.row.number, total: outcome.row.total })
    return c.json(outcome.payment, 201)
  })

  // ---------------------------------------------------------------- void
  // An issued invoice is never deleted: voiding keeps the number and the audit trail and takes it out
  // of outstanding balances. Money that was collected and not refunded blocks a void. Row-locked so a
  // payment landing at the same instant cannot leave a void invoice holding money.
  app.post('/:id/void', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    let outcome: { status: number; body: any } = { status: 500, body: { error: 'Void failed' } }
    await db.transaction(async (tx: any) => {
      const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
      const row = (locked.rows || locked)[0]
      if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }
      if (row.status === 'void') { outcome = { status: 400, body: { error: 'This invoice is already void.' } }; return }
      // A refunded sale is its own terminal state: money genuinely moved (collected, then returned) and the
      // refund ledger records the reversal. Voiding it would refile a real transaction as "never issued" and
      // corrupt the refunded/void counts. Void is for invoices that never kept money — refund is terminal,
      // like it already is for edit / send / payment. (Contractor M24.)
      if (row.status === 'refunded') { outcome = { status: 400, body: { error: 'This sale was refunded — the refund already records the reversal, so it cannot be voided.' } }; return }
      const paid = round2(Number(row.amount_paid) - Number(row.amount_refunded || 0))
      if (paid > 0.005) { outcome = { status: 400, body: { error: `This invoice has $${paid.toFixed(2)} in payments that were not refunded. Refund them first, then void.` } }; return }
      const note = body.reason ? `Voided: ${String(body.reason).slice(0, 500)}` : 'Voided'
      const [updated] = await tx.update(t.invoice).set({ status: 'void', notes: row.notes ? `${row.notes}\n${note}` : note, updatedAt: new Date() }).where(eq(t.invoice.id, id)).returning()
      outcome = { status: 200, body: updated }
    })
    if (outcome.status === 200) emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, outcome.body)
    return c.json(outcome.body, outcome.status as any)
  })

  // ---------------------------------------------------------------- refund
  // A refund is its own ledger event: a negative payment row plus amountRefunded. amountPaid stays gross,
  // so the sale stays paid and a refund never reopens a balance the client must settle again. Only
  // refunding everything collected changes the status (→ 'refunded').
  app.post('/:id/refund', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const refundSchema = z.object({ amount: z.number().positive(), method: z.enum(PAYMENT_METHODS).optional(), reference: z.string().optional(), notes: z.string().optional() })
    const data = refundSchema.parse(await c.req.json())
    const amount = round2(data.amount)
    // The locked write lives in recordInvoiceRefund (shared with the Stripe refund paths).
    const outcome = await recordInvoiceRefund(db, t, { invoiceId: id, companyId: currentUser.companyId, amount, method: data.method, reference: data.reference, notes: data.notes })
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
    emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, outcome.invoice)
    return c.json({ refund: outcome.refund, invoice: outcome.invoice })
  })

  // ---------------------------------------------------------------- credit
  // Lowers what the client owes without returning money (see applyInvoiceCredit). A refund returns money.
  app.post('/:id/credit', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const creditSchema = z.object({
      amount: z.number({ invalid_type_error: 'Credit amount must be a number' }).positive('Credit amount must be more than $0'),
      reason: z.string({ required_error: 'Say why the credit is given' }).trim().min(1, 'Say why the credit is given').max(500, 'Keep the reason under 500 characters'),
    })
    const parsed = creditSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.errors[0]?.message || 'Invalid credit' }, 400)
    const amount = round2(parsed.data.amount)
    if (amount <= 0) return c.json({ error: 'Credit amount must be at least $0.01' }, 400)
    // The authenticated request carries the user's email (auth/middleware.ts), which is what the record names.
    const outcome = await applyInvoiceCredit(db, t, { invoiceId: id, companyId: currentUser.companyId, amount, reason: parsed.data.reason, by: currentUser.email || null })
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
    emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, outcome.invoice)
    return c.json({ invoice: outcome.invoice, balanceBefore: outcome.balanceBefore, balanceAfter: outcome.balanceAfter })
  })

  // ---------------------------------------------------------------- pdf
  app.get('/:id/pdf', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const generateInvoicePDF = await loadPdf()
    const [found] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).limit(1)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    const [ct, lineItems, payments, [co]] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder)),
      db.select().from(t.payment).where(eq(t.payment.invoiceId, id)).orderBy(desc(t.payment.paidAt)),
      db.select().from(t.company).where(eq(t.company.id, cid)),
    ])
    const pdfBuffer = await generateInvoicePDF({ ...found, status: derive(found), contact: ct[0] || null, lineItems, payments }, co)
    return new Response(pdfBuffer, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice-${found.number}.pdf"` } })
  })

  return app
}

export { isOverdue, deriveStatus }
