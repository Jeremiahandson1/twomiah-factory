// What this vertical does differently in the shared invoices + quotes pages (see ../shared).
import type { InvoicingConfig } from './shared'

export const INVOICING: InvoicingConfig = { clientLabel: 'Customer', projects: false, jobs: true, quoteSites: true, quoteEquipment: true, quoteCustomerMessage: true, quoteDecline: true, quickbooks: true, quoteNamePlaceholder: 'e.g. Spring cleanup and mulch' }
