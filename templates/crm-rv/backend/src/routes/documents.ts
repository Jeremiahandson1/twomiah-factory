// Documents — shared implementation (packages/tenant-backend/src/files/documents.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, storage and audit log in.
import { createDocumentRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { document, documentVersion, project, contact, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import storage from '../services/fileUpload.ts'
import logger from '../services/logger.ts'

export default createDocumentRoutes({
  db,
  tables: { document, documentVersion, project, contact, user },
  storage,
  authenticate,
  audit: (event, actor, meta) => logger.audit(event, actor.userId, actor.companyId, meta),
  // Only what this vertical actually files — the API used to keep any string it was sent. (roof T18 D4)
  options: { types: ['general', 'contract', 'title', 'inspection', 'photo', 'invoice', 'receipt', 'other'] },
})
