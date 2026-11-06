// /api/caregiver-surveys — caregiver satisfaction surveys and the retention risk (row 13, care_caregiver_surveys, not ready;
// docs/parity/homecare-margin-turnover.md). The engine is core/caregiverSurveys.ts; the risk is core/retentionRisk.ts.
//
//   caregiver (their own; care-schedule:read is what every caregiver holds)
//     GET  /me                                 what is waiting for them (with the questions) and what they answered lately
//     POST /me/:requestId/answer { <questionId>: 1–5 | true/false | text }
//   office
//     GET  /surveys · POST · PUT /:id · DELETE /:id   (read care-hr:read; write care-hr:update)   the agency's surveys; GET /options the choices
//     POST /surveys/:id/ask { caregiverIds }         ask now, by hand
//     GET  /outstanding                               who has not answered
//     GET  /results?startDate&endDate                 by branch, manager and caregiver, the trend, every answer
//     GET  /dashboard?days=                           the retention dashboard: satisfaction trend, response rate, at-risk list, risk trend
//     GET  /risk · GET /risk/:caregiverId/trend       every caregiver's score with its reasons; one caregiver's trend
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays, isYmd } from '../core/agencyTime.ts'
import { TRIGGERS, QUESTION_KINDS, STANDARD_QUESTIONS, checkSurvey } from '../core/caregiverSurveys.ts'
import { BAND_LABELS } from '../core/retentionRisk.ts'
import { userIdOf } from '../scheduling/shared.ts'

export function createCaregiverSurveyRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const cs = core.caregiverSurveys
  const me = (c: Context<AppEnv>) => { const u = c.get('user') as any; return { companyId: String(u.companyId), userId: userIdOf(u) } }
  const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as any

  // ── the caregiver's own ──────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/me', perm('care-schedule:read'), async (c) => { const { companyId, userId } = me(c); return one(c, await cs.mine(companyId, userId)) })
  app.post('/me/:requestId/answer', perm('care-schedule:read'), async (c) => {
    const { companyId, userId } = me(c)
    const r = await cs.answer(companyId, userId, c.req.param('requestId'), await body(c))
    if (!r.ok) return fail(c, r.status, r.problem, 'bad_answer', r.fields)
    return one(c, { success: true, score: r.score === null ? null : r.score / 100, message: 'Thank you — the office has your answers.' })
  })

  // ── the office ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/options', perm('care-hr:read'), (c) => one(c, { triggers: TRIGGERS, questionKinds: QUESTION_KINDS, standardQuestions: STANDARD_QUESTIONS, bands: BAND_LABELS }))
  app.get('/surveys', perm('care-hr:read'), async (c) => listAll(c, await cs.list(me(c).companyId)))
  const saveSurvey = async (c: Context<AppEnv>, id?: string) => {
    const { companyId, userId } = me(c)
    const checked = checkSurvey(await body(c))
    if ('problem' in checked) return fail(c, 400, checked.problem, 'bad_survey', checked.fields)
    const row = await cs.save(companyId, userId, checked.input, id)
    if (!row) return fail(c, 404, 'That survey does not exist.', 'not_found')
    return one(c, row, id ? 200 : 201)
  }
  app.post('/surveys', perm('care-hr:update'), (c) => saveSurvey(c))
  app.put('/surveys/:id', perm('care-hr:update'), (c) => saveSurvey(c, c.req.param('id')))
  app.delete('/surveys/:id', perm('care-hr:update'), async (c) => { await cs.remove(me(c).companyId, c.req.param('id')); return done(c) })
  app.post('/surveys/:id/ask', perm('care-hr:update'), async (c) => {
    const b = await body(c)
    const ids = Array.isArray(b.caregiverIds) ? b.caregiverIds.map(String) : []
    if (!ids.length) return fail(c, 400, 'Pick at least one caregiver.', 'bad_ask', { caregiverIds: 'Pick someone' })
    const r = await cs.askNow(me(c).companyId, c.req.param('id'), ids)
    if ('problem' in r) return fail(c, 404, r.problem, 'not_found')
    return one(c, { success: true, sent: r.sent, message: r.sent ? `Asked ${r.sent} caregiver${r.sent === 1 ? '' : 's'}.` : 'Everyone picked was already asked today.' })
  })
  app.get('/outstanding', perm('care-hr:read'), async (c) => listAll(c, await cs.outstanding(me(c).companyId)))

  async function range(c: Context<AppEnv>, companyId: string, defaultDays: number) {
    const today = await core.time.today(companyId)
    const start = c.req.query('startDate') || addDays(today, -(defaultDays - 1)), end = c.req.query('endDate') || today
    if (!isYmd(start) || !isYmd(end) || end < start) return null
    return { start, end }
  }
  app.get('/results', perm('care-hr:read'), async (c) => {
    const { companyId } = me(c)
    const r = await range(c, companyId, 90)
    if (!r) return fail(c, 400, 'startDate and endDate must be dates, the end not before the start.', 'bad_range')
    return one(c, await cs.results(companyId, r.start, r.end))
  })
  app.get('/dashboard', perm('care-hr:read'), async (c) => {
    const days = Math.min(730, Math.max(7, Number(c.req.query('days')) || 180))
    return one(c, await cs.dashboard(me(c).companyId, days))
  })
  app.get('/risk', perm('care-hr:read'), async (c) => listAll(c, await core.risk.current(me(c).companyId)))
  app.get('/risk/:caregiverId/trend', perm('care-hr:read'), async (c) => {
    const days = Math.min(366, Math.max(7, Number(c.req.query('days')) || 90))
    return listAll(c, await core.risk.trend(me(c).companyId, days, c.req.param('caregiverId')))
  })

  return app
}
