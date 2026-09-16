// Stripe — shared implementation (packages/tenant-backend/src/payments/stripe.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's db + tables in; behaviour lives
// in one place for every CRM.
import { createStripeService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, invoice, payment, company } from '../../db/schema.ts'
import { syncEventInvoiceDueDate } from './eventLedger.ts'

const service = createStripeService({
  db,
  tables: { contact, invoice, payment, company },
  options: {
    // Online bookings land on the job calendar.
    bookingCalendarKind: 'job',
    // If the invoice carries an event's money, move its due date to the next unpaid installment.
    afterInvoicePayment: syncEventInvoiceDueDate,
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
  createConnectAccount,
  createAccountLink,
  getAccountStatus,
  constructWebhookEvent,
  getPublishableKey,
  createBookingDepositIntent,
  createSetupIntent,
  listSavedPaymentMethods,
  chargeInvoiceOffSession,
} = service

export default service
