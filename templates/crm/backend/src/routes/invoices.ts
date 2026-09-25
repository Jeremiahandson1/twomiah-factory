// Invoices — shared implementation (packages/tenant-backend/src/invoicing/invoices.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in;
// behaviour lives in one place for every CRM.
import { createInvoiceRoutes, companyTimeZone } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project, quote, payment, company } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import emailService from '../services/email.ts'

export default createInvoiceRoutes({
  db,
  tables: { invoice, invoiceLineItem, payment, contact, project, quote, company },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  sendInvoiceEmail: (to, data) => emailService.sendInvoice(to, data),
  loadPdf: () => import('../services/pdf.ts').then(m => m.generateInvoicePDF),
  // minLineItems: an invoice needs at least one line — the invoice form already requires one, and the API created an empty $0 invoice when called directly (RV T19 L8; landscaping and events had it).
  // timeZoneFor: the business's own clock decides what "today" is, so an invoice or quote raised
  // in the evening is not stamped with tomorrow. Render runs UTC. (Field Service T28 M4)
  options: { timeZoneFor: (companyId: string) => companyTimeZone(db, companyId), minLineItems: 1 },
})
