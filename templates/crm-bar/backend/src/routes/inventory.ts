// Inventory routes — shared implementation (packages/tenant-backend/src/inventory/inventory.ts), vendored as ../shared.
import { createInventoryRoutes } from '../shared/index.ts'
import service from '../services/inventory.ts'
import audit from '../services/audit.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

export default createInventoryRoutes({
  service, authenticate, requirePermission, audit,
  // Who may see what the company PAID for a part, as opposed to the stock on the shelf. The quantity,
  // the location and the retail price stay open — a technician needs those to do the work. (T41)
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
})
