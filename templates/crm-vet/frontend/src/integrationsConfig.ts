// Vertical vocabulary for the shared Settings → Integrations / Import / Migrate and Reviews pages
// (packages/tenant-ui/src/settings, vendored into this tenant as ./shared). Behaviour lives there; only the words live here.
import type { IntegrationsConfig, ImportConfig, MigrationConfig, ReviewsConfig } from './shared'
import { leadSourceGuides } from './shared'
import { leadsConfig } from './leadsConfig'

export const integrationsConfig: IntegrationsConfig = { leadSources: leadSourceGuides(leadsConfig.platforms), copy: { quickbooks: 'Sync invoices, payments and clients with your books.', sms: 'Send appointment reminders and updates to pet owners and staff.', email: 'Send invoices, receipts and reminders by email.' } }

export const importConfig: ImportConfig = {
    intro: 'Import clients, products and invoices from CSV files',
    types: [
      { id: 'contacts', label: 'Clients', description: 'Import pet owners, leads and vendors' },
      { id: 'products', label: 'Products/Services', description: 'Import services, medications and retail products' },
      { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous practice software or QuickBooks' },
    ],
    contactTypes: [{ value: 'client', label: 'Client' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }],
  }

export const migrationConfig: MigrationConfig = { entityLabels: { contacts: 'Clients & Pet Owners', products: 'Services & Products' } }

export const reviewsConfig: ReviewsConfig = { subtitle: 'Automatically ask pet owners for a Google review after a visit', subjectLabel: 'Visit', autoRequestHelp: 'Automatically request a review after a completed visit', emptyHelp: 'Requests are created automatically after completed visits' }
