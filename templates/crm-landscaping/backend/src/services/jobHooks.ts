// What happens when a job is dispatched, started or completed — ONE definition, run by every door that moves
// a job: routes/jobs.ts (the Jobs page) and routes/tech.ts (the technician's phone). The tech view used to
// write the status itself and skip all of this, so a call finished from the phone never scheduled its review
// request or, under a service agreement, its next visit.
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import smsService from './sms.ts'
import agreementService from './agreements.ts'
import reviews from './reviews.ts'
import type { JobHook } from '../shared/index.ts'

// the customer hears from us as the tech moves through the call
export const onDispatch: JobHook = async ({ job, companyId }) => { smsService.sendJobUpdate(companyId, job.id, 'on_my_way').catch(() => {}) }
export const onStart: JobHook = async ({ job, companyId }) => { smsService.sendJobUpdate(companyId, job.id, 'on_site').catch(() => {}) }

// completing a call under a service agreement schedules the next visit
export const onComplete: JobHook = async ({ job, companyId }) => {
  smsService.sendJobUpdate(companyId, job.id, 'completed').catch(() => {})
  // a completed call schedules a review request when the tenant has Google Reviews on
  const [comp] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  if (((comp?.enabledFeatures || []) as string[]).includes('google_reviews')) reviews.scheduleReviewRequest(job.id).catch((err: any) => console.warn('[Jobs] Review schedule failed:', err?.message))
  // same response shape whether or not a visit was scheduled
  if (!job.serviceAgreementId) return { nextServiceDate: null }
  try {
    const result = await agreementService.generateNextJob(job.serviceAgreementId, companyId)
    return { nextServiceDate: result?.nextServiceDate ?? null }
  } catch (err) {
    // the daily scanner will pick it up
    console.log('Auto-schedule next job skipped:', (err as Error).message)
  }
}

export default { onDispatch, onStart, onComplete }
