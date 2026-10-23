// The office: import, export, migration, bulk changes, consumer financing's mounts, the vendor portal, the pricebook
// presenter.
// Moved from templates/crm/backend/src/routes (export, import, bulk, migration, wisetack, financing, vendorPortal,
// pricebookPresent). None was feature-gated in the template's index.ts, and none has a gated screen in its frontend
// (import and migration are Settings pages, admin by role; the rest have no screen), so none is gated here.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createExportRoutes } from './export.ts'
import { createImportRoutes } from './import.ts'
import { createBulkRoutes } from './bulk.ts'
import { createMigrationRoutes } from './migration.ts'
import { createFinancingRoutes, createFinancingPublicRoutes } from '../financing/routes.ts'
import { createFinancingService } from '../financing/service.ts'
import { createVendorPortalRoutes } from './vendorPortal.ts'
import { createPricebookPresentRoutes } from './pricebookPresent.ts'
import { createQuickBooksSyncRoutes } from './quickbooksSyncRoutes.ts'

export function officeMounts(d: CrmDeps): Mount[] {
  const financing = createFinancingService(d)
  return [
    { path: '/api/export', access: 'user', router: createExportRoutes(d) },
    { path: '/api/import', access: 'user', router: createImportRoutes(d) },
    { path: '/api/bulk', access: 'user', router: createBulkRoutes(d) },
    { path: '/api/migration', access: 'user', router: createMigrationRoutes(d) },
    // Consumer financing (server/crm/financing; not ready): the office's doors, and the customer's quote or invoice page
    // and the lender's signed webhook. Both answer only for a business with consumer_financing on.
    { path: '/api/financing', access: 'user', feature: 'consumer_financing', router: createFinancingRoutes(d, financing) },
    { path: '/api/financing-public', access: 'public', feature: 'consumer_financing', router: createFinancingPublicRoutes(d, financing) },
    // Public doors inside: a vendor's token link, the presenter page. Each router signs people in itself for its other
    // paths.
    { path: '/api/vendor-portal', access: 'public', feature: 'vendor_portal', router: createVendorPortalRoutes(d) }, // off: the portal and its invite are not there (404)
    { path: '/api/pricebook-present', access: 'public', feature: 'pricebook', router: createPricebookPresentRoutes(d, financing) },
    // QuickBooks' sync log and Sync Now / Retry (the Integrations card), behind the QuickBooks switch.
    { path: '/api/qb-sync', access: 'user', feature: 'quickbooks', router: createQuickBooksSyncRoutes(d, d.services.quickbooksSync) },
  ]
}
