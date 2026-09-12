// Jobs — shared implementation (packages/tenant-backend/src/jobs/jobs.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createJobRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { job, project, contact, user, timeEntry, company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { cleanText } from '../utils/sanitize.ts'
import reviews from '../services/reviews.ts'

export default createJobRoutes({
  db,
  tables: { job, project, contact, user, timeEntry },
  authenticate,
  emitToCompany,
  EVENTS,
  cleanText,
  options: {
    // Completing a job schedules a review request when the tenant has the feature on.
    onComplete: async ({ job, companyId }) => {
      const [comp] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
      if (((comp?.enabledFeatures || []) as string[]).includes('review_requests')) reviews.scheduleReviewRequest(job.id).catch((err: any) => console.warn('[Jobs] Review schedule failed:', err?.message))
    },
  },
})
