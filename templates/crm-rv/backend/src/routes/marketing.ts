// Email marketing routes — shared implementation (packages/tenant-backend/src/marketing/marketing.ts), vendored into this tenant as ../shared.
import { createMarketingRoutes } from '../shared/index.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import { escapeHtml } from '../utils/sanitize.ts'
import marketing from '../services/marketing.ts'

// Email Marketing switched off in Settings › Features refuses the API too, not just the menu (T15 M5). The
// public tracking / unsubscribe links stay open — the shared routes exempt them.
// Here the same page is also the Follow-Up product (follow_up_sequences): either switch keeps the follow-up parts open,
// while email campaigns and templates need Email Marketing itself. (RV T19 M6)
export default createMarketingRoutes({
  service: marketing, authenticate, requirePermission, escapeHtml,
  featureGate: requireEnabledFeature(['email_marketing', 'follow_up_sequences']),
  campaignsGate: requireEnabledFeature('email_marketing'),
})
