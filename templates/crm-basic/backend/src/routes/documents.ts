// Documents — shared implementation (packages/tenant-backend/src/files/documents.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, storage and audit log in.
import { createDocumentRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { document, documentVersion, project, contact, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import storage from '../services/fileUpload.ts'
import logger from '../services/logger.ts'

export default createDocumentRoutes({
  db,
  // planMarkup is NOT wired here. Plan markups are annotation layers over construction drawings —
  // the shared module registers /:id/markups only where the table is passed, and field service
  // passing it put a construction endpoint on a vertical that has no drawings to mark up.
  // (Field Service T28 L10)
  tables: { document, documentVersion, project, contact, user },
  storage,
  authenticate,
  requirePermission,
  audit: (event, actor, meta) => logger.audit(event, actor.userId, actor.companyId, meta),
  // Only what this vertical actually files — the API used to keep any string it was sent. (roof T18 D4)
  options: { types: ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'] },
})
