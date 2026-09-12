// Auth routes — shared implementation (packages/tenant-backend/src/auth/auth.ts), vendored into this tenant
// as ../shared at generation. This file only wires the template's tables, middleware and services in.
// Per-route rate limits (/login, /register, /forgot-password) are applied in index.ts.
import { createAuthRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { getPermissions, normalizeRole, hasPermission, ROLE_HIERARCHY } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'

export default createAuthRoutes({
  db,
  tables: { user, company },
  authenticate,
  permissions: { getPermissions, normalizeRole, hasPermission, ROLE_HIERARCHY },
  emailService,
  logger,
  options: {
    vertical: 'landscaping',
  },
})
