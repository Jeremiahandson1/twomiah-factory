// /api/margin-reports — per-client margin and caregiver turnover (item 10, finished in row 11; docs/parity/homecare-margin-turnover.md).
// Mounted only for an agency with care_margin_reports (not ready). The calculations are core/margin.ts.
//
//   Every report takes ?startDate&endDate (at most 400 days) and the filters ?clientId&caregiverId&branchId&referralSourceId&payerId,
//   and downloads with ?format=csv or ?format=pdf.
//   GET /client-margin        billed − paid per client (lowest margin first), the totals, and the same grouped by referral source,
//                             payer, department (care type) and branch
//   GET /visit-margin         every paid visit of a day or a month with its own margin
//   GET /trend?by=week|month  billed, cost and margin per week or month (the chart)
//   GET /drill-down           total → branch → team → client
//   GET /compare?compareStart&compareEnd   two windows side by side with the change
//   GET /turnover             hires, departures, headcount, turnover and retention, who left (and why, when the office stored it),
//                             applicant-to-hire, hire-to-first-shift, call-outs and missed visits per caregiver, cost per hire, payroll accuracy
//   GET /filters              the lists the filter boxes show (clients, caregivers, branches, referral sources, payers)
//
// Permissions: client margin shows what caregivers are paid next to what clients are billed, so it needs BOTH
// care-billing:read and care-payroll:read; turnover is about people, so care-hr:read.
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'
import type { MarginFilters } from '../core/margin.ts'
import { marginFilterLists } from '../../../data/homecareReportBuilder.ts'
import { companyBrand } from '../../../data/homecarePlanning.ts'
import { renderClientMargin, renderTurnover, renderVisitMargin } from './reportRenderers.ts'
import { fileReply } from './reportFiles.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 400
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function createMarginReportRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission

  function window(c: Context, today: string, startKey = 'startDate', endKey = 'endDate'): { start: string; end: string } | Response {
    const start = c.req.query(startKey) || addDays(today, -30)
    const end = c.req.query(endKey) || today
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return fail(c, 400, `${startKey} and ${endKey} must be dates (YYYY-MM-DD).`, 'bad_range')
    if (end < start) return fail(c, 400, 'The end date is before the start date.', 'bad_range')
    if (addDays(start, MAX_DAYS) < end) return fail(c, 400, `Pick a window of at most ${MAX_DAYS} days.`, 'range_too_long')
    return { start, end }
  }
  async function range(c: Context, companyId: string): Promise<{ start: string; end: string; today: string; filters: MarginFilters; format: string | null } | Response> {
    const today = await core.time.today(companyId)
    const w = window(c, today)
    if (w instanceof Response) return w
    const format = c.req.query('format') || null
    if (format && format !== 'csv' && format !== 'pdf') return fail(c, 400, 'format must be csv or pdf.', 'bad_format')
    const filters: MarginFilters = {
      clientId: idOrNull(c.req.query('clientId')), caregiverId: idOrNull(c.req.query('caregiverId')), branchId: idOrNull(c.req.query('branchId')),
      referralSourceId: idOrNull(c.req.query('referralSourceId')), payerId: idOrNull(c.req.query('payerId')),
    }
    return { ...w, today, filters, format }
  }
  const agencyName = async (companyId: string) => (await companyBrand(d.db, companyId)).name || 'Home Care Agency'

  app.get('/filters', perm('care-billing:read'), async (c) => {
    const { companyId } = c.get('user')
    return one(c, await marginFilterLists(d.db, companyId))
  })

  app.get('/client-margin', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const report = await core.margin.clientMargin(companyId, r.start, r.end, r.filters)
    if (!r.format) return one(c, report)
    return fileReply(c, await renderClientMargin(report, await agencyName(companyId), r.format as 'csv' | 'pdf'))
  })

  app.get('/visit-margin', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const report = await core.margin.visitMargin(companyId, r.start, r.end, r.filters)
    if (!r.format) return one(c, report)
    return fileReply(c, await renderVisitMargin(report, await agencyName(companyId), r.format as 'csv' | 'pdf'))
  })

  app.get('/trend', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const by = c.req.query('by') === 'week' ? 'week' : 'month'
    return one(c, await core.margin.trend(companyId, r.start, r.end, by, r.filters))
  })

  app.get('/drill-down', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    return one(c, await core.margin.drillDown(companyId, r.start, r.end, r.filters))
  })

  app.get('/compare', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    if (!c.req.query('compareStart') || !c.req.query('compareEnd')) return fail(c, 400, 'compareStart and compareEnd name the second period.', 'bad_range')
    const b = window(c, r.today, 'compareStart', 'compareEnd')
    if (b instanceof Response) return b
    return one(c, await core.margin.compare(companyId, { start: r.start, end: r.end }, b, r.filters))
  })

  app.get('/turnover', perm('care-hr:read'), async (c) => {
    const { companyId } = c.get('user')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const report = await core.margin.turnover(companyId, r.start, r.end, r.today, { branchId: r.filters.branchId })
    if (!r.format) return one(c, report)
    return fileReply(c, await renderTurnover(report, await agencyName(companyId), r.format as 'csv' | 'pdf'))
  })

  return app
}
