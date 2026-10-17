// Vertical vocabulary for the shared Settings → Integrations / Import / Migrate and Reviews pages
// (packages/tenant-ui/src/settings, vendored into this tenant as ./shared). Behaviour lives there; only the words live here.
import type { IntegrationsConfig, ImportConfig, MigrationConfig, ReviewsConfig } from './shared'
import { leadSourceGuides } from './shared'
import { leadsConfig } from './leadsConfig'

export const integrationsConfig: IntegrationsConfig = { leadSources: leadSourceGuides(leadsConfig.platforms) }

export const importConfig: ImportConfig = {
    types: [
      { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
      { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
      { id: 'jobs', label: 'Jobs', description: 'Import work orders and jobs', feature: 'jobs' },
      { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
      { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from Jobber, HousecallPro or QuickBooks' },
    ],
  }

export const migrationConfig: MigrationConfig = { entityLabels: { jobs: 'Jobs & Work Orders' } }

export const reviewsConfig: ReviewsConfig = {}
