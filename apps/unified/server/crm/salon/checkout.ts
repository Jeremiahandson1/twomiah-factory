// Closing a visit creates the sale (SALON-H4). Moved from templates/crm-salon/backend/src/services/salonCheckout.ts.
//
// Completing an appointment or logging a service record used to leave no financial trail. This creates (once) the
// invoice for the visit: one line for the service at the price charged or quoted, the company's default tax rate, due
// per the payment terms, status "open" so it shows as owed and can take a payment at once. The invoice is linked to the
// appointment so a second completion never double-bills.
import { and, eq } from 'drizzle-orm'
import { dueDateFromTerms, nextNumber, recordInvoicePayment } from '@twomiah/tenant-backend'
import { invoice, invoiceLineItem, company, booking, payment } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * The note a cancellation leaves on the bill it voided (LYR N5). Two paths have to agree on it exactly: the cancel
 * writes it, and a later re-completion reads it to decide that this void was automatic and can be undone.
 */
export const VOIDED_ON_CANCEL = 'Voided: the appointment it was raised from was cancelled'

export interface VisitSale {
  companyId: string
  contactId: string
  appointmentId?: string | null
  serviceName?: string | null
  price: number
  /** A visit with several services: one bill line each (their prices add up to `price`). Absent: the one line above. */
  lines?: Array<{ description: string; price: number }> | null
  /** Who raised the bill, for the audit row (T58). Optional so a scheduled caller can still be logged. */
  actor?: { userId?: string; id?: string; companyId?: string } | null
}

export type InvoiceRow = typeof invoice.$inferSelect

