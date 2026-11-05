// /api/evv-task-report — was every task assigned to every finished visit done, or skipped with a reason? (care_required_tasks)
//   GET /?from=&to=&clientId=&caregiverId=&onlyGaps=true[&format=csv]   care-clients:update (the office)
// A window of at most 92 days. The same list as JSON (visits, each with its tasks, and a summary) or as a CSV download.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { TASK_REPORT_MAX_DAYS, isRangeOk, reportCsv } from '../core/taskReport.ts'
import { who } from './shared.ts'

export function createTaskReportRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  app.get('/', d.permissions.requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const q = c.req.query()
    const today = await core.time.today(companyId)
    const to = q.to || today
    const from = q.from || to.slice(0, 8) + '01'
    if (!isRangeOk(from, to)) return fail(c, 400, `Pick a start and end date (YYYY-MM-DD), the end not before the start, no more than ${TASK_REPORT_MAX_DAYS} days.`, 'bad_range', { from: 'Check the dates' })
    const r = await core.taskReport.run(companyId, { from, to, clientId: q.clientId || undefined, caregiverId: q.caregiverId || undefined, onlyGaps: q.onlyGaps === 'true' })
    if (q.format === 'csv') {
      return c.body(reportCsv(r.visits, await core.time.timezone(companyId)), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="visit-tasks-${from}-to-${to}.csv"` })
    }
    return one(c, { from, to, ...r })
  })
  return app
}
