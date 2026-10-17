// Fleet routes — shared implementation (packages/tenant-backend/src/fleet/fleet.ts), vendored as ../shared.
import { createFleetRoutes } from '../shared/index.ts'
import service from '../services/fleet.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createFleetRoutes({ service, authenticate, requirePermission })
