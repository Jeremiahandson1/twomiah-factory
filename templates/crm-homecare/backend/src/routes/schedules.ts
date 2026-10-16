// /api/schedules — one caregiver's shifts, creating a shift, reassigning it, the scoped delete and
// suspend / resume service. Ported from the CVHC home care CRM (routes/schedulesRoutes.js).
//
// Office actions are requireAdmin. A caregiver may read only their own shifts.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { SCHED_COLS, attachExceptions, rows, one, scheduleById, inList, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { schedTs, hms, shiftHours, shiftTimesError, DATE_RE, occurrencesCte } from '../services/scheduleOccurrences.ts'
import { CANCEL_REASONS } from '../helpers/cancelReasons.ts'
import { checkAuthorizationBalance } from '../helpers/authorizationCheck.ts'

import { agencyNow, addDays } from '../services/agencyTime.ts'
import { recordAudit } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)

// Recurring patterns that have ended (end_date before today) are history, not "my schedule".
const notEnded = (today: string) => sql`(s.day_of_week IS NULL OR s.end_date IS NULL OR s.end_date >= ${today}::date)`

// GET /api/schedules/caregiver/:caregiverId — used by the Schedule Hub.
app.get('/caregiver/:caregiverId', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.param('caregiverId')
  if (!isOffice(user) && userIdOf(user) !== caregiverId) return c.json({ error: 'You can only view your own schedules' }, 403)
  const { date: today } = await agencyNow()
  const list = await rows(sql`
    SELECT ${SCHED_COLS()}, c.first_name AS client_first_name, c.last_name AS client_last_name
      FROM schedules s JOIN clients c ON s.client_id = c.id
     WHERE s.caregiver_id = ${caregiverId} AND s.is_active = true AND ${notEnded(today)}
     ORDER BY s.day_of_week, s.date, s.start_time`)
  return c.json(await attachExceptions(list))
})

// GET /api/schedules/:caregiverId/occurrences?from&to — the caregiver's DATED visits between two days
// (inclusive, at most 92), through the one schedule engine: recurring and one-time patterns, the
// exceptions applied (cancelled days gone, modified times/clients, days covered for someone else
// included), nothing after a suspension. A caregiver may read only their own; the office anyone's.
app.get('/:caregiverId/occurrences', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.param('caregiverId')
  if (!isOffice(user) && userIdOf(user) !== caregiverId) return c.json({ error: 'You can only view your own schedules' }, 403)
  const { date: today } = await agencyNow()
  const from = c.req.query('from') || today
  const to = c.req.query('to') || addDays(from, 13)
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return c.json({ error: 'from and to must be YYYY-MM-DD' }, 400)
  if (to < from) return c.json({ error: 'to must be on or after from' }, 400)
  if (addDays(from, 91) < to) return c.json({ error: 'At most 92 days at a time' }, 400)
  const list = await rows(sql`WITH ${occurrencesCte(from, to)}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS date,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           occ.minutes, occ.is_modified, occ.is_training, occ.client_id,
           (occ.pattern_caregiver_id IS DISTINCT FROM occ.caregiver_id) AS moved_in,
           s.day_of_week IS NOT NULL AS is_recurring, s.notes,
           c.first_name AS client_first_name, c.last_name AS client_last_name,
           c.address AS client_address, c.city AS client_city, c.latitude AS client_latitude, c.longitude AS client_longitude
      FROM occ JOIN schedules s ON s.id = occ.schedule_id JOIN clients c ON c.id = occ.client_id
     WHERE occ.caregiver_id = ${caregiverId}
     ORDER BY occ.occ_date, occ.start_time`)
  return c.json({ caregiverId, from, to, occurrences: list })
})

