// /api/report-builder — the report builder, the dashboards, the daily manager report, the workforce analytics, the caregiver
// performance report and the scheduled report emails (row 12, care_report_builder, not ready; docs/parity/homecare-margin-turnover.md).
// The calculations are core/reportBuilder.ts and core/reportSchedules.ts; the files are planning/reportRenderers.ts.
//
//   builder (care-billing:read to run; care-billing:update to save)     pay fields only for someone with care-payroll:read
//     GET  /fields                      the visit fields, the filter rules, the standard library
//     POST /run { definition, startDate, endDate, format? }              run an unsaved definition (format csv|pdf downloads it)
//     GET  /reports · POST /reports · PUT /reports/:id · DELETE /reports/:id · POST /reports/:id/copy · POST /reports/copy { libraryKey }
//     GET  /reports/:id/run?startDate&endDate&format=
//   dashboards
//     GET  /dashboards/financial?days=      (care-billing:read + care-payroll:read)   GET /dashboards/authorizations  (care-billing:read)
//     GET  /dashboards/caregivers?days=     (care-hr:read)
//     GET  /dashboards/custom · POST · PUT /:id · DELETE /:id (care-billing:update)   GET /dashboards/custom/:id/data   (tiles the reader may see)
//     GET  /tiles                           the tile catalogue
//   reports
//     GET  /daily-manager?date=             (care-billing:read; the money with care-payroll:read)    &format=csv|pdf
//     GET  /workforce?startDate&endDate     (care-hr:read)   &format=       GET /performance?startDate&endDate&caregiverId  (care-hr:read)  &format=
//   scheduled emails (care-billing:update)
//     GET  /schedules · POST · PUT /:id · DELETE /:id · PATCH /:id/active { isActive } · POST /:id/send-now
//     GET  /deliveries                      what was sent      GET /deliveries/:id    the file, for a named recipient (or a manager), while the link is live
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll, done } from '../../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays, isYmd } from '../core/agencyTime.ts'
import { FIELDS, FILTER_OPS, LIBRARY, TILES, MAX_WINDOW_DAYS, checkDefinition, checkTiles } from '../core/reportBuilder.ts'
import { REPORT_KINDS, checkSchedule } from '../core/reportSchedules.ts'
import { companyBrand } from '../../../data/homecarePlanning.ts'
import { fileReply } from './reportFiles.ts'
import { renderDailyManager, renderPerformance, renderSavedReport, renderWorkforce, type Format } from './reportRenderers.ts'

