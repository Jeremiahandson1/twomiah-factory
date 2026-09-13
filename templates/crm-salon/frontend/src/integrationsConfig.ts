// Vertical vocabulary for the shared Settings → Integrations / Import / Migrate and Reviews pages
// (packages/tenant-ui/src/settings, vendored into this tenant as ./shared). Behaviour lives there; only the words live here.
import type { IntegrationsConfig, ImportConfig, MigrationConfig, ReviewsConfig } from './shared'
import { leadSourceGuides } from './shared'
import { leadsConfig } from './leadsConfig'

export const integrationsConfig: IntegrationsConfig = {
  copy: { quickbooks: 'Sync invoices, payments and clients with your books.', sms: 'Send appointment reminders and updates to clients and stylists.', email: 'Send invoices, receipts and reminders by email.' },
  leadSources: leadSourceGuides(leadsConfig.platforms),
}

export const importConfig: ImportConfig = {
    intro: 'Import clients, services and invoices from CSV files',
    types: [
      { id: 'contacts', label: 'Clients', description: 'Import clients, leads and suppliers' },
      { id: 'products', label: 'Products/Services', description: 'Import your service menu and retail products' },
      { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous booking app or QuickBooks' },
    ],
    contactTypes: [{ value: 'client', label: 'Client' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Supplier' }],
  }

export const migrationConfig: MigrationConfig = { entityLabels: { contacts: 'Clients', products: 'Services & Products' } }

export const reviewsConfig: ReviewsConfig = { subtitle: 'Automatically ask clients for a Google review after their visit', subjectLabel: 'Visit', autoRequestHelp: 'Automatically request a review after each completed visit (one per client per month)', emptyHelp: 'Requests are created automatically after completed visits' }
