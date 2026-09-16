// What this vertical does differently in the shared invoices + quotes pages (see ../shared).
import type { InvoicingConfig } from './shared'

// 'open' = an event's invoice: billed from its first scheduled payment, not yet emailed.
export const INVOICING: InvoicingConfig = { clientLabel: 'Client', projects: false, jobs: false, extraInvoiceStatuses: ['open'], quoteNamePlaceholder: 'e.g. Webb anniversary dinner' }
