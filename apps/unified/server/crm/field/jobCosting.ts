// /api/job-costing: estimate against actual cost per job, the roll-up, and profitability grouped. Moved from the CRM
// template's routes/jobCosting.ts (templates/crm/backend/src/routes). The registry signs the person in and gates
// 'job_costing'; every action checks reports:read (labour cost and margin are not technician data).
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from './jobCostingService.ts'

/** A number from the query string, or the default when absent or unparseable; capped at `max`. */
const intParam = (raw: string | undefined, fallback: number, max: number) => {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

export function createJobCostingRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const jobCosting = createJobCostingService(d)
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

  /** Profitability grouped by month (or technician, or type), filtered by status like /summary (T32 B3). */
  app.get('/by-category', requirePermission('reports:read'), async (c) => {
    const user = c.get('user')
    const rows = await jobCosting.getProfitabilityByCategory(user.companyId, {
      groupBy: c.req.query('groupBy') || 'month',
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      status: c.req.query('status'),
    })
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  return app
}
