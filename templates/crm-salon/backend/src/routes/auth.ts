// Auth routes — shared implementation (packages/tenant-backend/src/auth/auth.ts), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables, middleware and services in.
// Per-route rate limits (/login, /register, /forgot-password) are applied in index.ts.
import { createAuthRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { getPermissions, normalizeRole, hasPermission, roleLabel, ROLE_HIERARCHY, getExtraPermissions } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'

export default createAuthRoutes({
  db,
  tables: { user, company },
  authenticate,
  // roleLabel: this vertical's word for a rung, so nothing a person reads says "field" in a salon.
  // getExtraPermissions: so /me answers what this person may actually do — the role plus the grants
  // the owner gave them by name — and not merely what the role allows. (T30 M-R1)
  permissions: { getPermissions, normalizeRole, hasPermission, roleLabel, ROLE_HIERARCHY, getExtraPermissions },
  emailService,
  logger,
  options: {
    vertical: 'salon',
  },
})
