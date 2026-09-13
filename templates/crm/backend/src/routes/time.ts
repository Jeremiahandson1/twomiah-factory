// Time tracking — shared implementation (packages/tenant-backend/src/time/time.ts), vendored into this tenant as ../shared.
// One mount (/api/time) now carries hours entries, clock-in/out, the weekly timesheet and approvals.
import { createTimeRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { timeEntry, user, job, project } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

export default createTimeRoutes({ db, tables: { timeEntry, user, job, project }, authenticate, requirePermission, audit })
