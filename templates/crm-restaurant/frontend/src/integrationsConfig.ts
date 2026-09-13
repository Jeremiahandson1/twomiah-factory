// Vertical vocabulary for the shared Settings → Integrations / Import / Migrate and Reviews pages
// (packages/tenant-ui/src/settings, vendored into this tenant as ./shared). Behaviour lives there; only the words live here.
import type { IntegrationsConfig, ImportConfig, MigrationConfig, ReviewsConfig } from './shared'
import { leadSourceGuides } from './shared'
import { leadsConfig } from './leadsConfig'

export const integrationsConfig: IntegrationsConfig = { leadSources: leadSourceGuides(leadsConfig.platforms) }

export const importConfig: ImportConfig = {
    intro: 'Import contacts, events, spaces, menus and more from CSV files',
    types: [
      { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
      { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
      { id: 'jobs', label: 'Jobs', description: 'Import work orders and jobs', feature: 'jobs' },
      { id: 'events', label: 'Events', description: 'Import bookings, enquiries, and confirmed events', feature: 'event_bookings' },
      { id: 'spaces', label: 'Spaces', description: 'Import event spaces and their capacities', feature: 'event_bookings' },
      { id: 'menus', label: 'Menu Packages', description: 'Import per-person menu and catering packages', feature: 'event_bookings' },
      { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
      { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous system or QuickBooks' },
    ],
  }

export const migrationConfig: MigrationConfig = {}

export const reviewsConfig: ReviewsConfig = { subjectLabel: 'Event', subtitle: 'Automate Google review requests after an event or job', autoRequestHelp: 'Automatically request reviews after a completed job', emptyHelp: 'Requests are created automatically when jobs are completed' }
