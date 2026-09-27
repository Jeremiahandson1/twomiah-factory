// Role → permission matrix + guards — shared implementation (packages/tenant-backend/src/auth/permissions.ts),
// vendored into this tenant as ../shared at generation. This file only wires the template's db + user table in.
//
// This was a 140-line FORK until now: roof kept its own hardcoded ROLE_PERMISSIONS, frozen at whatever
// the matrix looked like when the template was cut. It was a strict SUBSET of the shared one — every
// role's grants were a subset, with nothing roof allowed that the fleet withheld — so adopting the
// shared matrix is purely additive and no role loses a permission it had.
//
// What the fork was missing: submittals, aia-forms, draw-schedules, lien-waivers, equipment, fleet,
// warranties, inventory, agreements, selections, takeoffs, calltracking, reports, settings, payments,
// commissions, locations, sms, ads, marketing and tasks. Those absences are why gating a roof route on
// the real resource name used to refuse everyone but the owner.
//
// Unaffected by this swap, deliberately:
//   · requireAdmin / requireManager live in middleware/auth.ts over their own variadic requireRole
//   · users:read is not a matrix entry in either version — it is a per-user grant the owner hands out
//     (Settings › Users), read from user.extra_permissions, which the shared getExtraPermissions reads
//     with the same logic against the same column
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
})
