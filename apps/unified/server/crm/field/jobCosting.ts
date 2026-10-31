// /api/job-costing: estimate against actual cost per job, the roll-up, and profitability grouped. Moved from the CRM
// template's routes/jobCosting.ts (templates/crm/backend/src/routes). The registry signs the person in and gates
// 'job_costing'; every action checks reports:read (labour cost and margin are not technician data).
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from './jobCostingService.ts'
import { createQuoteBudget } from '../billing/quoteBudget.ts'
import { round2 } from '@twomiah/tenant-backend'
import { and, eq } from 'drizzle-orm'
import { project } from '../../db/schema/index.ts'

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
      return one(c, await jobCosting.getJobCostAnalysis(c.req.param('jobId'), user.companyId))
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
    // With the cost_by_code feature the budget carries actual cost and profit per line; without it, as before.
    if (await d.features.isFeatureEnabled(user.companyId, 'cost_by_code')) return one(c, { ...(await quoteBudget.budgetWithActuals(user.companyId, projectId)), projectName: pr.name, byCode: true })
    const budget = await quoteBudget.budgetFor(user.companyId, projectId)
    const costing = await jobCosting.getJobCostingSummary(user.companyId, { projectId, limit: 500 } as any)
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
