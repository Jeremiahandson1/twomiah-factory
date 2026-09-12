// Reports — shared implementation (packages/tenant-backend/src/reporting), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and middleware in.
import { createReportingRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, payment, job, project, quote, timeEntry, user, contact } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createReportingRoutes({
  db,
  tables: { invoice, payment, job, project, quote, timeEntry, user, contact },
  authenticate,
  requirePermission,
})
