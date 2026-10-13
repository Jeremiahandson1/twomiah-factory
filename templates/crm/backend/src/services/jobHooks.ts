// What happens when a job is completed — ONE definition, run by every door that moves a job: routes/jobs.ts
// (the Jobs page) and routes/tech.ts (the crew member's phone), so finishing a job from either one schedules
// the same review request.
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import reviews from './reviews.ts'
import type { JobHook } from '../shared/index.ts'

// Completing a job schedules a review request when the tenant has the feature on.
export const onComplete: JobHook = async ({ job, companyId }) => {
  const [comp] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  if (((comp?.enabledFeatures || []) as string[]).includes('google_reviews')) reviews.scheduleReviewRequest(job.id).catch((err: any) => console.warn('[Jobs] Review schedule failed:', err?.message))
}

export default { onComplete }
