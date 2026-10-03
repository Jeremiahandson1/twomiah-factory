// Service Agreements routes — shared implementation (packages/tenant-backend/src/agreements/agreements.ts), vendored as ../shared.
import { createAgreementsRoutes } from '../shared/index.ts'
import service from '../services/agreements.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

export default createAgreementsRoutes({
  service, authenticate, requirePermission, recurrence: true,
  // What a contract is WORTH goes only to a caller who may see money. T41 found staff reading
  // "Monthly Revenue $49 / Annual $588" and contract prices off this module on three verticals.
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
})
