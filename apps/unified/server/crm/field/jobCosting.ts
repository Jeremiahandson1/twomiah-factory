// /api/job-costing: estimate against actual cost per job, the roll-up, and profitability grouped. Moved from the CRM
// template's routes/jobCosting.ts (templates/crm/backend/src/routes). The registry signs the person in and gates
// 'job_costing'; every action checks reports:read (labour cost and margin are not technician data).
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { createJobCostingService } from './jobCostingService.ts'
import { createQuoteBudget } from '../billing/quoteBudget.ts'
import { round2 } from '@twomiah/tenant-backend'
import { and, eq, notInArray } from 'drizzle-orm'
import { commission, project, user as userTable } from '../../db/schema/index.ts'

/** A number from the query string, or the default when absent or unparseable; capped at `max`. */
const intParam = (raw: string | undefined, fallback: number, max: number) => {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

export function createJobCostingRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const jobCosting = createJobCostingService(d)
  const quoteBudget = createQuoteBudget(d)
  const app = new Hono<AppEnv>()

  /** One job. The service throws 'Job not found' (scoped by company): a 404, not a 500. */
  app.get('/job/:jobId', requirePermission('reports:read'), async (c) => {
    const user = c.get('user')
    try {
      const analysis: any = await jobCosting.getJobCostAnalysis(c.req.param('jobId'), user.companyId)
      // Roofing: who earned what on the job is the pay structure's, so the lines behind the commission cost go only to a seat that
      // reads it (commissions:read); every seat that reads job costing sees the total, which is in the cost and the profit.
      if (d.settings?.roof && analysis.actual?.commissionCost && await canSeeWith(d.permissions)(user.role, 'commissions:read', user.userId)) {
        const rows = await d.db.select().from(commission)
          .where(and(eq(commission.companyId, user.companyId), eq(commission.jobId, analysis.job.id), notInArray(commission.status, ['void', 'cancelled'])))
        const names = new Map<string, string>((await d.db.select({ id: userTable.id, f: userTable.firstName, l: userTable.lastName, e: userTable.email }).from(userTable).where(eq(userTable.companyId, user.companyId)) as any[]).map((u) => [u.id, [u.f, u.l].filter(Boolean).join(' ') || u.e]))
        analysis.commissionDetail = rows.map((r: any) => ({ id: r.id, person: names.get(r.userId) ?? 'Former team member', source: r.source, status: r.status, amount: Number(r.commissionAmount || 0) }))
      }
      return one(c, analysis)
    } catch (e: any) {
      if (/not found/i.test(String(e?.message || ''))) return fail(c, 404, 'Job not found')
      throw e
    }
  })

  /** Many jobs: the same costing rolled up, filterable by date, status and project. */
  app.get('/summary', requirePermission('reports:read'), async (c) => {
    const user = c.get('user')
    return one(c, await jobCosting.getJobCostingSummary(user.companyId, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      status: c.req.query('status'),
      projectId: c.req.query('projectId'),
      limit: intParam(c.req.query('limit'), 50, 500),
    }))
  })

  /**
   * A project's budget by cost code — what its approved quotes say the work should cost (crm/billing/quoteBudget.ts) —
   * beside what its jobs have actually cost so far. No budget (no approved quote on the project) answers `lines: []`.
   */
  app.get('/budget/:projectId', requirePermission('reports:read'), async (c) => {
    const user = c.get('user')
    const projectId = c.req.param('projectId')
    // Its own feature (job_budgets, not ready): off, the route is not there — as the other gated routes answer.
    if (!(await d.features.isFeatureEnabled(user.companyId, 'job_budgets'))) return fail(c, 404, 'Not found')
    const [pr] = await d.db.select({ id: project.id, name: project.name }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, user.companyId))).limit(1)
    if (!pr) return fail(c, 404, 'Project not found')
    const budget = await quoteBudget.budgetFor(user.companyId, projectId)
    const costing = await jobCosting.getJobCostingSummary(user.companyId, { projectId, limit: 500, beforeCommissions: true } as any)
    const actualCost = round2(Number(costing.totals.totalCost || 0))
    return one(c, { ...budget, projectName: pr.name, actualCost, remainingCost: round2(budget.totalCost - actualCost), jobCount: costing.count })
  })

  /** Profitability grouped by month (or technician, or type), filtered by status like /summary (T32 B3). */
  app.get('/by-category', requirePermission('reports:read'), async (c) => {
    const user = c.get('user')
    const rows = await jobCosting.getProfitabilityByCategory(user.companyId, {
      groupBy: c.req.query('groupBy') || 'month',
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      status: c.req.query('status'),
    })
    return listAll(c, rows)
  })

  return app
}
