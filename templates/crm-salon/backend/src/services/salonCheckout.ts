// Closing a visit creates the sale. (SALON-H4)
//
// Completing an appointment or logging a service record used to leave no financial trail — the desk
// had to hand-build an invoice from a blank form. This creates (once) the invoice for the visit:
// one line for the service at the price charged/quoted, the company's default tax rate, due per the payment terms,
// status "sent" so it shows as owed and can take a payment immediately. The invoice is linked to the
// appointment so a second completion/record never double-bills.
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { dueDateFromTerms } from '../shared/index.ts'
// One numbering rule for every document in the product — locked, and only ever forwards.
import { nextNumber } from '../shared/invoicing/money.ts'
import { eq, and } from 'drizzle-orm'
import { emitToCompany, EVENTS } from './socket.ts'
import audit from './audit.ts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * One audit row for whatever this module does to a bill. (T58)
 *
 * `companyId` is passed explicitly as well as through the actor: audit_log.company_id is NOT NULL, so
 * a bill raised with no signed-in user would otherwise throw on insert and the entry would be eaten by
 * audit.log's own catch — a logging fix that logs nothing. Never throws, for the same reason the rest
 * of this path does not: a visit must still close if the log hiccups.
 */
async function logInvoice(
  v: VisitSale,
  entry: { action: string; entityId: string; entityName?: string | null; changes?: any; metadata?: any },
): Promise<void> {
  try {
    await audit.log({
      action: entry.action,
      entity: 'invoice',
      entityId: entry.entityId,
      entityName: entry.entityName || undefined,
      changes: entry.changes,
      metadata: entry.metadata,
      companyId: v.companyId,
      req: v.actor ? { user: v.actor } : undefined,
    } as any)
  } catch (e: any) {
    console.warn('[salonCheckout] invoice not audited:', e?.message || e)
  }
}

/**
 * The next INV- number for this company. Exported so every salon invoice comes from one counter.
 * `exec` takes the surrounding transaction when there is one — reaching for the pooled `db` from
 * inside a transaction waits on a connection that transaction is already holding, which deadlocks.
 */
export async function nextInvoiceNumber(companyId: string, exec: any = db): Promise<string> {
  /**
   * THE COMMENT HERE USED TO CLAIM THIS WAS ALREADY SAFE. (T58k)
   *
   * It read: "Highest existing number, not the row count — deleting an invoice would otherwise reuse
   * a number." The first half was true and the conclusion was wrong. Taking the highest EXISTING
   * number reuses one the moment the highest is deleted: delete INV-00072 and -00073 and the next
   * bill is INV-00072 again. Avoiding `count()` only narrows which deletion does it.
   *
   * It now delegates to the shared `nextNumber`, which adds the company's high-water mark on top of
   * the highest existing number, so a number that has been issued once is never issued again. The
   * surrounding transaction is still passed through, both for the deadlock reason above and because
   * that is what keeps nextNumber's advisory lock held until the row lands.
   */
  return nextNumber(exec, invoice, invoice.number, invoice.companyId, companyId, { prefix: 'INV', pad: 5 })
}

/**
 * The note a cancellation leaves on the bill it voided. (LYR N5)
 *
 * Exported because two paths have to agree on it exactly: the cancel writes it, and a later
 * re-completion reads it to decide that this void was automatic and can be undone. A bill someone
 * voided on purpose says something else and is never touched.
 */
export const VOIDED_ON_CANCEL = 'Voided: the appointment it was raised from was cancelled'

export interface VisitSale {
  companyId: string
  contactId: string
  appointmentId?: string | null
  serviceName?: string | null
  price: number
  /**
   * WHO raised the bill, for the audit row. (T58)
   *
   *   "Salon: invoices raised by Log Service are not in the audit log."
   *
   * Every other way an invoice comes into being writes an audit row; this path — the one a stylist
   * actually uses — wrote none, and neither did the appointment book's Complete. The appointment
   * UPDATE was audited, so the log showed a visit closing with no sale beside it, and an invoice that
   * exists with nothing saying where it came from. On a money record that is the one question the log
   * is kept for.
   *
   * The audit lives in here rather than in each caller, because there are two callers and a third
   * would be written without it — the same reason the invoice NUMBER comes from one counter. Optional
   * so an internal or scheduled caller can raise a bill with no signed-in user and still be logged.
   */
  actor?: { userId?: string; id?: string; companyId?: string } | null
}

/**
 * The bill this visit already has, without raising one. (Salon RR8, the tester's observation)
 *
 * Six simultaneous completes produce one invoice — that is the LY0928 H1 guard working — but five of
 * the six answered `invoiceId: null`, because the callers only report the invoice they raised
 * themselves. A screen that completes a visit and then links to the bill has nothing to link to,
 * and the visit did get billed. "I was not the one who raised it" is not "there is no bill".
 */
