// Vertical vocabulary for the shared Settings → Integrations / Import / Migrate and Reviews pages
// (packages/tenant-ui/src/settings, vendored into this tenant as ./shared). Behaviour lives there; only the words live here.
import type { IntegrationsConfig, ImportConfig, MigrationConfig, ReviewsConfig } from './shared'

export const integrationsConfig: IntegrationsConfig = { copy: { quickbooks: 'Sync invoices, payments and customers with your books.', sms: 'Send service updates and reminders to customers and techs.' } }

export const importConfig: ImportConfig = {
    intro: 'Import customers, units, service jobs and invoices from CSV files',
    types: [
      { id: 'contacts', label: 'Customers', description: 'Import customers, leads and vendors' },
      { id: 'jobs', label: 'Service Jobs', description: 'Import repair orders and service jobs', feature: 'jobs' },
      { id: 'products', label: 'Parts/Services', description: 'Import parts and service items' },
      { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your DMS or QuickBooks' },
    ],
    contactTypes: [{ value: 'customer', label: 'Customer' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }],
    defaultContactType: 'customer',
  }

export const migrationConfig: MigrationConfig = { entityLabels: { contacts: 'Customers', jobs: 'Service Jobs & Repair Orders' } }

export const reviewsConfig: ReviewsConfig = { subjectLabel: 'Service', subtitle: 'Automate Google review requests after a completed service', autoRequestHelp: 'Automatically request reviews after a completed service job', emptyHelp: 'Requests are created automatically when service jobs are completed' }
