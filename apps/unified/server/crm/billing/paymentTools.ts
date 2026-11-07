// Roofing's payment tools for every other trade that bills invoices (contractor parity row 12; docs/parity/contractor-payments.md;
// Buildertrend / JobTread / Jobber Payments). The code is roofing's, written over invoices alone (rows 16–18 of the roofing brief):
//   /api/card-payments     the card surcharge setting (card_surcharge) and the payouts view (payments_overview)
//   /api/invoice-requests  text an invoice now or on a schedule, receipts for every payment (invoice_text_requests)
// and the paid step that cancels a paid invoice's waiting texts and emails its receipts. Roofing mounts its own copy
// (crm/roof/index.ts); here it is every vertical but roofing, so nothing is mounted twice. Each route asks its own switch.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createInvoiceRequestRoutes } from '../roof/invoiceRequests.ts'
import { createCardPaymentRoutes } from '../roof/cardSurcharge.ts'
import { REQUESTS_FEATURE, cancelWhenPaid, sendReceipts } from '../../data/invoiceRequests.ts'
import { invoice as invoiceTable } from '../../db/schema/index.ts'
import { createPaymentPlans } from './paymentPlans.ts'

/** Payment plans and the card / bank choice (row 12), for every vertical: the due date follows the plan after each payment. */
export function paymentPlanMounts(d: CrmDeps): Mount[] {
  const plans = createPaymentPlans(d)
  d.services.onInvoicePaid?.((invoiceId: string) => plans.syncDueDate(invoiceId))
  return [{ path: '/api/invoice-payments', access: 'user', router: plans.routes() }] as Mount[]
}

export function paymentToolMounts(d: CrmDeps): Mount[] {
  if (d.settings?.roof) return []
  d.services.onInvoicePaid?.(async (invoiceId: string) => {
    const { eq } = await import('drizzle-orm')
    const [inv] = await d.db.select({ companyId: invoiceTable.companyId }).from(invoiceTable).where(eq(invoiceTable.id, invoiceId)).limit(1)
    if (!inv || !(await d.features.isFeatureEnabled(inv.companyId, REQUESTS_FEATURE).catch(() => false))) return
    await cancelWhenPaid(d.db, invoiceId)
    await sendReceipts(d.db, (m) => (d.services as any).emailService.sendRaw(m), invoiceId)
  })
  return [
    { path: '/api/invoice-requests', access: 'user', router: createInvoiceRequestRoutes(d) },
    { path: '/api/card-payments', access: 'user', router: createCardPaymentRoutes(d) },
  ] as Mount[]
}
