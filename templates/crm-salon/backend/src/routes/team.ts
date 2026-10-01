// Team roster — shared implementation (packages/tenant-backend/src/team/team.ts), vendored into this tenant as ../shared.
import { createTeamRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { teamMember, user, job, appointment } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

// A stylist holds APPOINTMENTS. The roster module assumed jobs, and salon's job table has no
// assigned_to_member_id, so removing a stylist reported "0 unassigned" while the FK on
// appointment.stylist_member_id took them off the booking anyway. (Salon T27 N14)
export default createTeamRoutes({
  db,
  tables: { teamMember, user, job },
  authenticate,
  requirePermission,
  // What somebody is PAID is withheld from a caller who may not read the pay run. `team:read` is
  // held by viewer, a read-only role, and the roster row carries hourlyRate. (T32 H1)
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
  options: { assignedWork: [{ table: appointment, field: 'stylistMemberId', one: 'appointment', many: 'appointments' }] },
})
