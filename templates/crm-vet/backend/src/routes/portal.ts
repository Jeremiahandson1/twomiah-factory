// Customer portal — shared implementation (packages/tenant-backend/src/portal/portal.ts), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables and services in; which sections a visitor
// sees is the frontend's portalConfig.ts.
import { createPortalRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import {
  contact, company, user, quote, quoteLineItem, invoice, invoiceLineItem, payment, message, auditLog, activity,
  project, job, changeOrder, changeOrderLineItem, lienWaiver, rfi, submittal, document, documentShare,
  equipment, serviceAgreement, agreementVisit, formSubmission,
} from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'
import selections from '../services/selections.ts'
import fileService from '../services/fileUpload.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import logger from '../services/logger.ts'

export default createPortalRoutes({
  db,
  tables: {
    contact, company, user, quote, quoteLineItem, invoice, invoiceLineItem, payment, message, auditLog, activity,
    project, job, changeOrder, changeOrderLineItem, lienWaiver, rfi, submittal, document, documentShare,
    equipment, serviceAgreement, agreementVisit, formSubmission,
  },
  authenticate,
  requirePermission,
  sendEmail: (to, template, data) => emailService.send(to, template, data),
  loadInvoicePdf: () => import('../services/pdf.ts').then((m) => m.generateInvoicePDF),
  loadQuotePdf: () => import('../services/pdf.ts').then((m) => m.generateQuotePDF),
  selections,
  fileService,
  emitToCompany,
  EVENTS,
  logger,
  options: {
    // endpoint groups this vertical does not offer its customers
    disable: ['projects', 'changeOrders', 'selections', 'projectFiles', 'collaborators', 'myJobs', 'service'],
  },
})