export async function invoiceIdForVisit(companyId: string, appointmentId?: string | null): Promise<string | null> {
  if (!appointmentId) return null
  const [linked] = await db.select({ id: invoice.id }).from(invoice)
    .where(and(eq(invoice.companyId, companyId), eq(invoice.appointmentId, appointmentId)))
    .limit(1)
  return linked?.id || null
}

/**
 * Returns the invoice for this visit, creating it if none exists yet. Returns null when there is
 * nothing to bill (no price) so callers can treat it as "no sale".
 */
export async function ensureInvoiceForVisit(v: VisitSale): Promise<typeof invoice.$inferSelect | null> {
  const price = round2(Number(v.price))
  if (!Number.isFinite(price) || price <= 0) return null

  if (v.appointmentId) {
    const [linked] = await db.select().from(invoice)
      .where(and(eq(invoice.companyId, v.companyId), eq(invoice.appointmentId, v.appointmentId)))
      .limit(1)
    if (linked) {
      // Completing a visit that was cancelled puts its bill back rather than raising a second one:
      // the appointment already owns an invoice, so a new one cannot be created here anyway, and
      // returning the void row would bill the visit with a bill nothing counts. Only a void this
      // codebase wrote on cancellation is undone — the note is the signature. (LYR N5)
      const note = String(linked.notes || '')
      if (linked.status === 'void' && (note === VOIDED_ON_CANCEL || note.endsWith('\n' + VOIDED_ON_CANCEL))) {
        const back = note === VOIDED_ON_CANCEL ? null : note.slice(0, -(VOIDED_ON_CANCEL.length + 1))
        const [restored] = await db.update(invoice)
          .set({ status: 'open', notes: back, updatedAt: new Date() } as any)
          .where(eq(invoice.id, linked.id)).returning()
        if (restored) {
          emitToCompany(v.companyId, EVENTS.REFRESH, { entity: 'invoice' })
          // A bill coming back from void is a money change and belongs in the log as much as raising
          // one. It had no row either.
          await logInvoice(v, {
            action: 'update',
            entityId: restored.id,
            entityName: restored.number,
            changes: { status: { old: 'void', new: 'open' } },
            metadata: { reason: 'the appointment it was raised from was completed again', appointmentId: v.appointmentId },
          })
          return restored
        }
      }
      return linked
    }
  }

  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, v.companyId)).limit(1)
  // Due date follows the company's payment terms, like every other invoice (an in-chair sale used to be
  // due at 23:59 the same day and showed Overdue at midnight).
  const rate = Number((co?.settings as any)?.defaultTaxRate)
  const taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0
  const taxAmount = round2(price * (taxRate / 100))
  const total = round2(price + taxAmount)

  // The read above is not a guard — two clicks 2 ms apart both pass it, which is how run LY0928 got
  // two invoices numbered INV-00216 against one visit. `invoice_appointment_unique` is the guard; the
  // loser lands here, re-reads, and hands back the bill the winner raised. (LY0928 H1)
  let created: typeof invoice.$inferSelect
  try {
    // One transaction so the number's advisory lock is still held when the row lands. The recovery
    // below is unchanged: a unique-constraint violation still aborts and is still caught, and the
    // loser still re-reads the winner's bill. (T58k)
    ;[created] = await db.transaction(async (tx: any) => tx.insert(invoice).values({
      companyId: v.companyId,
      contactId: v.contactId,
      appointmentId: v.appointmentId || null,
      number: await nextInvoiceNumber(v.companyId, tx),
      status: 'open',   // an in-salon sale: owed, never emailed (SALON-N7)
      subtotal: price.toString(),
      taxRate: String(taxRate),
      taxAmount: taxAmount.toString(),
      discount: '0',
      total: total.toString(),
      amountPaid: '0',
      dueDate: dueDateFromTerms((co?.settings as any)),
      sentAt: null,
      notes: 'Created from the appointment book',
    } as any).returning())
  } catch (e: any) {
    if (!v.appointmentId) throw e
    const [winner] = await db.select().from(invoice)
      .where(and(eq(invoice.companyId, v.companyId), eq(invoice.appointmentId, v.appointmentId))).limit(1)
    if (winner) return winner
    throw e
  }

  await db.insert(invoiceLineItem).values({
    invoiceId: created.id,
    description: v.serviceName || 'Salon service',
    quantity: '1',
    unitPrice: price.toString(),
    total: price.toString(),
    sortOrder: 0,
  } as any)

  emitToCompany(v.companyId, EVENTS.INVOICE_CREATED, created)

  // The sale, in the log. Written after the line item so the audit row describes a bill that is whole.
  await logInvoice(v, {
    action: 'create',
    entityId: created.id,
    entityName: created.number,
    metadata: {
      total: created.total,
      service: v.serviceName || 'Salon service',
      appointmentId: v.appointmentId,
      raisedFrom: v.appointmentId ? 'a completed visit' : 'a service record',
    },
  })

  return created
}
