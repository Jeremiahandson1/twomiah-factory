// /api/schedule-exceptions — per-occurrence cancel / modify for recurring schedules. Moved from
// templates/crm-homecare/backend/src/routes/scheduleExceptions.ts.
//
// Office-only, all of it (the template's requireAdmin on every path, as in the CVHC CRM's scheduleExceptionsRoutes.js):
// here care-schedule:update, which a caregiver does not hold — an exception rewrites the schedule, reading them is the
// office's grid. The caregiver-facing ways to take a visit off the books are POST /api/emergency/client-unavailable
// (ownership-checked) and the miss report.
//
// Replies: the two lists are list replies ({ data, pagination }) of camelCase rows; DELETE is { success, message }.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { hms, DATE_RE } from '../core/scheduleOccurrences.ts'
import { CANCEL_REASONS } from '../core/cancelReasons.ts'
import { exceptionsForSchedules } from '../../../data/homecareCore.ts'
import { listExceptions, activeScheduleExists, replaceException, exceptionById, deleteException } from '../../../data/homecareScheduling.ts'
import { who } from './shared.ts'

const asList = (c: any, rows: any[]) => listAll(c, rows)

export function createScheduleExceptionsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const db = d.db
  app.use('*', d.permissions.requirePermission('care-schedule:update'))

  // GET / — ?scheduleId, ?from, ?to
  app.get('/', async (c) => {
    const { companyId } = who(c)
    const scheduleId = c.req.query('scheduleId') || c.req.query('schedule_id')
    const from = c.req.query('from')
    const to = c.req.query('to')
    return asList(c, await listExceptions(db, companyId, {
      scheduleId: scheduleId || undefined,
      from: from && DATE_RE.test(from) ? from : undefined,
      to: to && DATE_RE.test(to) ? to : undefined,
    }))
  })

  // POST /by-schedules — bulk fetch for a list of schedule ids
  app.post('/by-schedules', async (c) => {
    const { companyId } = who(c)
    const { scheduleIds } = await c.req.json().catch(() => ({})) as any
    if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) return asList(c, [])
    return asList(c, await exceptionsForSchedules(db, companyId, scheduleIds.map(String)))
  })

  // POST / — create (or replace) the exception for one occurrence
  app.post('/', async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const { scheduleId, exceptionDate, exceptionType, overrideStartTime, overrideEndTime, overrideCaregiverId, overrideClientId, overrideNotes } = b
    if (!scheduleId || !exceptionDate || !exceptionType) return fail(c, 400, 'scheduleId, exceptionDate, and exceptionType are required')
    if (!['cancelled', 'modified'].includes(exceptionType)) return fail(c, 400, 'exceptionType must be cancelled or modified')
    if (!DATE_RE.test(String(exceptionDate))) return fail(c, 400, 'exceptionDate must be YYYY-MM-DD')
    if (!(await activeScheduleExists(db, companyId, scheduleId))) return fail(c, 404, 'Schedule not found')
    const cancelReason = exceptionType === 'cancelled' && b.cancelReason && CANCEL_REASONS[b.cancelReason] ? b.cancelReason : null

    const id = await replaceException(db, companyId, {
      scheduleId, date: String(exceptionDate), type: exceptionType, start: hms(overrideStartTime), end: hms(overrideEndTime),
      caregiverId: overrideCaregiverId || null, clientId: overrideClientId || null, notes: overrideNotes || null, actor: me, cancelReason,
    })
    const saved = await exceptionById(db, companyId, id)
    await core.notify.recordAudit(companyId, me, 'CREATE', 'schedule_exceptions', id, null, saved)
    return one(c, saved, 201)
  })

  // DELETE /:id — remove the exception (the original occurrence comes back)
  app.delete('/:id', async (c) => {
    const { companyId, me } = who(c)
    const id = c.req.param('id')
    const old = await exceptionById(db, companyId, id)
    if (!old) return fail(c, 404, 'Exception not found')
    await deleteException(db, companyId, id)
    await core.notify.recordAudit(companyId, me, 'DELETE', 'schedule_exceptions', id, old, null)
    return done(c, 'Exception removed')
  })

  return app
}
