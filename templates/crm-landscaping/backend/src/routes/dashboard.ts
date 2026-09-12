// Home dashboard — shared implementation for the jobs-family CRMs (packages/tenant-backend/src/reporting/jobsDashboard),
// vendored into this tenant as ../shared at generation. This file only wires the template's tables in.
import { createJobsDashboardRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, project, job, quote, invoice } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

export default createJobsDashboardRoutes({
  db,
  tables: { contact, project, job, quote, invoice },
  authenticate,
})
