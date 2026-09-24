// Google review requests — shared implementation (packages/tenant-backend/src/integrations/reviews.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createReviewsService, generateGoogleReviewLink, createEmailLogger } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { reviewRequest, company, contact, job, serviceRecord, serviceMenu, emailLog, user } from '../../db/schema.ts'
import logger from './logger.ts'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import email from './email.ts'
import { reportSmsUsage } from './messagingUsage.ts'

/**
 * What a salon review request is about: the VISIT that triggered it.
 *
 * The shared list shows the job a request came from, and a salon request has no job — it is raised when
 * a visit is completed — so the column was blank on every row. There is no stored link between the two,
 * and adding one for a label is not worth a migration: the request is created at completion, so the
 * visit is that client's most recent service at or before it. One query for the whole page. (Salon T30 L2)
 */
async function visitFor(rows: any[]) {
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter(Boolean))] as string[]
  if (!contactIds.length) return rows
  const visits = await db
    .select({ contactId: serviceRecord.contactId, performedAt: serviceRecord.performedAt, name: serviceMenu.name })
    .from(serviceRecord)
    .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .where(inArray(serviceRecord.contactId, contactIds))
    .orderBy(desc(serviceRecord.performedAt))

  return rows.map((r) => {
    if (r.job) return r
    const asked = r.createdAt ? new Date(r.createdAt).getTime() : Date.now()
    // the newest visit that had already happened when the request was raised
    const v = visits.find((x: any) => x.contactId === r.contactId && new Date(x.performedAt).getTime() <= asked + 60_000)
    if (!v) return r
    const day = new Date(v.performedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return { ...r, job: { id: null, title: v.name ? `${v.name} · ${day}` : day } }
  })
}

// The same recorder index.ts gives the email service for send(). Review requests go out through
// sendRaw(), which records nothing by design (campaigns keep their own rows), so without this they were
// invisible to the usage counter. (Salon T30 L1)
const recordEmail = createEmailLogger({ db, tables: { emailLog, company, user }, logger })

const reviews = createReviewsService({ db, tables: { reviewRequest, company, contact, job }, sendRaw: (m) => email.sendRaw(m), recordEmail, usage: { reportSmsUsage }, options: { subjectFor: visitFor } })

export { generateGoogleReviewLink }
export const { getReviewSettings, updateReviewSettings, scheduleReviewRequest, scheduleReviewRequestForVisit, sendReviewRequest, processScheduledRequests, sendFollowUp, markReviewCompleted, getReviewStats, getReviewRequests, startReviewProcessor } = reviews
export default reviews
