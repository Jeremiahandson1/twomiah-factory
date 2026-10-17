// Service Agreements — shared implementation (packages/tenant-backend/src/agreements/agreements.ts), vendored as ../shared.
import { createAgreementsService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { listSavedPaymentMethods, chargeInvoiceOffSession } from './stripe.ts'
import audit from './audit.ts'
import emailService from './email.ts'

const service = createAgreementsService({
  db,
  tables: { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem, company },
  stripe: { listSavedPaymentMethods, chargeInvoiceOffSession },
  audit, // logs automatic renewals, expiries and renewal notices
  sendRenewalNotice: (to: string, data: Record<string, unknown>) => emailService.send(to, 'agreementRenewalNotice', data),
})

// index.ts imports this named export to start the twice-daily billing worker.
export const startAgreementBillingProcessor = service.startBillingProcessor
export default service
