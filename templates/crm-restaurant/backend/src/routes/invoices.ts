// Invoices — shared implementation (packages/tenant-backend/src/invoicing/invoices.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in;
// behaviour lives in one place for every CRM.
import { createInvoiceRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project, quote, payment, company } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import emailService from '../services/email.ts'
import { INVOICE_NUMBERING, syncEventInvoiceDueDate } from '../services/eventLedger.ts'

export default createInvoiceRoutes({
  db,
  tables: { invoice, invoiceLineItem, payment, contact, project, quote, company },
  authenticate,
  requirePermission,
  emitToCompany: (companyId, event, data) => {
    emitToCompany(companyId, event, data)
    // A payment, refund, void or edit on an event's invoice moves its due date to the next installment
    // not yet covered (services/eventLedger.ts). A no-op for invoices that don't belong to an event.
    const invoiceId = event === EVENTS.PAYMENT_RECEIVED ? data?.invoiceId : event === EVENTS.INVOICE_UPDATED ? data?.id : null
    if (invoiceId) void syncEventInvoiceDueDate(invoiceId).catch((err) => console.error('[events] invoice due-date sync failed', err))
  },
  EVENTS,
  sendInvoiceEmail: (to, data) => emailService.sendInvoice(to, data),
  loadPdf: () => import('../services/pdf.ts').then(m => m.generateInvoicePDF),
  // The same numbering constant event invoices are raised with (the shared default, stated once).
  // minLineItems: a hand-raised invoice needs a line — a $0 invoice with nothing on it saved as INV-00052 (T16 L6).
  // Event invoices are raised by the ledger service, not this route, so they are unaffected.
  options: { numbering: INVOICE_NUMBERING, minLineItems: 1 },
})
