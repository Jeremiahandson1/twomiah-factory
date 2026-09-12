// Quotes — shared implementation (packages/tenant-backend/src/invoicing/quotes.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in.
import { createQuoteRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

export default createQuoteRoutes({
  db,
  tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  loadPdf: () => import('../services/pdf.ts').then(m => m.generateQuotePDF),
  options: {},
})