export function createSalonCheckout(d: CrmDeps) {
  const { db, logger } = d
  const live = d.realtime

  /**
   * One audit row for whatever this module does to a bill (T58). `companyId` is passed as well as the actor:
   * audit_log.company_id is NOT NULL, so a bill raised with no signed-in user would otherwise log nothing.
   */
  async function logInvoice(v: VisitSale, entry: { action: string; entityId: string; entityName?: string | null; changes?: any; metadata?: any }) {
    try {
      await d.audit.log({
        action: entry.action, entity: 'invoice', entityId: entry.entityId, entityName: entry.entityName || undefined,
        changes: entry.changes, metadata: entry.metadata, companyId: v.companyId, req: v.actor ? { user: v.actor } : undefined,
      })
    } catch (e: any) {
      logger.warn('[salonCheckout] invoice not audited', { error: e?.message || String(e) })
    }
  }

  /**
   * The next INV- number for this company, from the one counter every document uses — locked, and only ever forwards
   * (T58k). `exec` takes the surrounding transaction when there is one: reaching for the pooled `db` from inside a
   * transaction waits on a connection that transaction is already holding.
   */
  function nextInvoiceNumber(companyId: string, exec: any = db): Promise<string> {
    return nextNumber(exec, invoice, invoice.number, invoice.companyId, companyId, { prefix: 'INV', pad: 5 })
  }

  /** The bill this visit already has, without raising one (Salon RR8): "I did not raise it" is not "there is none". */
  async function invoiceIdForVisit(companyId: string, appointmentId?: string | null): Promise<string | null> {
    if (!appointmentId) return null
    const [linked] = await db.select({ id: invoice.id }).from(invoice)
      .where(and(eq(invoice.companyId, companyId), eq(invoice.appointmentId, appointmentId))).limit(1)
    return linked?.id || null
  }

  /**
   * What the client already paid online for this visit (a deposit, or the whole price when the service takes it up front: salon parity row 5)
   * goes on its bill as a card payment, once (by the Stripe payment's reference), so the chair never asks for it again.
   */
  async function creditOnlinePayment(companyId: string, appointmentId: string | null | undefined, inv: InvoiceRow): Promise<InvoiceRow> {
    if (!appointmentId) return inv
    const [b] = await db.select().from(booking).where(and(eq(booking.companyId, companyId), eq(booking.appointmentId, appointmentId), eq(booking.depositStatus, 'paid'))).limit(1)
    if (!b || !b.depositAmount || !b.paymentIntentId || Number(b.depositAmount) <= 0) return inv
    const out = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: inv.id, companyId, amount: round2(Number(b.depositAmount)), tipAmount: round2(Number(b.tipAmount || 0)), method: 'card', reference: b.paymentIntentId,
      notes: 'Paid online when booking', paidAt: b.depositPaidAt ?? undefined, allowOverpayment: true, idempotentByReference: true,
    })
    if (!out.ok || out.duplicate) return inv
    live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'invoice' })
    const [fresh] = await db.select().from(invoice).where(eq(invoice.id, inv.id)).limit(1)
    return fresh ?? inv
  }

  /** The invoice for this visit, created if none exists yet. Null when there is nothing to bill (no price). */
  async function ensureInvoiceForVisit(v: VisitSale): Promise<InvoiceRow | null> {
    const inv = await raiseInvoiceForVisit(v)
    return inv ? creditOnlinePayment(v.companyId, v.appointmentId, inv) : inv
  }

  async function raiseInvoiceForVisit(v: VisitSale): Promise<InvoiceRow | null> {
    const price = round2(Number(v.price))
    if (!Number.isFinite(price) || price <= 0) return null

    if (v.appointmentId) {
      const [linked] = await db.select().from(invoice)
        .where(and(eq(invoice.companyId, v.companyId), eq(invoice.appointmentId, v.appointmentId))).limit(1)
      if (linked) {
        // Completing a visit that was cancelled puts its bill back rather than raising a second one. Only a void this
        // code wrote on cancellation is undone — the note is the signature. (LYR N5)
        const note = String(linked.notes || '')
        if (linked.status === 'void' && (note === VOIDED_ON_CANCEL || note.endsWith('\n' + VOIDED_ON_CANCEL))) {
          const back = note === VOIDED_ON_CANCEL ? null : note.slice(0, -(VOIDED_ON_CANCEL.length + 1))
          const [restored] = await db.update(invoice)
            .set({ status: 'open', notes: back, updatedAt: new Date() } as any)
            .where(eq(invoice.id, linked.id)).returning()
          if (restored) {
            live.emitToCompany(v.companyId, live.EVENTS.REFRESH, { entity: 'invoice' })
            await logInvoice(v, {
              action: 'update', entityId: restored.id, entityName: restored.number,
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
    // Due date follows the company's payment terms, like every other invoice.
    const rate = Number((co?.settings as any)?.defaultTaxRate)
    const taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0
    const taxAmount = round2(price * (taxRate / 100))
    const total = round2(price + taxAmount)

    // The read above is not a guard — two clicks 2 ms apart both pass it. `invoice_appointment_unique` is the guard; the
    // loser lands in the catch, re-reads, and hands back the bill the winner raised. (LY0928 H1)
    let created: InvoiceRow
    try {
      ;[created] = await db.transaction(async (tx: any) => tx.insert(invoice).values({
        companyId: v.companyId,
        contactId: v.contactId,
        appointmentId: v.appointmentId || null,
        number: await nextInvoiceNumber(v.companyId, tx),
        status: 'open', // an in-salon sale: owed, never emailed (SALON-N7)
        subtotal: price.toString(),
        taxRate: String(taxRate),
        taxAmount: taxAmount.toString(),
        discount: '0',
        total: total.toString(),
        amountPaid: '0',
        dueDate: dueDateFromTerms(co?.settings as any),
        sentAt: null,
        notes: 'Created from the appointment book',
      } as any).returning())
    } catch (e) {
      if (!v.appointmentId) throw e
      const [winner] = await db.select().from(invoice)
        .where(and(eq(invoice.companyId, v.companyId), eq(invoice.appointmentId, v.appointmentId))).limit(1)
      if (winner) return winner
      throw e
    }

    const lines = (v.lines || []).filter((l) => Number.isFinite(Number(l.price)) && Number(l.price) >= 0)
    await db.insert(invoiceLineItem).values(lines.length > 1
      ? lines.map((l, i) => ({ invoiceId: created.id, description: l.description || 'Salon service', quantity: '1', unitPrice: round2(Number(l.price)).toString(), total: round2(Number(l.price)).toString(), sortOrder: i }))
      : [{ invoiceId: created.id, description: v.serviceName || 'Salon service', quantity: '1', unitPrice: price.toString(), total: price.toString(), sortOrder: 0 }] as any[]) as any

    live.emitToCompany(v.companyId, live.EVENTS.INVOICE_CREATED, created)
    // The sale, in the log, after the line item so the row describes a bill that is whole.
    await logInvoice(v, {
      action: 'create', entityId: created.id, entityName: created.number,
      metadata: {
        total: created.total, service: v.serviceName || 'Salon service', appointmentId: v.appointmentId,
        raisedFrom: v.appointmentId ? 'a completed visit' : 'a service record',
      },
    })
    return created
  }

  return { nextInvoiceNumber, invoiceIdForVisit, ensureInvoiceForVisit }
}

export type SalonCheckout = ReturnType<typeof createSalonCheckout>
