// Company settings / features / users — shared implementation (packages/tenant-backend/src/company/company.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's tables and middleware in.
import { createCompanyRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission, invalidateExtraPermissions } from '../middleware/permissions.ts'
import { CRM_TEMPLATE } from '../config/template.ts'

export default createCompanyRoutes({
  db,
  tables: { company, user },
  authenticate,
  requireAdmin,
  requirePermission,
  invalidateExtraPermissions,
  template: CRM_TEMPLATE,
})
