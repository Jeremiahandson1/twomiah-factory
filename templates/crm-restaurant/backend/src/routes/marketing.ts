// Email marketing routes — shared implementation (packages/tenant-backend/src/marketing/marketing.ts), vendored into this tenant as ../shared.
import { createMarketingRoutes } from '../shared/index.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { escapeHtml } from '../utils/sanitize.ts'
import marketing from '../services/marketing.ts'

export default createMarketingRoutes({ service: marketing, authenticate, requirePermission, escapeHtml })
