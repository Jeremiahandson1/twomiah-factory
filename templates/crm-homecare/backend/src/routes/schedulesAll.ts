// /api/schedules-all — every active schedule with its per-date exceptions, and the scoped Edit Shift.
// Ported from the CVHC home care CRM (server.js GET/PUT /api/schedules-all).
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { SCHED_COLS, attachExceptions, rows, one, scheduleById, userIdOf } from '../helpers/scheduleRows.ts'
import { schedTs, hms, shiftTimesError, DATE_RE } from '../services/scheduleOccurrences.ts'
import { alignBiweeklyAnchor } from '../helpers/biweekly.ts'
import { agencyNow, addDays } from '../services/agencyTime.ts'
import { recordAudit } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/schedules-all
app.get('/', async (c) => {
  const list = await rows(sql`
    SELECT ${SCHED_COLS()},
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           cl.first_name AS client_first_name, cl.last_name AS client_last_name
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients cl ON s.client_id = cl.id
     WHERE s.is_active = true
     ORDER BY s.day_of_week, s.date, s.start_time`)
  return c.json(await attachExceptions(list))
})

// PUT /api/schedules-all/:id — Edit Shift.
//
// Editing a RECURRING shift used to rewrite history: the pattern is a single row and every past
// occurrence is re-derived from it, so changing the time silently changed every week already
// worked. An edit must therefore say WHICH occurrences it means:
//   scope=this      — override that ONE date with a 'modified' exception (a past date is allowed:
//                     correcting what really ran at payday is the workflow). Requires editDate.
//   scope=following — the shift changed as of editDate: the old pattern ends the day before and a
//                     new one carries the edits. Weeks before editDate keep the old row.
//   scope=all       — rewrite the pattern in place, history included. Only when asked by name.
// There is NO default for a recurring shift — a silent default is wrong for somebody.
// One-time shifts are a single occurrence and are always edited in place.
app.put('/:id', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const actor = userIdOf(user)
  const scheduleId = c.req.param('id')
  const b = await c.req.json().catch(() => ({})) as any
  const { clientId, caregiverId, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate: rawAnchorDate, endDate, isTraining } = b
  const scope = String(b.scope || c.req.query('scope') || '').toLowerCase()
  const editDate: string | null = b.editDate || c.req.query('editDate') || null

  if ((startTime && !hms(startTime)) || (endTime && !hms(endTime))) return c.json({ error: 'Times must be HH:MM.' }, 400)
  if (startTime && endTime && hms(startTime) === hms(endTime)) return c.json({ error: 'Start and end time cannot be the same' }, 400)
  if (scope && !['this', 'following', 'all'].includes(scope)) return c.json({ error: `Invalid scope '${scope}'. Use this | following | all.` }, 400)
  if (editDate && !DATE_RE.test(editDate)) return c.json({ error: 'editDate must be YYYY-MM-DD.' }, 400)

  const before = await scheduleById(scheduleId, true)
  if (!before) return c.json({ error: 'Schedule not found' }, 404)
  // The times the row ends up with (a field left out keeps its value) must pass the one rule.
  if (startTime || endTime) {
    const timesError = shiftTimesError(startTime || before.start_time, endTime || before.end_time, b.overnight)
    if (timesError) return c.json({ error: timesError }, 400)
  }
  const isRecurring = before.day_of_week !== null && before.day_of_week !== undefined
  const { date: today } = await agencyNow()

  const resultingFrequency = frequency || before.frequency || 'weekly'
  const resultingDow = (dayOfWeek !== undefined && dayOfWeek !== null && dayOfWeek !== '') ? Number(dayOfWeek) : before.day_of_week
  const alignAnchor = (fromDate: string | null) => {
    if (resultingFrequency !== 'biweekly' || resultingDow === null || resultingDow === undefined) return rawAnchorDate || null
    return alignBiweeklyAnchor({
      anchorDate: rawAnchorDate || before.anchor_date, effectiveDate: fromDate, dayOfWeek: resultingDow,
      previous: { anchor_date: before.anchor_date, day_of_week: before.day_of_week },
    })
  }

  // In-place edit of this exact row (one-time shifts, and explicit scope=all). The times keep the
  // row's own base date; reassignment happens in the same statement, on the row actually written.
  const editInPlace = async () => {
    const newDow = dayOfWeek !== undefined && dayOfWeek !== '' ? (dayOfWeek === null ? null : Number(dayOfWeek)) : before.day_of_week
    const newDate = newDow === null || newDow === undefined ? (date || before.date) : null
    const base = newDate || effectiveDate || before.effective_date || today
    const anchorDate = alignAnchor(effectiveDate || before.effective_date)
    await rows(sql`
      UPDATE schedules SET
        client_id = COALESCE(${clientId || null}, client_id),
        caregiver_id = COALESCE(${caregiverId || null}, caregiver_id),
        day_of_week = ${newDow},
        date = ${newDate}::date,
        start_time = ${schedTs(startTime || before.start_time, base)}::timestamp,
        end_time = ${schedTs(endTime || before.end_time, base)}::timestamp,
        notes = ${notes === undefined ? before.notes : (notes || null)},
        frequency = COALESCE(${frequency || null}, frequency),
        effective_date = COALESCE(${effectiveDate || null}::date, effective_date),
        anchor_date = COALESCE(${anchorDate}::date, anchor_date),
        ${endDate !== undefined ? sql`end_date = ${endDate || null}::date,` : sql``}
        ${isTraining !== undefined ? sql`is_training = ${!!isTraining},` : sql``}
        updated_at = NOW()
      WHERE id = ${scheduleId} AND is_active = true`)
    return scheduleById(scheduleId)
  }

  try {
    if (!isRecurring) {
      const row = await editInPlace()
      await recordAudit(actor, 'UPDATE', 'schedules', scheduleId, before, row)
      return c.json({ ...row, _scope: 'one-time' })
    }

    if (!scope) {
      return c.json({
        error: "This is a repeating shift, so the change needs a scope: 'this' (just that day), 'following' (that day onward), or 'all' (every occurrence, past included).",
        code: 'scope_required',
      }, 400)
    }

    if (scope === 'all') {
      const row = await editInPlace()
      await recordAudit(actor, 'UPDATE', 'schedules', scheduleId, before, row)
      return c.json({ ...row, _scope: 'all' })
    }

    if (scope === 'this') {
      if (!editDate) return c.json({ error: "scope='this' requires editDate (the occurrence being changed)." }, 400)
      const ex = await one(sql`
        INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_start_time, override_end_time,
                                         override_client_id, override_caregiver_id, override_notes, created_by, created_at)
        VALUES (${createId()}, ${scheduleId}, ${editDate}::date, 'modified', ${hms(startTime)}::time, ${hms(endTime)}::time,
                ${clientId || null}, ${caregiverId || null}, ${notes || null}, ${actor}, NOW())
        ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
          exception_type = 'modified',
          override_start_time   = COALESCE(EXCLUDED.override_start_time,   schedule_exceptions.override_start_time),
          override_end_time     = COALESCE(EXCLUDED.override_end_time,     schedule_exceptions.override_end_time),
          override_client_id    = COALESCE(EXCLUDED.override_client_id,    schedule_exceptions.override_client_id),
          override_caregiver_id = COALESCE(EXCLUDED.override_caregiver_id, schedule_exceptions.override_caregiver_id),
          override_notes        = COALESCE(EXCLUDED.override_notes,        schedule_exceptions.override_notes)
        RETURNING id, schedule_id, to_char(exception_date, 'YYYY-MM-DD') AS exception_date, exception_type,
                  to_char(override_start_time, 'HH24:MI:SS') AS override_start_time,
                  to_char(override_end_time, 'HH24:MI:SS') AS override_end_time,
                  override_client_id, override_caregiver_id, override_notes`)
      await recordAudit(actor, 'UPDATE', 'schedules', scheduleId, before, { scope: 'this', editDate, exception: ex })
      return c.json({ ...before, _scope: 'this', _exception: ex })
    }

    // scope=following — fromDate may be in the past (an effective-dated correction).
    const fromDate = editDate || today
    if (before.effective_date && before.effective_date >= fromDate) {
      const row = await editInPlace()
      await recordAudit(actor, 'UPDATE', 'schedules', scheduleId, before, row)
      return c.json({ ...row, _scope: 'following', _note: 'pattern had not started yet; edited in place' })
    }
    const followingAnchor = alignAnchor(fromDate)
    const newId = createId()
    await db.transaction(async (tx) => {
      // 1) Freeze history: the old pattern stops the day before the change.
      await tx.execute(sql`UPDATE schedules SET end_date = ${addDays(fromDate, -1)}::date, updated_at = NOW()
                           WHERE id = ${scheduleId} AND is_active = true`)
      // 2) A new pattern carrying the edits — every other column copied from the old row.
      await tx.execute(sql`
        INSERT INTO schedules (id, client_id, caregiver_id, title, start_time, end_time, frequency, effective_date, anchor_date,
                               schedule_type, is_active, day_of_week, date, status, notes, care_type_id, end_date,
                               is_split_shift, split_shift_group_id, split_segment, is_training, suspended_from, created_at, updated_at)
        SELECT ${newId}, COALESCE(${clientId || null}, client_id), COALESCE(${caregiverId || null}, caregiver_id), title,
               ${schedTs(startTime || before.start_time, fromDate)}::timestamp,
               ${schedTs(endTime || before.end_time, fromDate)}::timestamp,
               COALESCE(${frequency || null}, frequency), ${fromDate}::date, COALESCE(${followingAnchor}::date, anchor_date),
               schedule_type, true, ${resultingDow}, NULL, status,
               ${notes === undefined ? sql`notes` : sql`${notes || null}`}, care_type_id,
               ${before.end_date}::date, is_split_shift, split_shift_group_id, split_segment,
               ${isTraining === undefined ? sql`is_training` : sql`${!!isTraining}`}, suspended_from, NOW(), NOW()
          FROM schedules WHERE id = ${scheduleId}`)
    })
    const created = await scheduleById(newId)
    await recordAudit(actor, 'UPDATE', 'schedules', scheduleId, before, { scope: 'following', endedOn: fromDate, replacedBy: newId, newPattern: created })
    return c.json({ ...created, _scope: 'following', _endedPatternId: scheduleId, _effectiveFrom: fromDate })
  } catch (e: any) {
    if (e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')) {
      return c.json({ error: 'That change would duplicate an existing active recurring shift for this caregiver and client.' }, 409)
    }
    throw e
  }
})

export default app