// GET /api/schedules/:caregiverId — the caregiver's own phone. Exceptions are attached so a
// cancelled visit never shows (and never auto-clocks anyone in). ?includeMovedIn=1 adds shifts
// moved ONTO this caregiver for a single day from someone else's pattern, as one-time shifts.
app.get('/:caregiverId', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.param('caregiverId')
  if (!isOffice(user) && userIdOf(user) !== caregiverId) return c.json({ error: 'You can only view your own schedules' }, 403)
  const { date: today } = await agencyNow()
  const list = await rows(sql`
    SELECT ${SCHED_COLS()},
           c.first_name AS client_first_name, c.last_name AS client_last_name,
           c.address AS client_address, c.city AS client_city, ct.name AS care_type_name
      FROM schedules s
      JOIN clients c ON s.client_id = c.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
     WHERE s.caregiver_id = ${caregiverId} AND s.is_active = true AND ${notEnded(today)}
     ORDER BY s.day_of_week, s.date, s.start_time`)
  const out = await attachExceptions(list)

  if (String(c.req.query('includeMovedIn')) === '1') {
    const moved = await rows(sql`
      SELECT s.id, s.schedule_type, s.notes, COALESCE(s.is_training, false) AS is_training,
             to_char(se.exception_date, 'YYYY-MM-DD') AS date,
             NULL::int AS day_of_week,
             to_char(COALESCE(se.override_start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
             to_char(COALESCE(se.override_end_time, s.end_time::time), 'HH24:MI:SS') AS end_time,
             ${caregiverId}::text AS caregiver_id,
             COALESCE(se.override_client_id, s.client_id) AS client_id,
             c.first_name AS client_first_name, c.last_name AS client_last_name,
             c.address AS client_address, c.city AS client_city, ct.name AS care_type_name,
             TRUE AS moved_in
        FROM schedule_exceptions se
        JOIN schedules s ON s.id = se.schedule_id
        JOIN clients c ON c.id = COALESCE(se.override_client_id, s.client_id)
        LEFT JOIN care_types ct ON c.care_type_id = ct.id
       WHERE se.override_caregiver_id = ${caregiverId}
         AND s.caregiver_id <> ${caregiverId}
         AND se.exception_type = 'modified'
         AND s.is_active = true
         AND se.exception_date >= ${today}::date
       ORDER BY se.exception_date`)
    out.push(...moved.map((r) => ({ ...r, exceptions: [] })))
  }
  return c.json(out)
})

// POST /api/schedules — create a shift.
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, effectiveDate, isTraining } = b
  if (!caregiverId || !clientId) return c.json({ error: 'A caregiver and client are required.' }, 400)
  const timesError = shiftTimesError(startTime, endTime, b.overnight)
  if (timesError) return c.json({ error: timesError }, 400)

  const isRecurring = dayOfWeek !== null && dayOfWeek !== undefined && dayOfWeek !== ''
  if (!isRecurring && !(date && DATE_RE.test(date))) return c.json({ error: 'A one-time shift needs its date (YYYY-MM-DD).' }, 400)
  if (isRecurring && !(Number.isInteger(Number(dayOfWeek)) && Number(dayOfWeek) >= 0 && Number(dayOfWeek) <= 6)) {
    return c.json({ error: 'dayOfWeek must be 0 (Sunday) to 6 (Saturday).' }, 400)
  }

  // Advisory only — never blocks. Training shifts don't bill, so they don't touch the balance.
  const authCheck = isTraining ? { warnings: [] as string[] } : await checkAuthorizationBalance(clientId, shiftHours(startTime, endTime))

  // A recurring pattern MUST have an effective date, never in the past: expansion would otherwise
  // walk backwards and back-bill / back-pay visits that never happened.
  const { date: today } = await agencyNow()
  const effDate = isRecurring ? ((effectiveDate && effectiveDate >= today) ? effectiveDate : today) : null
  const base = isRecurring ? effDate! : date

  // One-time duplicate guard: a double-submit returns the existing row instead of a billable twin.
  if (!isRecurring) {
    const existing = await one(sql`
      SELECT ${SCHED_COLS()} FROM schedules s
       WHERE s.is_active = true AND s.day_of_week IS NULL
         AND s.caregiver_id = ${caregiverId} AND s.client_id = ${clientId} AND s.date = ${date}::date
         AND s.start_time::time = ${hms(startTime)}::time AND s.end_time::time = ${hms(endTime)}::time
       LIMIT 1`)
    if (existing) return c.json({ ...existing, duplicate: true, authWarnings: authCheck.warnings }, 200)
  }

  try {
    const created = await one<any>(sql`
      INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time,
                             notes, effective_date, is_training, frequency, is_active, status, created_at, updated_at)
      VALUES (${createId()}, ${caregiverId}, ${clientId}, ${scheduleType || (isRecurring ? 'recurring' : 'one-time')},
              ${isRecurring ? Number(dayOfWeek) : null}, ${isRecurring ? null : date}::date,
              ${schedTs(startTime, base)}::timestamp, ${schedTs(endTime, base)}::timestamp,
              ${notes || null}, ${effDate}::date, ${!!isTraining}, 'weekly', true, 'active', NOW(), NOW())
      RETURNING id`)
    const row = await scheduleById(created.id)
    await recordAudit(userIdOf(user), 'CREATE', 'schedules', created.id, null, row)
    return c.json({ ...row, authWarnings: authCheck.warnings }, 201)
  } catch (e: any) {
    if (e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')) {
      return c.json({ error: 'This caregiver already has this exact shift (same client, day, and time).', duplicate: true }, 409)
    }
    throw e
  }
})

