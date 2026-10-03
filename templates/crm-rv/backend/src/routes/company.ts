// Company settings / features / users — shared implementation (packages/tenant-backend/src/company/company.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's tables and middleware in.
import { createCompanyRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission, invalidateExtraPermissions, roleLabel, requireAnyPermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { CRM_TEMPLATE } from '../config/template.ts'
import { adsConnector } from './ads.ts'

export default createCompanyRoutes({
  db,
  tables: { company, user },
  authenticate,
  requireAdmin,
  requirePermission,
  requireAnyPermission,
  // Who may see the FULL user record (email, last login, extra grants) as opposed to the reduced
  // roster a team:read caller gets. Same convention as the pricebook and jobs modules. (T41)
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
  invalidateExtraPermissions,
  roleLabel,
  template: CRM_TEMPLATE,
  onFeaturesChanged: (features) => adsConnector.onFeaturesChanged(features),
})
