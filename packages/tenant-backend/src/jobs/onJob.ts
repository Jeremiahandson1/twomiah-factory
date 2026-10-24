// WHO IS ON A JOB — the one rule for "this person's jobs" (2026-10-24: several people per job).
//
// A job's lead is its assigned_to_id (a login user) or assigned_to_member_id (a roster-only crew member); everyone else
// on the work is a job_assignee row. A person's jobs are the ones they lead OR are on: a crew seat's own-jobs scope, the
// technician's day, the double-booking check, a day's route and the customers a crew seat reads all ask this, so a
// helper on a job is treated as being on it everywhere, not only where someone remembered the second table.
import { eq, or, inArray } from 'drizzle-orm'

export interface OnJobTables { job: any; jobAssignee?: any }

/**
 * A condition on the job table: `id` (a user's or a roster member's — ids are unique across both) leads the job or is
 * on it. Without the join table (a caller that has none) it is the lead columns alone, as before.
 */
export function onJob(db: any, t: OnJobTables, id: string): any {
  const lead = t.job.assignedToMemberId ? or(eq(t.job.assignedToId, id), eq(t.job.assignedToMemberId, id))! : eq(t.job.assignedToId, id)
  if (!t.jobAssignee) return lead
  const theirs = db.select({ jobId: t.jobAssignee.jobId }).from(t.jobAssignee)
    .where(or(eq(t.jobAssignee.userId, id), eq(t.jobAssignee.memberId, id)))
  return or(lead, inArray(t.job.id, theirs))!
}