// PUT /api/schedules/:id/reassign — hand the whole shift to another caregiver.
app.put('/:id/reassign', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { newCaregiverId, reason } = await c.req.json().catch(() => ({})) as any
  if (!newCaregiverId) return c.json({ error: 'newCaregiverId is required' }, 400)
  const before = await scheduleById(id)
  if (!before) return c.json({ error: 'Schedule not found' }, 404)
  const cg = await one<any>(sql`SELECT id, first_name, last_name FROM users WHERE id = ${newCaregiverId} AND role = 'caregiver' AND is_active = true`)
  if (!cg) return c.json({ error: 'Caregiver not found or inactive' }, 404)
  if (before.date) {
    const conflict = await one(sql`
      SELECT id FROM schedules
       WHERE caregiver_id = ${newCaregiverId} AND is_active = true AND id <> ${id} AND date = ${before.date}::date
         AND NOT (end_time::time <= ${before.start_time}::time OR start_time::time >= ${before.end_time}::time)`)
    if (conflict) return c.json({ error: `${cg.first_name} ${cg.last_name} has a conflicting schedule at this time` }, 400)
  }
  await rows(sql`UPDATE schedules SET caregiver_id = ${newCaregiverId}, updated_at = NOW() WHERE id = ${id}`)
  const after = await scheduleById(id)
  await recordAudit(userIdOf(user), 'UPDATE', 'schedules', id, before, after, reason || null)
  return c.json({ success: true, schedule: after, message: `Schedule reassigned to ${cg.first_name} ${cg.last_name}` })
})

