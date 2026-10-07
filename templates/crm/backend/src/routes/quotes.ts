// Quotes — shared implementation (packages/tenant-backend/src/invoicing/quotes.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in.
import { createQuoteRoutes, companyTimeZone } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import emailService from '../services/email.ts'
import audit from '../services/audit.ts'

export default createQuoteRoutes({
  db,
  tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job },
  authenticate,
  // Quote events are named by their NUMBER rather than left to the request floor, which cannot know it. (T58k)
  audit,
  requirePermission,
  emitToCompany,
  EVENTS,
  sendQuoteEmail: (to: string, data: Record<string, unknown>) => emailService.sendQuote(to, data),
  loadPdf: () => import('../services/pdf.ts').then(m => m.generateQuotePDF),
  // timeZoneFor: the business's own clock decides what "today" is, so an invoice or quote raised
  // in the evening is not stamped with tomorrow. Render runs UTC. (Field Service T28 M4)
  options: {
    // quote_line_item carries unit_cost + pricebook_item_id here as of T49, so a line can record
    // what the work costs as well as what it sells for. Without this the shared service refuses to
    // write those columns — deliberately, because writing them where they do not exist fails every
    // quote save.
    hasLineCost: true, timeZoneFor: (companyId: string) => companyTimeZone(db, companyId),},
})
