// /api/margin-reports — per-client margin and caregiver turnover (item 10, docs/parity/homecare-margin-turnover.md).
// Mounted only for an agency with care_margin_reports (not ready). The calculations are core/margin.ts.
//
//   GET /client-margin?startDate&endDate   billed − paid per client (lowest margin first), with the totals
//   GET /turnover?startDate&endDate        hires, departures, headcount, turnover and retention, who left
//
// Permissions: client margin shows what caregivers are paid next to what clients are billed, so it needs BOTH
// care-billing:read and care-payroll:read; turnover is about people, so care-hr:read.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 400

export function createMarginReportRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission

  async function range(c: any, companyId: string): Promise<{ start: string; end: string; today: string } | Response> {
    const today = await core.time.today(companyId)
    const start = c.req.query('startDate') || addDays(today, -30)
    const end = c.req.query('endDate') || today
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return fail(c, 400, 'startDate and endDate must be dates (YYYY-MM-DD).', 'bad_range')
    if (end < start) return fail(c, 400, 'The end date is before the start date.', 'bad_range')
    if (addDays(start, MAX_DAYS) < end) return fail(c, 400, `Pick a window of at most ${MAX_DAYS} days.`, 'range_too_long')
    return { start, end, today }
  }

  app.get('/client-margin', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    return one(c, await core.margin.clientMargin(companyId, r.start, r.end))
  })

  app.get('/turnover', perm('care-hr:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    return one(c, await core.margin.turnover(companyId, r.start, r.end, r.today))
  })

  return app
}
