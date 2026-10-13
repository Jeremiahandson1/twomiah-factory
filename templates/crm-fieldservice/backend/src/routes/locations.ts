// Locations routes — shared implementation (packages/tenant-backend/src/locations/locations.ts), vendored as ../shared.
import { createLocationRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { location, user } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createLocationRoutes({ db, tables: { location, user }, authenticate, requirePermission })
