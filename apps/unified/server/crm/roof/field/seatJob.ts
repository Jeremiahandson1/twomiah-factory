// A roofing job as THIS seat may see it: the company's own, and for a Field login only the jobs it is on (assigned, the
// sales rep, or its crew's) — the rule jobs.ts applies to every /:id door (tenant-backend jobs.ts: jobs:read-all sees all
// of them). The material list and the work orders hang off a job, so they answer for a job by the same rule.
import { and, eq } from 'drizzle-orm'
import { job } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { ownJobsWhere } from '../../ownWork.ts'

export function createSeatJob(d: CrmDeps) {
  const canSee = canSeeWith(d.permissions)
  /** The job row, or undefined when it is not this company's or not one this seat is on. A failed check narrows. */
  return async function seatJob(c: any, jobId: string) {
    const u = c.get('user')
    const where = and(eq(job.id, jobId), eq(job.companyId, u.companyId))
    let all = false
    try { all = !!(await canSee(u.role, 'jobs:read-all', u.userId)) } catch { all = false }
    const scoped = all ? where : and(where, ownJobsWhere(d.db, String(u.userId)))
    return (await d.db.select().from(job).where(scoped).limit(1))[0] as any
  }
}
