// What this vertical does differently in the shared invoices + quotes pages (see ./shared).
import type { InvoicingConfig } from './shared'

// A bar invoices guests for private parties (crm-restaurant's events ledger): no jobs, no projects, no
// field-service quote extras. 'open' = a party's invoice: billed from its first scheduled payment, not yet emailed.
export const INVOICING: InvoicingConfig = { clientLabel: 'Guest', projects: false, jobs: false, extraInvoiceStatuses: ['open'], quickbooks: true, quoteNamePlaceholder: 'e.g. Packers party, back room' }
