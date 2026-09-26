// Warranties — shared implementation (packages/tenant-backend/src/warranties/warranties.ts), vendored as ../shared.
import { createWarrantiesService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import {
  warrantyTemplate, projectWarranty, warrantyClaim, activityLog,
  jobAssignment, job, project, contact,
} from '../../db/schema.ts'

export default createWarrantiesService({
  db,
  tables: { warrantyTemplate, projectWarranty, warrantyClaim, activityLog, jobAssignment, job, project, contact },
})
