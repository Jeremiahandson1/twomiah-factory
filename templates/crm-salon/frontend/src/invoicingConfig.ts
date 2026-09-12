// What this vertical does differently in the shared invoices + quotes pages (see ../shared).
import type { InvoicingConfig } from './shared'

export const INVOICING: InvoicingConfig = { clientLabel: 'Client', projects: false, jobs: false, tips: true, extraInvoiceStatuses: ['open'], quoteNamePlaceholder: 'e.g. Bridal party package' }
