// Inventory routes — shared implementation (packages/tenant-backend/src/inventory/inventory.ts), vendored as ../shared.
import { createInventoryRoutes } from '../shared/index.ts'
import service from '../services/inventory.ts'
import audit from '../services/audit.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createInventoryRoutes({ service, authenticate, requirePermission, audit })
