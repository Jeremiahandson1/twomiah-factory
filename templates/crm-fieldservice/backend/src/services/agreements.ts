// Service Agreements — shared implementation (packages/tenant-backend/src/agreements/agreements.ts), vendored as ../shared.
import { createAgreementsService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem } from '../../db/schema.ts'
import { listSavedPaymentMethods, chargeInvoiceOffSession } from './stripe.ts'

const service = createAgreementsService({
  db,
  tables: { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem },
  stripe: { listSavedPaymentMethods, chargeInvoiceOffSession },
})

// index.ts imports this named export to start the twice-daily billing worker.
export const startAgreementBillingProcessor = service.startBillingProcessor
export default service
