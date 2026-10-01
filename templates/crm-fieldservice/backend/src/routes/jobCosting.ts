/**
 * Job Costing — estimate vs ACTUAL cost, per job and across jobs.
 *
 * `services/jobCosting.ts` has computed this for a long time: labour, materials, expenses and
 * subcontractor cost against invoiced revenue, with the variance between what was quoted and what
 * the job really cost. It was reachable only through `routes/gapFeatures.ts`, which had no feature
 * gate and no permission check — and which called two function names the service does not export
 * (`getJobCostingReport`, `getProfitabilityTrends`), so two of its three endpoints returned 500 in
 * every vertical from the day they were written. Nothing had a UI, so nothing ever noticed.
 *
 * This is that API done properly: the correct function names, an entitlement gate on the mount, and
 * an authorisation check on every handler.
 *
 * WHY `reports:read` RATHER THAN A NEW RESOURCE
 * ---------------------------------------------
 * This is a report, and the matrix already draws exactly the line this data needs: admin holds
 * `reports:*`, manager holds `reports:read`, and field and viewer hold neither. Labour cost and
 * margin per job are not technician data, so the convention that "reads are open" is deliberately
 * NOT applied here — the same way the rest of reporting is read-gated. Adding a `job-costing`
 * resource would have duplicated that line and given the permission vocabulary one more entry to
 * keep in sync for no gain.
 */
import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import jobCosting from '../services/jobCosting.ts'

const app = new Hono()
app.use('*', authenticate)

/** A number from the query string, or the given default when absent or unparseable. */
const intParam = (raw: string | undefined, fallback: number, max: number) => {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

/**
 * One job: estimated vs actual cost, the variance, and the labour/material/expense detail behind it.
 *
 * The service THROWS 'Job not found' rather than returning null, and its lookup is scoped by
 * companyId — so an id belonging to another tenant is indistinguishable from one that does not
 * exist, which is the correct answer to give. Without this catch that case is a 500.
 */
app.get('/job/:jobId', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  try {
    return c.json(await jobCosting.getJobCostAnalysis(c.req.param('jobId'), user.companyId))
  } catch (e: any) {
    if (/not found/i.test(String(e?.message || ''))) return c.json({ error: 'Job not found' }, 404)
    throw e
  }
})

/** Many jobs: the same costing rolled up, filterable by date, status and project. */
app.get('/summary', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  return c.json(await jobCosting.getJobCostingSummary(user.companyId, {
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    status: c.req.query('status'),
    projectId: c.req.query('projectId'),
    limit: intParam(c.req.query('limit'), 50, 500),
  }))
})

/**
 * Profitability grouped by month (or another dimension the service supports).
 *
 * `status` is passed through for the same reason /summary takes it: this table sits directly above
 * the job list on one screen, and when the list was filtered and the table was not, the two
 * described different sets of jobs and neither reconciled with the totals row. (T32 B3)
 */
app.get('/by-category', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  return c.json(await jobCosting.getProfitabilityByCategory(user.companyId, {
    groupBy: c.req.query('groupBy') || 'month',
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    status: c.req.query('status'),
  }))
})

export default app
