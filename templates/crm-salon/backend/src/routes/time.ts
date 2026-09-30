// Time tracking — shared implementation (packages/tenant-backend/src/time/time.ts), vendored into this tenant as ../shared.
// One mount (/api/time) carries hours entries, clock-in/out, the weekly timesheet and approvals.
//
// The salon had a payroll summary that read time_entry and NOTHING anywhere in the product that
// could write one — no clock-in, no entry form, no screen. So /api/payroll/summary was a report on
// a table that was always empty, and a salon could not pay anybody from it. crm, crm-basic,
// crm-fieldservice and crm-landscaping have mounted this module for a long time; the salon did not.
import { createTimeRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { timeEntry, user, job, project, teamMember } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

export default createTimeRoutes({ db, tables: { timeEntry, user, job, project, teamMember }, authenticate, requirePermission, audit })
