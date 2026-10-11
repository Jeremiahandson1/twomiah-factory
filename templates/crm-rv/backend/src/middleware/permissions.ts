// Role → permission matrix + guards — shared implementation (packages/tenant-backend/src/auth/permissions.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's db + user table in.
import { createPermissions } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'

export const {
  ROLE_HIERARCHY, ROLE_PERMISSIONS, normalizeRole, roleLabel,
  getExtraPermissions, invalidateExtraPermissions,
  hasPermission, getPermissions,
  requirePermission, requireAnyPermission, requireRole, requireOwnership,
} = createPermissions({
  db,
  tables: { user },
  // The floor books test drives, drop-offs and deliveries (routes/scheduleEvents.ts). Those routes asked nothing
  // until T68; granting the floor seat what they now ask keeps its scheduling exactly as it was.
  extraRolePermissions: {
    field: ['schedule:create', 'schedule:update'],
  },
})
