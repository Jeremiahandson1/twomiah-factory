// "This seat's job": the company's job, and — unless the seat reads every job (jobs:read-all) — one of its own (assigned,
// the sales rep, or its crew's: ownWork.ts). The shared jobs rule, for the roof modules that hang off a job (the inspection
// report, the photos and documents shared with the homeowner). A job outside the seat's reach is null, read as 404.
import { and, eq } from 'drizzle-orm'
import { job } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { ownJobsWhere } from '../ownWork.ts'

export function createSeatJob(d: CrmDeps) {
  const { db } = d
  const canSee = canSeeWith(d.permissions)
  return async (c: any, jobId: string) => {
    const u = c.get('user')
    const [row] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, u.companyId))).limit(1)
    if (!row) return null
    let all = false
    try { all = !!(await canSee(u.role, 'jobs:read-all', u.userId)) } catch { all = false }
    if (!all) {
      const [mine] = await db.select({ id: job.id }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, u.companyId), ownJobsWhere(db, String(u.userId)))).limit(1)
      if (!mine) return null
    }
    return row
  }
}
