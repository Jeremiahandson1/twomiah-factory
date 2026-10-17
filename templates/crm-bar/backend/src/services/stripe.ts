// Stripe — shared implementation (packages/tenant-backend/src/payments/stripe.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's db + tables in; behaviour lives
// in one place for every CRM.
import { createStripeService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, invoice, payment, company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { syncEventInvoiceDueDate } from './eventLedger.ts'
import { bookOnDeposit } from './eventBooking.ts'

const service = createStripeService({
  db,
  tables: { contact, invoice, payment, company },
  options: {
    // Online bookings land on the job calendar.
    bookingCalendarKind: 'job',
    // If the invoice carries an event's money: money arriving online books the date too (an enquiry becomes
    // confirmed; a held room is only logged — the money is already taken), then the due date moves to the
    // next unpaid installment. (T16 M8)
    afterInvoicePayment: async (invoiceId: string) => {
      await db.transaction(async (tx: any) => {
        const [inv] = await tx.select({ companyId: invoice.companyId, eventId: invoice.eventId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
        const refused = inv?.eventId ? await bookOnDeposit(tx, inv.companyId, inv.eventId) : null
        if (refused) console.warn('[events] online deposit on an enquiry whose room is held:', refused)
      })
      await syncEventInvoiceDueDate(invoiceId)
    },
  },
})

export const {
  getOrCreateCustomer,
  updateCustomer,
  createPaymentIntent,
  createPartialPaymentIntent,
  getPaymentIntent,
  createCheckoutSession,
  handleWebhook,
  createPaymentLink,
  createRefund,
  constructWebhookEvent,
  getPublishableKey,
  createBookingDepositIntent,
  createSetupIntent,
  listSavedPaymentMethods,
  chargeInvoiceOffSession,
} = service

export default service
