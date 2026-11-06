// The other people whose commission a roofing job carries (roofing parity row 2; docs/parity/roof-commissions-costing.md #7):
// AccuLynx's additional commissions (office, estimator, canvasser) and management commissions (production manager, sales manager),
// and JobNimbus's several commissions per job. The seller is the job's own sales rep (job.assignedSalesRepId); here are the rest,
// at /api/job-people (feature commission_tracking — an existing id, so nothing new is advertised).
//
//   GET /?jobId=      who holds which role on the job         commissions:read (the pay structure), the seat's own jobs
//   PUT /:jobId       replace the job's people                jobs:dispatch — who is on a job is dispatch, as the sales rep is
//
// A person here is a login of THIS company who is still on the team; any seat can hold a role (the office person is often the
// read-only seat). A row gives no access to the job: it is only who a plan that pays the role pays (./commissions.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { JOB_DISPATCH_PERMISSION, JOB_PERSON_ROLES } from '@twomiah/tenant-backend'
import { jobPerson, user } from '../../db/schema/index.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createRoofCommissions } from './commissions.ts'
import { createSeatJob } from './field/seatJob.ts'

const putSchema = z.object({
  people: z.array(z.object({
    role: z.enum(JOB_PERSON_ROLES as [string, ...string[]], { error: 'Choose a role from the list.' }),
    userId: z.string().min(1, 'Choose who it is.').max(64),
  })).max(60, 'That is too many people on one job.'),
})

export function createJobPeopleRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const seatJob = createSeatJob(d)
  const roofCommissions = createRoofCommissions(d)
  const app = new Hono<AppEnv>()

  async function rowsFor(companyId: string, jobId: string) {
    const rows = await db.select().from(jobPerson).where(and(eq(jobPerson.companyId, companyId), eq(jobPerson.jobId, jobId))).orderBy(asc(jobPerson.createdAt), asc(jobPerson.id))
    const ids = [...new Set(rows.map((r: any) => r.userId))] as string[]
    const people = ids.length
      ? await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, isActive: user.isActive }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids)))
      : []
    const name = new Map((people as any[]).map((p) => [p.id, [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email]))
    return rows.map((r: any) => ({ id: r.id, jobId: r.jobId, userId: r.userId, role: r.role, userName: name.get(r.userId) ?? null }))
  }

  app.get('/', requirePermission('commissions:read'), async (c) => {
    const jobId = c.req.query('jobId')
    if (!jobId) return fail(c, 400, 'Say which job.', 'validation_failed', { jobId: 'Choose a job.' })
    const row = await seatJob(c, jobId)
    if (!row) return fail(c, 404, 'Job not found')
    return listAll(c, await rowsFor(c.get('user').companyId, jobId))
  })

  app.put('/:jobId', requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const me = c.get('user')
    const parsed = putSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const row = await seatJob(c, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const wanted = [...new Map(parsed.data.people.map((p) => [`${p.role}:${p.userId}`, p])).values()]
    const ids = [...new Set(wanted.map((p) => p.userId))]
    if (ids.length) {
      const found = await db.select({ id: user.id, isActive: user.isActive }).from(user).where(and(eq(user.companyId, me.companyId), inArray(user.id, ids)))
      const byId = new Map((found as any[]).map((u) => [u.id, u]))
      // Someone already holding a role may stay on it after they leave the team (their old pay keeps its name); no one new who has left.
      const current = new Set((await db.select({ userId: jobPerson.userId, role: jobPerson.role }).from(jobPerson).where(eq(jobPerson.jobId, row.id))).map((r: any) => `${r.role}:${r.userId}`))
      for (const p of wanted) {
        const u = byId.get(p.userId) as any
        if (!u) return fail(c, 400, 'Someone chosen is not on this account.', 'not_on_account', { people: 'Choose people from the team.' })
        if (u.isActive === false && !current.has(`${p.role}:${p.userId}`)) return fail(c, 400, 'Someone chosen has been switched off. Choose people who are still on the team.', 'inactive', { people: 'Choose people who are still on the team.' })
      }
    }
    await db.transaction(async (tx: any) => {
      await tx.delete(jobPerson).where(and(eq(jobPerson.companyId, me.companyId), eq(jobPerson.jobId, row.id)))
      if (wanted.length) await tx.insert(jobPerson).values(wanted.map((p) => ({ companyId: me.companyId, jobId: row.id, userId: p.userId, role: p.role })) as any)
    })
    // A role filled after the job was paid pays on the next follow-up; a job already paid is followed up now, so the new person
    // is paid at once rather than waiting for the next payment event.
    try { await roofCommissions.earnForJob(me.companyId, row.id) } catch (err) { d.logger?.warn?.('[roof] commission not earned', { error: (err as Error).message }) }
    return listAll(c, await rowsFor(me.companyId, row.id))
  })

  return app
}
