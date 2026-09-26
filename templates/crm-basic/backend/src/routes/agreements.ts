// Service Agreements routes — shared implementation (packages/tenant-backend/src/agreements/agreements.ts), vendored as ../shared.
import { createAgreementsRoutes } from '../shared/index.ts'
import service from '../services/agreements.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createAgreementsRoutes({ service, authenticate, requirePermission, recurrence: true })