// DELETE /api/schedules/:scheduleId
//   ?scope=this&date=YYYY-MM-DD[&cancelReason=]  cancel one occurrence (a 'cancelled' exception)
//   ?scope=following&date=YYYY-MM-DD            end the recurring pattern the day before
//   ?scope=all (default)  recurring: END it as of today, keeping every worked occurrence;
//                         one-time: remove the row
//   ?scope=purge          erase the pattern including history (for a pattern made by mistake)
//   &deletePair=true      also the other half of a split shift
app.delete('/:scheduleId', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const actor = userIdOf(user)
  const scheduleId = c.req.param('scheduleId')
  const scope = c.req.query('scope') || 'all'
  const date = c.req.query('date')
  const reason = c.req.query('reason') || null
  const deletePair = c.req.query('deletePair') === 'true'

  const shift = await scheduleById(scheduleId)
  if (!shift) return c.json({ error: 'Schedule not found' }, 404)
  const isRecurring = shift.day_of_week !== null && shift.day_of_week !== undefined

  // A scoped delete must NEVER fall through to a destructive full delete.
  if (scope === 'this' || scope === 'following') {
    if (!isRecurring) return c.json({ error: `scope='${scope}' is only valid for recurring shifts; this is a one-time shift. Use scope=all to delete it.` }, 400)
    if (!date || !DATE_RE.test(date)) return c.json({ error: `scope='${scope}' requires a 'date' query param. Refusing to delete to avoid wiping the whole pattern.` }, 400)
  }
  if (!['this', 'following', 'all', 'purge'].includes(scope)) return c.json({ error: `Invalid scope '${scope}'.` }, 400)

  if (scope === 'this') {
    const raw = c.req.query('cancelReason')
    const cancelReason = raw && CANCEL_REASONS[raw] ? raw : null // unknown values are dropped, not stored
    await rows(sql`
      INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, created_by, cancel_reason, created_at)
      VALUES (${createId()}, ${scheduleId}, ${date}::date, 'cancelled', ${actor}, ${cancelReason}, NOW())
      ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
        exception_type = 'cancelled',
        cancel_reason = COALESCE(EXCLUDED.cancel_reason, schedule_exceptions.cancel_reason)`)
    await recordAudit(actor, 'CANCEL_OCCURRENCE', 'schedules', scheduleId, null, { date, cancelReason }, reason)
    return c.json({ message: 'Occurrence cancelled', date, scheduleId })
  }

  if (scope === 'following') {
    const endDate = addDays(date!, -1)
    await rows(sql`UPDATE schedules SET end_date = ${endDate}::date, updated_at = NOW() WHERE id = ${scheduleId} AND is_active = true`)
    const after = await scheduleById(scheduleId)
    await recordAudit(actor, 'END_PATTERN', 'schedules', scheduleId, shift, after, reason)
    return c.json({ message: 'Recurring pattern ended', endDate, schedule: after })
  }

  const isSplitPair = !!(shift.is_split_shift && shift.split_shift_group_id && deletePair)
  const target = isSplitPair
    ? sql`split_shift_group_id = ${shift.split_shift_group_id} AND is_active = true`
    : sql`id = ${scheduleId}`

  if (scope === 'purge') {
    const r = await rows<any>(sql`UPDATE schedules SET is_active = false, updated_at = NOW() WHERE ${target} RETURNING id`)
    for (const row of r) await recordAudit(actor, 'DELETE', 'schedules', row.id, shift, null, reason)
    return c.json({ message: 'Schedule permanently removed (history included)', deletedCount: r.length })
  }

  // scope=all on a recurring pattern: END it today; past occurrences stay visible and billable.
  if (isRecurring) {
    const { date: today } = await agencyNow()
    const endStr = addDays(today, -1)
    const effStr = shift.effective_date || (shift.created_at ? new Date(shift.created_at).toISOString().slice(0, 10) : today)
    if (endStr < effStr) {
      // It had not started yet — nothing to protect, remove it outright.
      const r = await rows<any>(sql`UPDATE schedules SET is_active = false, updated_at = NOW() WHERE ${target} RETURNING id`)
      for (const row of r) await recordAudit(actor, 'DELETE', 'schedules', row.id, shift, null, reason)
      return c.json({ message: 'Recurring schedule removed (had not started; no past occurrences)', deletedCount: r.length })
    }
    const r = await rows<any>(sql`UPDATE schedules SET end_date = ${endStr}::date, updated_at = NOW() WHERE ${target} RETURNING id`)
    for (const row of r) await recordAudit(actor, 'END_PATTERN', 'schedules', row.id, shift, { end_date: endStr }, reason)
    return c.json({ message: 'Recurring pattern ended today; past occurrences kept', endDate: endStr, pastKept: true, deletedCount: r.length })
  }

  const r = await rows<any>(sql`UPDATE schedules SET is_active = false, updated_at = NOW() WHERE ${target} RETURNING id`)
  for (const row of r) await recordAudit(actor, 'DELETE', 'schedules', row.id, shift, null, reason)
  return c.json({
    message: isSplitPair ? 'Split shift pair deleted' : 'Schedule deleted',
    deletedCount: r.length,
    wasSplitShift: !!shift.is_split_shift,
    splitShiftGroupId: shift.split_shift_group_id || null,
  })
})

