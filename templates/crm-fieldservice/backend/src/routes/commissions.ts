// Commissions routes — shared implementation (packages/tenant-backend/src/commissions/commissions.ts), vendored as ../shared.
import { createCommissionRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { commission, commissionPlan, user, job, invoice } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

export default createCommissionRoutes({
  db,
  tables: { commission, commissionPlan, user, job, invoice },
  authenticate,
  requirePermission,
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
})
