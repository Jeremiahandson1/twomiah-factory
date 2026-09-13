// Two-way SMS routes — shared implementation (packages/tenant-backend/src/integrations/sms.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createSmsRoutes } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import sms from '../services/sms.ts'

export default createSmsRoutes({ service: sms, authenticate, requirePermission, requireAdmin })
