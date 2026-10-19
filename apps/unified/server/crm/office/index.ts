// The office: import, export, migration, bulk changes, financing, the vendor portal, the pricebook presenter.
// Moved from templates/crm/backend/src/routes (export, import, bulk, migration, wisetack, financing, vendorPortal,
// pricebookPresent). None was feature-gated in the template's index.ts, and none has a gated screen in its frontend
// (import and migration are Settings pages, admin by role; the rest have no screen), so none is gated here.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createExportRoutes } from './export.ts'
import { createImportRoutes } from './import.ts'
import { createBulkRoutes } from './bulk.ts'
import { createMigrationRoutes } from './migration.ts'
import { createWisetackRoutes } from './wisetack.ts'
import { createFinancingRoutes } from './financing.ts'
import { createVendorPortalRoutes } from './vendorPortal.ts'
import { createPricebookPresentRoutes } from './pricebookPresent.ts'

export function officeMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/export', access: 'user', router: createExportRoutes(d) },
    { path: '/api/import', access: 'user', router: createImportRoutes(d) },
    { path: '/api/bulk', access: 'user', router: createBulkRoutes(d) },
    { path: '/api/migration', access: 'user', router: createMigrationRoutes(d) },
    { path: '/api/financing', access: 'user', feature: 'consumer_financing', router: createFinancingRoutes(d) },
    // Public doors inside: Wisetack's webhook, a vendor's token link, the presenter page. Each router signs people in
    // itself for its other paths.
    { path: '/api/wisetack', access: 'public', feature: 'consumer_financing', router: createWisetackRoutes(d) },
    { path: '/api/vendor-portal', access: 'public', router: createVendorPortalRoutes(d) },
    { path: '/api/pricebook-present', access: 'public', feature: 'pricebook', router: createPricebookPresentRoutes(d) },
  ]
}
