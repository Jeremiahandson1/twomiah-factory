// WHOSE WORK A SEAT WITHOUT jobs:read-all READS (Jobber's rule for a field seat; withheld per vertical in
// verticals/*/settings.ts). The rule itself is tenant-backend's onJob (jobs/onJob.ts): the jobs the login leads, is any
// assignee on (job_assignee), is the roofing sales rep on, or whose crew it is a member of (crew_login: a roofing crew,
// or a roster crew on the Team page). This file only binds it to the unified tables, for the doors that live here —
// roofing's jobs and crews, a day's route, the route optimiser and the contacts a field seat reaches. The shared jobs and
// tech routes get the same tables (modules/crm.ts) and call onJob directly.
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { onJob } from '@twomiah/tenant-backend'
import { contact, crewLogin, job, jobAssignee, lead, project, quote } from '../db/schema/index.ts'

/** The tables the one rule reads, as the shared routes are given them. */
export const ON_JOB_TABLES = { job, jobAssignee, crewLogin }

/** A condition on `job`: the jobs this login (or roster member) reads as its own. */
export function ownJobsWhere(db: any, userId: string) {
  return onJob(db, ON_JOB_TABLES, String(userId))
}

/**
 * A condition on `contact`: the customers on this login's own jobs — and, for a seat that sells (the contractor's Sales rep), the customers
 * of the quotes it wrote or is the salesperson on and of the enquiries assigned to it (contractor live test 11/07: a rep's Contacts said
 * "No contacts yet" for the customer they were quoting).
 */
export function ownContactsWhere(db: any, userId: string) {
  const me = String(userId)
  return or(
    inArray(contact.id, db.select({ id: job.contactId }).from(job).where(and(ownJobsWhere(db, me), isNotNull(job.contactId)))),
    inArray(contact.id, db.select({ id: quote.contactId }).from(quote).where(and(or(eq(quote.createdById, me), eq(quote.salespersonId, me)), isNotNull(quote.contactId)))),
    inArray(contact.id, db.select({ id: lead.convertedContactId }).from(lead).where(and(eq(lead.assignedToId, me), isNotNull(lead.convertedContactId)))),
    // …and the ones it added itself (re-check 11/08: a contact the rep made never showed in its Contacts or the quote's Client list).
    eq(contact.createdById, me),
  )!
}

/**
 * A condition on `project`: the projects a seat without projects:read-all reads (the contractor's Sales rep — re-check 11/08: "The rep
 * still sees both projects"): the ones it made, the ones its own quotes are on, and the ones its own jobs are on.
 */
export function ownProjectsWhere(db: any, userId: string) {
  const me = String(userId)
  return or(
    eq(project.createdById, me),
    inArray(project.id, db.select({ id: quote.projectId }).from(quote).where(and(or(eq(quote.createdById, me), eq(quote.salespersonId, me)), isNotNull(quote.projectId)))),
    inArray(project.id, db.select({ id: job.projectId }).from(job).where(and(ownJobsWhere(db, me), isNotNull(job.projectId)))),
  )!
}
