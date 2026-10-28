// WHO IS ON A JOB — the one rule for "this person's jobs" (2026-10-24: several people per job, and crew scope).
//
// A person's jobs are the ones where they are:
//   - the LEAD: assigned_to_id (a login user) or assigned_to_member_id (a roster-only crew member);
//   - ANY ASSIGNEE: a job_assignee row (the other people on the work);
//   - the SALES REP: assigned_sales_rep_id (roofing's rep, where the job table has the column);
//   - a MEMBER OF THE JOB'S CREW: a crew_login row puts a login on a roofing crew (job.assigned_crew_id) or a roster crew
//     (a team_member that leads the job or is one of its assignees).
// A field seat's own-jobs scope (every /:id door, the list, /today, a re-timed day), the technician's day, the customers
// a field seat reads, the double-booking check, a person's lane on the Schedule and a day's route all ask THIS, so the
// rule cannot differ from one door to the next. Each clause applies only where the caller's tables carry it: a template's
// job table without the join, the rep or the crew columns gets the lead columns alone, as before.
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'

export interface OnJobTables {
  job: any
  /** The other people on a job (job_id + user_id or member_id). */
  jobAssignee?: any
  /** The logins on a crew (user_id + crew_id or team_member_id). */
  crewLogin?: any
}

/**
 * A condition on the job table: `id` (a user's or a roster member's — ids are unique across both) is on the job by any
 * of the four ways above.
 */
export function onJob(db: any, t: OnJobTables, id: string): any {
  const j = t.job
  const conds: any[] = [eq(j.assignedToId, id)]
  if (j.assignedToMemberId) conds.push(eq(j.assignedToMemberId, id))
  if (j.assignedSalesRepId) conds.push(eq(j.assignedSalesRepId, id))
  // The roster crews (team_member rows) this login is on, and the roofing crews.
  const rosterCrews = t.crewLogin
    ? db.select({ id: t.crewLogin.teamMemberId }).from(t.crewLogin).where(and(eq(t.crewLogin.userId, id), isNotNull(t.crewLogin.teamMemberId)))
    : null
  if (t.crewLogin && j.assignedCrewId) {
    conds.push(inArray(j.assignedCrewId, db.select({ id: t.crewLogin.crewId }).from(t.crewLogin).where(and(eq(t.crewLogin.userId, id), isNotNull(t.crewLogin.crewId)))))
  }
  if (rosterCrews && j.assignedToMemberId) conds.push(inArray(j.assignedToMemberId, rosterCrews))
  if (t.jobAssignee) {
    const a = t.jobAssignee
    const who: any[] = [eq(a.userId, id), eq(a.memberId, id)]
    if (rosterCrews) who.push(inArray(a.memberId, rosterCrews))
    conds.push(inArray(j.id, db.select({ jobId: a.jobId }).from(a).where(or(...who))))
  }
  return conds.length === 1 ? conds[0] : or(...conds)!
}

/**
 * WHOSE WORK THIS SEAT READS: everyone's with `jobs:read-all`, else only the jobs they are on (onJob above). Answers the
 * condition to narrow the job table by, or null for all. Not wired (no canSee) → all; a failed check narrows (fails closed).
 * The jobs list, /today, every /:id door AND the home screen's "Jobs today" count ask this one function, so a field seat's
 * tile counts exactly the jobs its list shows.
 */
export async function ownJobScope(
  db: any, t: OnJobTables,
  canSee: ((role: string, permission: string, userId?: string) => Promise<boolean> | boolean) | undefined,
  user: { role?: string; userId?: string } | undefined,
): Promise<any | null> {
  if (!canSee) return null
  const uid = String(user?.userId || '')
  let all = false
  try { all = !!(await canSee(user?.role as string, 'jobs:read-all', user?.userId)) } catch { all = false }
  return all ? null : onJob(db, t, uid)
}
