// WHOSE WORK A SEAT WITHOUT jobs:read-all READS (Jobber's rule for a field seat; withheld per vertical in
// verticals/*/settings.ts). The rule itself is tenant-backend's onJob (jobs/onJob.ts): the jobs the login leads, is any
// assignee on (job_assignee), is the roofing sales rep on, or whose crew it is a member of (crew_login: a roofing crew,
// or a roster crew on the Team page). This file only binds it to the unified tables, for the doors that live here —
// roofing's jobs and crews, a day's route, the route optimiser and the contacts a field seat reaches. The shared jobs and
// tech routes get the same tables (modules/crm.ts) and call onJob directly.
import { and, inArray, isNotNull } from 'drizzle-orm'
import { onJob } from '@twomiah/tenant-backend'
import { contact, crewLogin, job, jobAssignee } from '../db/schema/index.ts'

/** The tables the one rule reads, as the shared routes are given them. */
export const ON_JOB_TABLES = { job, jobAssignee, crewLogin }

/** A condition on `job`: the jobs this login (or roster member) reads as its own. */
export function ownJobsWhere(db: any, userId: string) {
  return onJob(db, ON_JOB_TABLES, String(userId))
}

/** A condition on `contact`: the customers on this login's own jobs. */
export function ownContactsWhere(db: any, userId: string) {
  return inArray(contact.id, db.select({ id: job.contactId }).from(job).where(and(ownJobsWhere(db, userId), isNotNull(job.contactId))))
}
