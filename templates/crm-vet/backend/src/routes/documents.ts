// Documents — shared implementation (packages/tenant-backend/src/files/documents.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, storage and audit log in.
import { createDocumentRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { document, documentVersion, project, contact, user, patient } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import storage from '../services/fileUpload.ts'
import logger from '../services/logger.ts'

export default createDocumentRoutes({
  db,
  tables: { document, documentVersion, project, contact, user },
  storage,
  authenticate,
  requirePermission,
  audit: (event, actor, meta) => logger.audit(event, actor.userId, actor.companyId, meta),
  // A clinic files against the animal: an x-ray, a referral letter, a vaccination certificate. Filing it
  // under the owner loses track of which pet it was in a multi-pet household. (Vet T12 M6)
  options: {
    types: ['general', 'consent_form', 'medical_record', 'lab_result', 'photo', 'invoice', 'receipt', 'other'],
    links: { patientId: patient },
  },
})
