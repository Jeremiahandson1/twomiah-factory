// A job's worksheet approval at /api/job-worksheet (roofing parity row 5; docs/parity/roof-commissions-costing.md #23; the store and the
// rules are ./worksheetApproval.ts). The existing job_costing feature gates it; nothing new is advertised.
//
//   GET  /:jobId           whether approval is required, whether this job's worksheet is approved, by whom and when     reports:read
//   POST /:jobId/approve   sign the worksheet off (the figures seen are kept); commissions that waited for it are made      reports:update
//   POST /:jobId/reopen    take the approval back; commissions already made stay (void one by hand if it was wrong)         reports:update
//
// Approving and reopening are reports:update — the owner and an admin — not the manager who only reads job costing.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { job, jobNote, jobWorksheetApproval } from '../../db/schema/index.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from '../field/jobCostingService.ts'
import { createRoofCommissions } from './commissions.ts'
import { createWorksheetApproval } from './worksheetApproval.ts'

const bodySchema = z.object({ note: z.string().trim().max(500).optional() })
const round2 = (n: number) => Math.round(n * 100) / 100

export function createWorksheetRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const approval = createWorksheetApproval(d)
  const costing = createJobCostingService(d)
  const commissions = createRoofCommissions(d)
  const app = new Hono<AppEnv>()

  const ownJob = async (companyId: string, id: string) =>
    (await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, companyId))).limit(1))[0]
  const note = async (companyId: string, jobId: string, userId: string, body: string) => {
    try { await db.insert(jobNote).values({ companyId, jobId, userId, body, isInternal: true } as any) } catch { /* the note is a courtesy */ }
  }

  app.get('/:jobId', requirePermission('reports:read'), async (c) => {
    const me = c.get('user')
    if (!(await ownJob(me.companyId, c.req.param('jobId')))) return fail(c, 404, 'Job not found')
    return one(c, await approval.stateOf(me.companyId, c.req.param('jobId')))
  })

  app.post('/:jobId/approve', requirePermission('reports:update'), async (c) => {
    const me = c.get('user')
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const row = await ownJob(me.companyId, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    // The figures the approver is signing: the contract invoiced and the cost, before commissions (what a commission is worked out on).
    const { byJob } = await costing.attributeRevenue(me.companyId, [{ id: row.id, quoteId: row.quoteId, projectId: row.projectId }])
    const cost = (await costing.costsByJob(me.companyId, [row.id], { beforeCommissions: true })).get(row.id)
    const revenue = round2(byJob.get(row.id)?.revenue ?? 0), spent = round2(cost?.totalCost ?? 0)
    await db.insert(jobWorksheetApproval).values({
      companyId: me.companyId, jobId: row.id, approvedById: me.userId, revenue: String(revenue), cost: String(spent), profit: String(round2(revenue - spent)),
      note: parsed.data.note || null,
    } as any).onConflictDoNothing()
    await note(me.companyId, row.id, me.userId, `Worksheet approved: ${revenue.toFixed(2)} invoiced, ${spent.toFixed(2)} cost, ${round2(revenue - spent).toFixed(2)} profit before commissions.`)
    // Commissions that waited for the figures to count are made now.
    try { await commissions.earnForJob(me.companyId, row.id) } catch (err) { d.logger?.warn?.('[roof] commission not earned', { error: (err as Error).message }) }
    return one(c, await approval.stateOf(me.companyId, row.id))
  })

  app.post('/:jobId/reopen', requirePermission('reports:update'), async (c) => {
    const me = c.get('user')
    const row = await ownJob(me.companyId, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const gone = await db.delete(jobWorksheetApproval).where(and(eq(jobWorksheetApproval.companyId, me.companyId), eq(jobWorksheetApproval.jobId, row.id))).returning({ id: jobWorksheetApproval.id })
    if (gone.length) await note(me.companyId, row.id, me.userId, 'Worksheet reopened: its figures no longer count until it is approved again.')
    return one(c, await approval.stateOf(me.companyId, row.id))
  })

  return app
}