// ── SUSPEND / RESUME SERVICE ─────────────────────────────────────────────────────────────
// Pause a client's service without deleting anything: schedules.suspended_from makes the engine stop
// generating visits on/after that date (so billing, payroll, reminders and no-show all stop) while
// already-worked visits before it stay. Resume clears the date and the schedule returns as it was.
//   scope='this'   — just this schedule; scope='client' — every active schedule of this client.
async function resolveScopeIds(scheduleId: string, scope: string) {
  const cur = await one<any>(sql`SELECT id, client_id FROM schedules WHERE id = ${scheduleId} AND is_active = true`)
  if (!cur) return null
  if (scope === 'client') {
    const all = await rows<any>(sql`SELECT id FROM schedules WHERE client_id = ${cur.client_id} AND is_active = true`)
    return { clientId: cur.client_id as string, ids: all.map((r) => r.id as string) }
  }
  return { clientId: cur.client_id as string, ids: [scheduleId] }
}

async function fromDateOf(body: any): Promise<string | null> {
  const d = body?.fromDate || (await agencyNow()).date
  return DATE_RE.test(String(d)) ? String(d) : null
}

app.post('/:id/suspend', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as any
  const scope = String(body.scope || 'this').toLowerCase()
  if (!['this', 'client'].includes(scope)) return c.json({ error: "scope must be 'this' or 'client'." }, 400)
  const fromDate = await fromDateOf(body)
  if (!fromDate) return c.json({ error: 'fromDate must be YYYY-MM-DD.' }, 400)
  const scoped = await resolveScopeIds(c.req.param('id'), scope)
  if (!scoped) return c.json({ error: 'Schedule not found' }, 404)
  const r = await rows<any>(sql`UPDATE schedules SET suspended_from = ${fromDate}::date, updated_at = NOW()
    WHERE id IN (${inList(scoped.ids)}) AND is_active = true RETURNING id`)
  for (const row of r) await recordAudit(userIdOf(user), 'SUSPEND', 'schedules', row.id, null, { scope, suspended_from: fromDate }, body.reason || null)
  return c.json({ suspended: r.length, scope, fromDate, clientId: scoped.clientId, scheduleIds: r.map((x) => x.id) })
})

app.post('/:id/resume', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as any
  const scope = String(body.scope || 'this').toLowerCase()
  if (!['this', 'client'].includes(scope)) return c.json({ error: "scope must be 'this' or 'client'." }, 400)
  const scoped = await resolveScopeIds(c.req.param('id'), scope)
  if (!scoped) return c.json({ error: 'Schedule not found' }, 404)
  const r = await rows<any>(sql`UPDATE schedules SET suspended_from = NULL, updated_at = NOW()
    WHERE id IN (${inList(scoped.ids)}) AND is_active = true AND suspended_from IS NOT NULL RETURNING id`)
  for (const row of r) await recordAudit(userIdOf(user), 'RESUME', 'schedules', row.id, null, { scope }, body.reason || null)
  return c.json({ resumed: r.length, scope, clientId: scoped.clientId, scheduleIds: r.map((x) => x.id) })
})

// Client-scoped — the Clients screen works on a client, not a schedule id.
app.post('/client/:clientId/suspend', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as any
  const fromDate = await fromDateOf(body)
  if (!fromDate) return c.json({ error: 'fromDate must be YYYY-MM-DD.' }, 400)
  const clientId = c.req.param('clientId')
  const r = await rows<any>(sql`UPDATE schedules SET suspended_from = ${fromDate}::date, updated_at = NOW()
    WHERE client_id = ${clientId} AND is_active = true RETURNING id`)
  for (const row of r) await recordAudit(userIdOf(user), 'SUSPEND', 'schedules', row.id, null, { scope: 'client', suspended_from: fromDate }, body.reason || null)
  return c.json({ suspended: r.length, fromDate, clientId, scheduleIds: r.map((x) => x.id) })
})

app.post('/client/:clientId/resume', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as any
  const clientId = c.req.param('clientId')
  const r = await rows<any>(sql`UPDATE schedules SET suspended_from = NULL, updated_at = NOW()
    WHERE client_id = ${clientId} AND is_active = true AND suspended_from IS NOT NULL RETURNING id`)
  for (const row of r) await recordAudit(userIdOf(user), 'RESUME', 'schedules', row.id, null, { scope: 'client' }, body.reason || null)
  return c.json({ resumed: r.length, clientId, scheduleIds: r.map((x) => x.id) })
})


export default app
