// The technician's day — shared implementation (packages/tenant-backend/src/tech/tech.ts), vendored as ../shared.
// The hooks are services/jobHooks.ts, the same ones routes/jobs.ts runs, so a job finished from the phone does
// everything a job finished from the Jobs page does.
import { createTechRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { job, contact, formSubmission, formTemplate } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import jobHooks from '../services/jobHooks.ts'

export default createTechRoutes({
  db,
  tables: { job, contact, formSubmission, formTemplate },
  authenticate,
  requirePermission,
  emitToCompany,
  EVENTS,
  hooks: jobHooks,
  // a contractor's end-of-visit site checklist; crm's job has no equipmentId, so no equipment card
  checklistType: 'site_checklist',
  checklistTitle: 'Site checklist',
})
