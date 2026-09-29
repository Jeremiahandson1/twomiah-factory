// Invoices — shared implementation (packages/tenant-backend/src/invoicing/invoices.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in;
// behaviour lives in one place for every CRM.
import { createInvoiceRoutes, createAccountBalanceStore } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project, quote, payment, company, clientAccountEntry } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import emailService from '../services/email.ts'
import { salonTimezone } from '../utils/salonDate.ts'

/**
 * The client account-balance ledger (clients/accountBalance.ts), bound to this template's table.
 *
 * Wiring it here is what makes `account_balance` a real payment method and a real refund destination
 * in this vertical. A template that does not pass this gets a clean refusal instead, which is how
 * twelve other CRMs stay exactly as they are.
 */
const accounts = createAccountBalanceStore(clientAccountEntry)

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
  // timeZoneFor: the shop's own clock decides what "today" is on a new invoice. Render runs UTC, so an
  // invoice raised at 19:00 Central was stamped with tomorrow's date and fell due a day late — the same
  // UTC-vs-local fault as T25 N2, in the one place that sweep did not reach. (Salon T27 H1)
  options: {
    tips: true,
    minLineItems: 1,
    timeZoneFor: (companyId: string) => salonTimezone(companyId),
    // A bill with no client on it cannot be paid from a client's account — say so rather than
    // failing on a null. Both of these run inside the invoice's own transaction.
    accountBalance: {
      async spend(tx: any, inv: any, amount: number) {
        const contactId = inv.contact_id ?? inv.contactId
        if (!contactId) return 'This invoice is not attached to a client, so there is no account to take it from.'
        const out = await accounts.spend(tx, {
          companyId: inv.company_id ?? inv.companyId,
          contactId, amount, invoiceId: inv.id,
          reason: `Paid against ${inv.number}`,
        })
        return out.ok ? null : out.error
      },
      async credit(tx: any, inv: any, amount: number) {
        const contactId = inv.contact_id ?? inv.contactId
        if (!contactId) return 'This invoice is not attached to a client, so there is no account to refund it to.'
        await accounts.add(tx, {
          companyId: inv.company_id ?? inv.companyId,
          contactId, amount, source: 'refund_to_account',
          reason: `Refunded from ${inv.number} and kept on account`,
          invoiceId: inv.id,
        })
        return null
      },
      balanceOf: (companyId: string, contactId: string) => accounts.balance(db, companyId, contactId),
    },
  },
})
