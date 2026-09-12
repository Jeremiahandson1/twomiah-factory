// Bearer authentication + role gates — shared implementation (packages/tenant-backend/src/auth/middleware.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's db + user table in.
import { createAuthMiddleware } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'

export const { authenticate, requireRole, requireAdmin, requireManager } = createAuthMiddleware({ db, tables: { user } })

export default authenticate
