// Home dashboard — shared implementation for the jobs-family CRMs (packages/tenant-backend/src/reporting/jobsDashboard),
// vendored into this tenant as ../shared at generation. This file only wires the template's tables in.
import { createJobsDashboardRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, project, job, quote, invoice, lead } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { enabledFeaturesFor } from '../middleware/enabledFeature.ts'

export default createJobsDashboardRoutes({
  db,
  tables: { contact, project, job, quote, invoice, lead },
  authenticate,
  // The New leads tile is the Lead Inbox's count, so it is sent only to a tenant that has the inbox.
  featuresFor: enabledFeaturesFor,
  // Money on this dashboard needs the same right as the Invoices page. dashboard:read is held by
  // every role, so without this a technician saw outstanding balances the Invoices screen refused
  // them. (Field Service T30 HIGH)
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
})
