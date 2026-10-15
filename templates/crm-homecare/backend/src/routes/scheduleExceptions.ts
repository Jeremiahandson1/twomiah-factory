// /api/schedule-exceptions — per-occurrence cancel / modify for recurring schedules.
//
// Office-only, all of it (as in the CVHC home care CRM's scheduleExceptionsRoutes.js): behind
// authenticate alone any caregiver login could cancel or rewrite ANY occurrence on ANY schedule. The
// caregiver-facing ways to take a visit off the books are POST /api/emergency/client-unavailable
// (ownership-checked) and the miss report.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { EXC_COLS, rows, one, inList, userIdOf } from '../helpers/scheduleRows.ts'
import { hms, DATE_RE } from '../services/scheduleOccurrences.ts'
import { CANCEL_REASONS } from '../helpers/cancelReasons.ts'
import { recordAudit } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET / — ?scheduleId, ?from, ?to
app.get('/', async (c) => {
  const scheduleId = c.req.query('scheduleId') || c.req.query('schedule_id')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const conds = [sql`TRUE`]
  if (scheduleId) conds.push(sql`se.schedule_id = ${scheduleId}`)
  if (from && DATE_RE.test(from)) conds.push(sql`se.exception_date >= ${from}::date`)
  if (to && DATE_RE.test(to)) conds.push(sql`se.exception_date <= ${to}::date`)
  return c.json(await rows(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se WHERE ${sql.join(conds, sql` AND `)} ORDER BY se.exception_date LIMIT 1000`))
})

// POST /by-schedules — bulk fetch for a list of schedule ids
app.post('/by-schedules', async (c) => {
  const { scheduleIds } = await c.req.json().catch(() => ({})) as any
  if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) return c.json([])
  return c.json(await rows(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se
    WHERE se.schedule_id IN (${inList(scheduleIds.map(String))}) ORDER BY se.exception_date`))
})

// POST / — create (or replace) the exception for one occurrence
app.post('/', async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const { scheduleId, exceptionDate, exceptionType, overrideStartTime, overrideEndTime, overrideCaregiverId, overrideClientId, overrideNotes } = b
  if (!scheduleId || !exceptionDate || !exceptionType) return c.json({ error: 'scheduleId, exceptionDate, and exceptionType are required' }, 400)
  if (!['cancelled', 'modified'].includes(exceptionType)) return c.json({ error: 'exceptionType must be cancelled or modified' }, 400)
  if (!DATE_RE.test(String(exceptionDate))) return c.json({ error: 'exceptionDate must be YYYY-MM-DD' }, 400)
  const sched = await one(sql`SELECT id FROM schedules WHERE id = ${scheduleId} AND is_active = true`)
  if (!sched) return c.json({ error: 'Schedule not found' }, 404)
  const cancelReason = exceptionType === 'cancelled' && b.cancelReason && CANCEL_REASONS[b.cancelReason] ? b.cancelReason : null

  const row = await one<any>(sql`
    INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_start_time, override_end_time,
                                     override_caregiver_id, override_client_id, override_notes, created_by, cancel_reason, created_at)
    VALUES (${createId()}, ${scheduleId}, ${exceptionDate}::date, ${exceptionType}, ${hms(overrideStartTime)}::time, ${hms(overrideEndTime)}::time,
            ${overrideCaregiverId || null}, ${overrideClientId || null}, ${overrideNotes || null}, ${userIdOf(user)}, ${cancelReason}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
      exception_type = EXCLUDED.exception_type,
      override_start_time = EXCLUDED.override_start_time,
      override_end_time = EXCLUDED.override_end_time,
      override_caregiver_id = EXCLUDED.override_caregiver_id,
      override_client_id = EXCLUDED.override_client_id,
      override_notes = EXCLUDED.override_notes,
      cancel_reason = EXCLUDED.cancel_reason
    RETURNING id`)
  const saved = await one(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se WHERE se.id = ${row.id}`)
  await recordAudit(userIdOf(user), 'CREATE', 'schedule_exceptions', row.id, null, saved)
  return c.json(saved, 201)
})

// DELETE /:id — remove the exception (the original occurrence comes back)
app.delete('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const old = await one(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se WHERE se.id = ${id}`)
  if (!old) return c.json({ error: 'Exception not found' }, 404)
  await rows(sql`DELETE FROM schedule_exceptions WHERE id = ${id}`)
  await recordAudit(userIdOf(user), 'DELETE', 'schedule_exceptions', id, old, null)
  return c.json({ success: true, message: 'Exception removed' })
})

export default app