export function createReportBuilderRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const rb = core.reportBuilder, rs = core.reportSchedules
  const agencyName = async (companyId: string) => (await companyBrand(d.db, companyId)).name || 'Home Care Agency'
  const canSee = canSeeWith(d.permissions)
  /** What this reader holds, so a dashboard tile or a pay column they may not see is withheld, never an error. */
  const may = async (c: Context<AppEnv>) => {
    const u = c.get('user') as any
    const has = (p: string) => canSee(String(u.role), p, u.userId || u.id)
    return { billing: await has('care-billing:read'), payroll: await has('care-payroll:read'), hr: await has('care-hr:read'), manage: await has('care-billing:update') }
  }
  const me = (c: Context<AppEnv>) => { const u = c.get('user') as any; return { companyId: String(u.companyId), userId: String(u.userId || u.id) } }
  async function range(c: Context<AppEnv>, companyId: string, defaultDays = 30): Promise<{ start: string; end: string; today: string } | Response> {
    const today = await core.time.today(companyId)
    const q = (k: string) => c.req.query(k) || (c as any).__body?.[k]
    const start = q('startDate') || addDays(today, -(defaultDays - 1)), end = q('endDate') || today
    if (!isYmd(start) || !isYmd(end)) return fail(c, 400, 'startDate and endDate must be dates (YYYY-MM-DD).', 'bad_range')
    if (end < start) return fail(c, 400, 'The end date is before the start date.', 'bad_range')
    if (addDays(start, MAX_WINDOW_DAYS) < end) return fail(c, 400, `Pick a window of at most ${MAX_WINDOW_DAYS} days.`, 'range_too_long')
    return { start, end, today }
  }
  const formatOf = (c: Context, v?: unknown): Format | null | Response => {
    const f = (v ?? c.req.query('format')) as string | undefined
    if (!f) return null
    if (f !== 'csv' && f !== 'pdf') return fail(c, 400, 'format must be csv or pdf.', 'bad_format')
    return f
  }
  const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as any

  // ── builder ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/fields', perm('care-billing:read'), async (c) => {
    const m = await may(c)
    return one(c, { fields: FIELDS.filter((f) => m.payroll || !f.payroll), rules: FILTER_OPS, library: LIBRARY.map(({ key, name, description, columns, filters, sortBy, sortDir, groupBy }) => ({ key, name, description, columns, filters, sortBy, sortDir, groupBy })) })
  })
  app.post('/run', perm('care-billing:read'), async (c) => {
    const { companyId } = me(c)
    const b = await body(c)
    ;(c as any).__body = b
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const checked = checkDefinition(b.definition ?? b)
    if ('problem' in checked) return fail(c, 400, checked.problem, 'bad_definition', checked.fields)
    const m = await may(c)
    const run = await rb.run(companyId, checked.def, r.start, r.end, m.payroll)
    const f = formatOf(c, b.format)
    if (f instanceof Response) return f
    if (!f) return one(c, { ...run, definition: checked.def })
    return fileReply(c, await renderSavedReport(run, checked.def.name, await agencyName(companyId), f))
  })
  app.get('/reports', perm('care-billing:read'), async (c) => listAll(c, await rb.list(me(c).companyId)))
  app.post('/reports', perm('care-billing:update'), async (c) => {
    const { companyId, userId } = me(c)
    const checked = checkDefinition(await body(c))
    if ('problem' in checked) return fail(c, 400, checked.problem, 'bad_definition', checked.fields)
    return one(c, await rb.save(companyId, userId, checked.def), 201)
  })
  app.post('/reports/copy', perm('care-billing:update'), async (c) => {
    const { companyId, userId } = me(c)
    const b = await body(c)
    const row = await rb.copy(companyId, userId, { libraryKey: b.libraryKey ? String(b.libraryKey) : undefined, id: b.id ? String(b.id) : undefined })
    if (!row) return fail(c, 404, 'Nothing to copy by that name.', 'not_found')
    return one(c, row, 201)
  })
  app.post('/reports/:id/copy', perm('care-billing:update'), async (c) => {
    const { companyId, userId } = me(c)
    const row = await rb.copy(companyId, userId, { id: c.req.param('id') })
    if (!row) return fail(c, 404, 'That report does not exist.', 'not_found')
    return one(c, row, 201)
  })
  app.put('/reports/:id', perm('care-billing:update'), async (c) => {
    const checked = checkDefinition(await body(c))
    if ('problem' in checked) return fail(c, 400, checked.problem, 'bad_definition', checked.fields)
    const row = await rb.update(me(c).companyId, c.req.param('id'), checked.def)
    if (!row) return fail(c, 404, 'That report does not exist.', 'not_found')
    return one(c, row)
  })
  app.delete('/reports/:id', perm('care-billing:update'), async (c) => { await rb.remove(me(c).companyId, c.req.param('id')); return done(c) })
  app.get('/reports/:id/run', perm('care-billing:read'), async (c) => {
    const { companyId } = me(c)
    const def = await rb.get(companyId, c.req.param('id'))
    if (!def) return fail(c, 404, 'That report does not exist.', 'not_found')
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const m = await may(c)
    const run = await rb.run(companyId, rb.asDefinition(def), r.start, r.end, m.payroll)
    const f = formatOf(c)
    if (f instanceof Response) return f
    if (!f) return one(c, { ...run, definition: rb.asDefinition(def), reportId: def.id })
    return fileReply(c, await renderSavedReport(run, def.name, await agencyName(companyId), f))
  })

  // ── dashboards ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const days = (c: Context) => Math.min(MAX_WINDOW_DAYS, Math.max(1, Number(c.req.query('days')) || 30))
  app.get('/tiles', perm('care-billing:read'), async (c) => one(c, { tiles: TILES }))
  app.get('/dashboards/financial', perm('care-billing:read'), perm('care-payroll:read'), async (c) => {
    const { companyId } = me(c)
    return one(c, await rb.financialDashboard(companyId, await core.time.today(companyId), days(c)))
  })
  app.get('/dashboards/authorizations', perm('care-billing:read'), async (c) => {
    const { companyId } = me(c)
    return one(c, await rb.authorizationDashboard(companyId, await core.time.today(companyId)))
  })
  app.get('/dashboards/caregivers', perm('care-hr:read'), async (c) => {
    const { companyId } = me(c)
    return one(c, await rb.caregiverDashboard(companyId, await core.time.today(companyId), days(c)))
  })
  app.get('/dashboards/custom', perm('care-billing:read'), async (c) => listAll(c, await rb.dashboards(me(c).companyId)))
  const saveDash = async (c: Context<AppEnv>, id?: string) => {
    const { companyId, userId } = me(c)
    const b = await body(c)
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
    if (!name) return fail(c, 400, 'Give the dashboard a name.', 'bad_dashboard', { name: 'Name it' })
    const tiles = checkTiles(b.tiles)
    if ('problem' in tiles) return fail(c, 400, tiles.problem, 'bad_dashboard', { tiles: tiles.problem })
    const row = await rb.saveDashboard(companyId, userId, name, tiles.tiles, id)
    if (!row) return fail(c, 404, 'That dashboard does not exist.', 'not_found')
    return one(c, row, id ? 200 : 201)
  }
  app.post('/dashboards/custom', perm('care-billing:update'), (c) => saveDash(c))
  app.put('/dashboards/custom/:id', perm('care-billing:update'), (c) => saveDash(c, c.req.param('id')))
  app.delete('/dashboards/custom/:id', perm('care-billing:update'), async (c) => { await rb.removeDashboard(me(c).companyId, c.req.param('id')); return done(c) })
  app.get('/dashboards/custom/:id/data', perm('care-billing:read'), async (c) => {
    const { companyId } = me(c)
    const dash = await rb.dashboard(companyId, c.req.param('id'))
    if (!dash) return fail(c, 404, 'That dashboard does not exist.', 'not_found')
    const today = await core.time.today(companyId)
    const m = await may(c)
    const tiles = []
    for (const t of dash.tiles as any[]) tiles.push(await rb.tile(companyId, today, t, m))
    return one(c, { id: dash.id, name: dash.name, today, tiles })
  })

  // ── the reports ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/daily-manager', perm('care-billing:read'), async (c) => {
    const { companyId } = me(c)
    const today = await core.time.today(companyId)
    const date = c.req.query('date') || today
    if (!isYmd(date)) return fail(c, 400, 'date must be a date (YYYY-MM-DD).', 'bad_range')
    const m = await may(c)
    const report = await rb.dailyManager(companyId, date, { money: m.payroll })
    const f = formatOf(c)
    if (f instanceof Response) return f
    if (!f) return one(c, report)
    return fileReply(c, await renderDailyManager(report, await agencyName(companyId), f))
  })
  app.get('/workforce', perm('care-hr:read'), async (c) => {
    const { companyId } = me(c)
    const r = await range(c, companyId, 28)
    if (r instanceof Response) return r
    const report = await rb.workforce(companyId, r.start, r.end)
    const f = formatOf(c)
    if (f instanceof Response) return f
    if (!f) return one(c, report)
    return fileReply(c, await renderWorkforce(report, await agencyName(companyId), f))
  })
  app.get('/performance', perm('care-hr:read'), async (c) => {
    const { companyId } = me(c)
    const r = await range(c, companyId)
    if (r instanceof Response) return r
    const report = await rb.performance(companyId, r.start, r.end, { caregiverId: c.req.query('caregiverId') || null })
    const f = formatOf(c)
    if (f instanceof Response) return f
    if (!f) return one(c, report)
    return fileReply(c, await renderPerformance(report, await agencyName(companyId), f))
  })

  // ── scheduled report emails ──────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/schedules', perm('care-billing:update'), async (c) => one(c, { kinds: REPORT_KINDS, schedules: await rs.list(me(c).companyId) }))
  const saveSchedule = async (c: Context<AppEnv>, id?: string) => {
    const { companyId, userId } = me(c)
    const checked = checkSchedule(await body(c))
    if ('problem' in checked) return fail(c, 400, checked.problem, 'bad_schedule', checked.fields)
    const r = await rs.save(companyId, userId, checked.input, id)
    if ('problem' in r) return fail(c, 400, r.problem, 'bad_schedule', r.fields)
    return one(c, r.schedule, id ? 200 : 201)
  }
  app.post('/schedules', perm('care-billing:update'), (c) => saveSchedule(c))
  app.put('/schedules/:id', perm('care-billing:update'), (c) => saveSchedule(c, c.req.param('id')))
  app.patch('/schedules/:id/active', perm('care-billing:update'), async (c) => {
    const b = await body(c)
    const row = await rs.setActive(me(c).companyId, c.req.param('id'), b.isActive === true)
    if (!row) return fail(c, 404, 'That schedule does not exist.', 'not_found')
    return one(c, row)
  })
  app.delete('/schedules/:id', perm('care-billing:update'), async (c) => { await rs.remove(me(c).companyId, c.req.param('id')); return done(c) })
  app.post('/schedules/:id/send-now', perm('care-billing:update'), async (c) => {
    const r = await rs.sendNow(me(c).companyId, c.req.param('id'))
    if ('problem' in r) return fail(c, 400, r.problem, 'cannot_send')
    return one(c, r.delivery, 201)
  })
  app.get('/deliveries', perm('care-billing:update'), async (c) => listAll(c, await rs.deliveries(me(c).companyId)))
  app.get('/deliveries/:id', perm('care-billing:read'), async (c) => {
    const { companyId, userId } = me(c)
    const m = await may(c)
    const r = await rs.open(companyId, c.req.param('id'), { userId, manager: m.manage })
    if ('problem' in r) return fail(c, r.status, r.problem, 'cannot_open')
    return fileReply(c, r.file)
  })

  return app
}
