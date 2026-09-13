// Team roster — shared implementation (packages/tenant-backend/src/team/team.ts), vendored into this tenant as ../shared.
import { createTeamRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { teamMember, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createTeamRoutes({ db, tables: { teamMember, user }, authenticate, requirePermission })
