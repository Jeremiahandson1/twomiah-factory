// Closing a visit creates the sale. (SALON-H4)
//
// Completing an appointment or logging a service record used to leave no financial trail — the desk
// had to hand-build an invoice from a blank form. This creates (once) the invoice for the visit:
// one line for the service at the price charged/quoted, the company's default tax rate, due today,
// status "sent" so it shows as owed and can take a payment immediately. The invoice is linked to the
// appointment so a second completion/record never double-bills.
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, company, bookingSettings } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { emitToCompany, EVENTS } from './socket.ts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function nextInvoiceNumber(companyId: string): Promise<string> {
  // Highest existing number, not the row count — deleting an invoice would otherwise reuse a number.
  const existing = await db.select({ number: invoice.number }).from(invoice).where(eq(invoice.companyId, companyId))
  const maxSeq = existing.reduce((max, r) => {
    const m = String(r.number || '').match(/(\d+)\s*$/)
    return m ? Math.max(max, parseInt(m[1], 10)) : max
  }, 0)
  return `INV-${String(maxSeq + 1).padStart(5, '0')}`
}

export interface VisitSale {
  companyId: string
  contactId: string
  appointmentId?: string | null
  serviceName?: string | null
  price: number
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
    if (linked) return linked
  }

  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, v.companyId)).limit(1)
  // Due at the end of the visit day in the salon's timezone — an in-salon sale is settled at the desk,
  // and 'due today at 00:00' made Reports count it overdue the same afternoon. (SALON-N7)
  const [bs] = await db.select({ timezone: bookingSettings.timezone }).from(bookingSettings).where(eq(bookingSettings.companyId, v.companyId)).limit(1)
  const tz = bs?.timezone || 'America/Chicago'
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const endOfDayUtc = (() => { const asUtc = new Date(`${localDate}T23:59:00Z`); const local = new Date(asUtc.toLocaleString('en-US', { timeZone: tz })); const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' })); return new Date(asUtc.getTime() - (local.getTime() - utc.getTime())) })()
  const rate = Number((co?.settings as any)?.defaultTaxRate)
  const taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0
  const taxAmount = round2(price * (taxRate / 100))
  const total = round2(price + taxAmount)

  const [created] = await db.insert(invoice).values({
    companyId: v.companyId,
    contactId: v.contactId,
    appointmentId: v.appointmentId || null,
    number: await nextInvoiceNumber(v.companyId),
    status: 'open',   // an in-salon sale: owed, never emailed (SALON-N7)
    subtotal: price.toString(),
    taxRate: String(taxRate),
    taxAmount: taxAmount.toString(),
    discount: '0',
    total: total.toString(),
    amountPaid: '0',
    dueDate: endOfDayUtc,
    sentAt: null,
    notes: 'Created from the appointment book',
  } as any).returning()

  await db.insert(invoiceLineItem).values({
    invoiceId: created.id,
    description: v.serviceName || 'Salon service',
    quantity: '1',
    unitPrice: price.toString(),
    total: price.toString(),
    sortOrder: 0,
  } as any)

  emitToCompany(v.companyId, EVENTS.INVOICE_CREATED, created)
  return created
}
