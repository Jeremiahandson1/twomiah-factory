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
  /**
   * A CANVASSER CANNOT LOG A DOOR KNOCK, AND THAT IS THE BUG. (T41)
   *
   *   "Canvassers can't log a canvassing session at all."
   *
   * Every other refusal in that finding was correct — a crew does not raise invoices or approve a
   * carrier's decision. This one is not. Door-knocking IS the field rung's job on a roofing crew:
   * they walk a street after a storm, record who answered and what they said, and that record is
   * the whole point of the module. `canvassing:*` sits in the manager's list, so the people doing
   * the work were refused the only thing they were there to do, and the office had to re-key every
   * knock from paper.
   *
   * Narrow on purpose:
   *   canvassing:create   start a session, log a stop, end the session
   *   canvassing:update   correct a stop they just logged — the same latitude the timesheet and the
   *                       expense claim already give this rung
   * NOT canvassing:delete — removing a knock from the record is not a field act, and
   * NOT the script library, which is the shop's pitch. The three /scripts writes were on
   * `canvassing:create` and have moved to `marketing:update` so this grant cannot reach them: a
   * grant that quietly hands over the playbook along with the clipboard is the kind of
   * over-widening this campaign has had to undo twice.
   *
   * A refused real need is worse than a leak — it stops the work. (feedback: a refusal can be the bug)
   */
  extraRolePermissions: {
    field: ['canvassing:create', 'canvassing:update'],
  },
})
