// Quotes — shared implementation (packages/tenant-backend/src/invoicing/quotes.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in.
import { createQuoteRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, equipment, site } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { sendSMS } from '../services/sms.ts'

export default createQuoteRoutes({
  db,
  tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, equipment, site },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  loadPdf: () => import('../services/pdf.ts').then(m => m.generateQuotePDF),
  options: {
    extraFields: ['siteId', 'equipmentId', 'customerMessage'],
    hasDeclinedAt: true,
    hasConvertedToJobId: true,
    jobHasSiteAndEquipment: true,
    // Text the customer when a quote goes out (was inline in this route before).
    onSent: async ({ companyId, quote, contact, company }) => {
      if (!contact?.phone) return
      const portalUrl = process.env.CUSTOMER_PORTAL_URL || process.env.FRONTEND_URL || ''
      const msg = `Hi ${contact.name?.split(' ')[0] || 'there'}, ${company?.name || 'we'} just sent you a quote (#${quote.number}) for $${Number(quote.total || 0).toFixed(2)}. View it here: ${portalUrl}/quotes/${quote.id}`
      await sendSMS(companyId, { contactId: contact.id, message: msg })
    },
  },
})
