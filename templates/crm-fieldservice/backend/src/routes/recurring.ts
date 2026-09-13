// Recurring invoice routes — shared implementation (packages/tenant-backend/src/recurring/recurring.ts), vendored as ../shared.
import { createRecurringRoutes } from '../shared/index.ts'
import service from '../services/recurring.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

export default createRecurringRoutes({ service, authenticate, requirePermission, audit })
