// Quotes — shared implementation (packages/tenant-backend/src/invoicing/quotes.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in.
import { createQuoteRoutes, companyTimeZone } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, equipment, site } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { sendSMS } from '../services/sms.ts'
import emailService from '../services/email.ts'
import { money } from '../shared/invoicing/money.ts'

export default createQuoteRoutes({
  db,
  tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, equipment, site },
  authenticate,
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
    hasLineCost: true, timeZoneFor: (companyId: string) => companyTimeZone(db, companyId),
    extraFields: ['siteId', 'equipmentId', 'customerMessage'],
    hasDeclinedAt: true,
    hasConvertedToJobId: true,
    jobHasSiteAndEquipment: true,
    // Text the customer when a quote goes out (was inline in this route before).
    onSent: async ({ companyId, quote, contact, company }) => {
      if (!contact?.phone) return
      const portalUrl = process.env.CUSTOMER_PORTAL_URL || process.env.FRONTEND_URL || ''
      const msg = `Hi ${contact.name?.split(' ')[0] || 'there'}, ${company?.name || 'we'} just sent you a quote (#${quote.number}) for ${money(Number(quote.total || 0))}. View it here: ${portalUrl}/quotes/${quote.id}`
      await sendSMS(companyId, { contactId: contact.id, message: msg })
    },
  },
})
