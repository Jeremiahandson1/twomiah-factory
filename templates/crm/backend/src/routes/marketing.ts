// Email marketing routes — shared implementation (packages/tenant-backend/src/marketing/marketing.ts), vendored into this tenant as ../shared.
import { createMarketingRoutes } from '../shared/index.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import { escapeHtml } from '../utils/sanitize.ts'
import marketing from '../services/marketing.ts'

// Email Marketing switched off in Settings › Features refuses the API too, not just the menu (T15 M5). The
// public tracking / unsubscribe links stay open — the shared routes exempt them.
export default createMarketingRoutes({ service: marketing, authenticate, requirePermission, escapeHtml, featureGate: requireEnabledFeature('email_marketing') })
