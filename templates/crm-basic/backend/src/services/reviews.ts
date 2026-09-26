// Google review requests — shared implementation (packages/tenant-backend/src/integrations/reviews.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createReviewsService, generateGoogleReviewLink } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { reviewRequest, company, contact, job } from '../../db/schema.ts'
import email from './email.ts'
import { reportSmsUsage } from './messagingUsage.ts'

const reviews = createReviewsService({ db, tables: { reviewRequest, company, contact, job }, sendRaw: (m) => email.sendRaw(m), usage: { reportSmsUsage } })

export { generateGoogleReviewLink }
export const { getReviewSettings, updateReviewSettings, scheduleReviewRequest, scheduleReviewRequestForVisit, sendReviewRequest, processScheduledRequests, sendFollowUp, markReviewCompleted, getReviewStats, getReviewRequests, startReviewProcessor } = reviews
export default reviews
