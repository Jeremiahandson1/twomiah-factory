// Warranties routes — shared implementation (packages/tenant-backend/src/warranties/warranties.ts), vendored as ../shared.
import { createWarrantiesRoutes } from '../shared/index.ts'
import service from '../services/warranties.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createWarrantiesRoutes({ service, authenticate, requirePermission })
