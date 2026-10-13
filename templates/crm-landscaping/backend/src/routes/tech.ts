// The technician's day — shared implementation (packages/tenant-backend/src/tech/tech.ts), vendored as ../shared.
// The hooks are services/jobHooks.ts, the same ones routes/jobs.ts runs, so a job finished from the phone does
// everything a job finished from the Jobs page does.
import { createTechRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { job, contact, equipment, formSubmission, formTemplate } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import jobHooks from '../services/jobHooks.ts'

export default createTechRoutes({
  db,
  tables: { job, contact, equipment, formSubmission, formTemplate },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  hooks: jobHooks,
  // a crew's end-of-visit property checklist — this CRM shipped the HVAC one unchanged
  checklistType: 'property_checklist',
  checklistTitle: 'Property checklist',
  legacyChecklistTypes: ['hvac_inspection_checklist'],
})
