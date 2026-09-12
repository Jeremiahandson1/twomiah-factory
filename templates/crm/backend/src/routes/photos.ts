// Photos — shared implementation (packages/tenant-backend/src/files/photos.ts), vendored into this tenant
// as ../shared at generation. Job/project photos, re-encoded and stored in the private bucket; the mobile
// app's photo gallery uses this API. This file only wires the template's tables, storage and audit log in.
import { createPhotoRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { document, user, project, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import storage from '../services/fileUpload.ts'
import logger from '../services/logger.ts'

export default createPhotoRoutes({
  db,
  tables: { document, user, project, job },
  storage,
  authenticate,
  requirePermission,
  audit: (event, actor, meta) => logger.audit(event, actor.userId, actor.companyId, meta),
})
