// Automatic commissions — shared implementation (packages/tenant-backend/src/commissions/commissions.ts), vendored as
// ../shared. When an invoice is paid in full each plan that pays automatically pays its person, once; a full refund takes
// it back. Run straight after money is recorded (routes/invoices.ts, services/stripe.ts) and swept every 5 minutes
// (index.ts), so no door an invoice is paid through is missed.
import { createCommissionEarner } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { commission, commissionPlan, user, job, invoice, company } from '../../db/schema.ts'

const earner = createCommissionEarner({
  db,
  tables: { commission, commissionPlan, user, job, invoice, company },
  // this CRM's invoice has no job column, so an invoice reaches its job through the quote both were raised from
  invoiceJobLink: 'quoteId',
})

export const { earnForInvoice, sweep, startCommissionEarner } = earner
export default earner
