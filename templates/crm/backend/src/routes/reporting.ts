// Reports — shared implementation (packages/tenant-backend/src/reporting), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and middleware in.
import { createReportingRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, payment, job, project, quote, timeEntry, user, contact , teamMember} from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
// So the dashboard does not report on modules this tenant does not have.
import { enabledFeaturesFor } from '../middleware/enabledFeature.ts'

export default createReportingRoutes({
  db,
  tables: { invoice, payment, job, project, quote, timeEntry, user, contact, teamMember },
  authenticate,
  requirePermission,
  options: { featuresFor: enabledFeaturesFor },
})
