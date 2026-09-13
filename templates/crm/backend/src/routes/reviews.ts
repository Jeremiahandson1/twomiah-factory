// Google review request routes — shared implementation (packages/tenant-backend/src/integrations/reviews.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createReviewsRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { reviewRequest } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import reviews from '../services/reviews.ts'

export default createReviewsRoutes({ service: reviews, db, tables: { reviewRequest }, authenticate, requireRole, audit })
