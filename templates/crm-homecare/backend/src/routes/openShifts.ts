// /api/open-shifts — the open shift board. The office posts a visit (optionally offered only to
// caregivers it picks, optionally "first to accept gets it"); caregivers accept; the office approves,
// turns down, smart-fills or cancels. Ported from the CVHC home care CRM (routes/openShiftsRoutes.js).
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { rows, one, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms, schedTs, shiftHours, DATE_RE } from '../services/scheduleOccurrences.ts'
import { checkAuthorizationBalance } from '../helpers/authorizationCheck.ts'
import { agencyNow } from '../helpers/agencyTime.ts'
import { notifyUser, notifyAdmins, sendText, sendPush, agencyShortName } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)

// An open shift as the screens read it (CVHC column names kept: shift_date, claimed_by, approved_by).
const OS_COLS = sql.raw(`
  os.id, os.client_id, os.schedule_id, to_char(os.date, 'YYYY-MM-DD') AS shift_date, to_char(os.date, 'YYYY-MM-DD') AS date,
  to_char(os.start_time, 'HH24:MI:SS') AS start_time, to_char(os.end_time, 'HH24:MI:SS') AS end_time,
  os.status, os.notes, os.urgency, os.care_type_id, os.hourly_rate, COALESCE(os.bonus_amount, 0) AS bonus_amount,
  os.source_absence_id, os.notified_caregiver_count, os.auto_created, os.broadcast_sent,
  os.visible_to, os.auto_assign,
  os.claimed_by_id, os.claimed_by_id AS claimed_by, os.claimed_at,
  os.approved_by_id, os.approved_by_id AS approved_by, os.approved_at,
  os.created_by_id, os.created_by_id AS created_by, os.created_at, os.updated_at`)

const fmtHm = (t: string) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
const clientShort = (first: string, last: string) => `${first || ''} ${String(last || '').charAt(0)}.`.trim()

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

/**
 * Put the open shift's ONE visit on `caregiverId`. Shared by approve, smart-fill and the
 * first-to-accept claim, so all three fill a shift the same way.
 *  - No schedule behind it: the fill is its own one-time visit.
 *  - Recurring pattern: a per-occurrence 'modified' exception — reassigning the pattern would move
 *    every past and future occurrence.
 *  - A caregiver call-out CANCELS the day and posts it; filling it brings the visit back on the new
 *    caregiver. Any other cancellation (client refused, in hospital…) means there is no visit to fill.
 */
async function assignShift(s: any, caregiverId: string, actorId: string) {
  const day = s.shift_date
  if (!s.schedule_id) {
    await rows(sql`
      INSERT INTO schedules (id, client_id, caregiver_id, schedule_type, date, start_time, end_time, notes, status, is_active, frequency, created_at, updated_at)
      VALUES (${createId()}, ${s.client_id}, ${caregiverId}, 'one-time', ${day}::date, ${schedTs(s.start_time, day)}::timestamp,
              ${schedTs(s.end_time, day)}::timestamp, ${s.notes || null}, 'active', true, 'weekly', NOW(), NOW())`)
    return
  }
  const sched = await one<any>(sql`SELECT day_of_week FROM schedules WHERE id = ${s.schedule_id}`)
  const isRecurring = !!sched && sched.day_of_week !== null
  const exc = await one<any>(sql`SELECT id, exception_type, cancel_reason FROM schedule_exceptions
    WHERE schedule_id = ${s.schedule_id} AND exception_date = ${day}::date`)
  const isCallout = !!exc && exc.exception_type === 'cancelled' && exc.cancel_reason === 'caregiver_callout'
  if (exc && exc.exception_type === 'cancelled' && !isCallout) {
    throw new HttpError(409, 'This visit was cancelled on the schedule — there is no visit to fill.')
  }
  if (isRecurring) {
    if (isCallout) {
      await rows(sql`UPDATE schedule_exceptions SET exception_type = 'modified', override_caregiver_id = ${caregiverId}, cancel_reason = NULL WHERE id = ${exc.id}`)
    } else {
      await rows(sql`
        INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_caregiver_id, created_by, created_at)
        VALUES (${createId()}, ${s.schedule_id}, ${day}::date, 'modified', ${caregiverId}, ${actorId}, NOW())
        ON CONFLICT (schedule_id, exception_date)
        DO UPDATE SET override_caregiver_id = EXCLUDED.override_caregiver_id
        WHERE schedule_exceptions.exception_type <> 'cancelled'`)
    }
  } else {
    if (isCallout) await rows(sql`DELETE FROM schedule_exceptions WHERE id = ${exc.id}`)
    await rows(sql`UPDATE schedules SET caregiver_id = ${caregiverId}, status = 'active', updated_at = NOW() WHERE id = ${s.schedule_id}`)
  }
}

async function authWarnings(s: any): Promise<string[]> {
  try { return (await checkAuthorizationBalance(s.client_id, shiftHours(s.start_time, s.end_time))).warnings } catch { return [] }
}

const getShift = (id: string) => one<any>(sql`SELECT ${OS_COLS} FROM open_shifts os WHERE os.id = ${id}`)

// GET /api/open-shifts/caregivers-available?date&startTime&endTime&excludeScheduleId
// Who could take a slot BEFORE an open shift exists ("Mark Available"). Busy = an occurrence that
// day overlapping the slot (recurring visits included, cancelled ones not). Approved time off and
// blackout dates count as not available.
app.get('/caregivers-available', requireAdmin, async (c) => {
  const { date, startTime, endTime, excludeScheduleId } = c.req.query()
  if (!date || !startTime || !endTime || !DATE_RE.test(date) || !hms(startTime) || !hms(endTime)) {
    return c.json({ error: 'date, startTime, and endTime are required' }, 400)
  }
  const list = await rows<any>(sql`
    WITH ${occurrencesCte(date, date)}
    SELECT u.id, u.first_name, u.last_name, u.phone, u.email,
      EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
               AND (occ.start_time, occ.end_time) OVERLAPS (${hms(startTime)}::time, ${hms(endTime)}::time)
               AND occ.schedule_id IS DISTINCT FROM ${excludeScheduleId || null}) AS has_conflict,
      EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.caregiver_id = u.id
               AND (t.status = 'approved' OR t.type = 'blackout')
               AND ${date}::date BETWEEN t.start_date AND t.end_date) AS time_off
    FROM users u
    WHERE u.role = 'caregiver' AND u.is_active = true
    ORDER BY u.first_name, u.last_name`)
  return c.json(list.map((r) => ({
    id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email,
    available: !r.has_conflict && !r.time_off, busy: !!r.has_conflict, timeOff: !!r.time_off, notified: false,
  })))
})

// GET /api/open-shifts/available — what a caregiver may see: open, today or later, and either
// offered to everyone or offered to them.
app.get('/available', async (c) => {
  const user = c.get('user') as any
  const { date: today } = await agencyNow()
  const office = isOffice(user)
  const list = await rows(sql`
    SELECT ${OS_COLS}, cl.first_name AS client_first_name, cl.last_name AS client_last_name
      FROM open_shifts os LEFT JOIN clients cl ON os.client_id = cl.id
     WHERE os.status = 'open' AND os.date >= ${today}::date
       AND (os.visible_to IS NULL OR ${userIdOf(user)} = ANY(os.visible_to) OR ${office})
     ORDER BY os.date, os.start_time`)
  return c.json(list)
})

// GET /api/open-shifts — the office's board. ?status=open (default) | active (open + claimed) | all | <status>
app.get('/', requireAdmin, async (c) => {
  const { status, startDate, endDate, urgency } = c.req.query()
  const conds = [sql`TRUE`]
  if (status === 'active') conds.push(sql`os.status IN ('open', 'claimed')`)
  else if (status === 'all') { /* no filter */ }
  else if (status) conds.push(sql`os.status = ${status}`)
  else conds.push(sql`os.status = 'open'`)
  if (startDate && DATE_RE.test(startDate)) conds.push(sql`os.date >= ${startDate}::date`)
  if (endDate && DATE_RE.test(endDate)) conds.push(sql`os.date <= ${endDate}::date`)
  if (urgency) conds.push(sql`os.urgency = ${urgency}`)
  const list = await rows(sql`
    SELECT ${OS_COLS},
      cl.first_name AS client_first_name, cl.last_name AS client_last_name,
      cl.address AS client_address, cl.city AS client_city,
      ct.name AS care_type_name,
      u.first_name AS claimed_by_first, u.last_name AS claimed_by_last,
      (SELECT string_agg(v.first_name || ' ' || v.last_name, ', ' ORDER BY v.first_name)
         FROM users v WHERE v.id = ANY(os.visible_to)) AS offered_to
    FROM open_shifts os
    LEFT JOIN clients cl ON os.client_id = cl.id
    LEFT JOIN care_types ct ON os.care_type_id = ct.id
    LEFT JOIN users u ON os.claimed_by_id = u.id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY CASE os.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, os.date ASC, os.start_time ASC
    LIMIT 500`)
  return c.json(list)
})

// POST /api/open-shifts — post a shift by hand
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const shiftDate = b.shiftDate || b.date
  if (!shiftDate || !DATE_RE.test(shiftDate)) return c.json({ error: 'shiftDate (YYYY-MM-DD) is required' }, 400)
  if (!hms(b.startTime) || !hms(b.endTime)) return c.json({ error: 'startTime and endTime are required' }, 400)
  const id = createId()
  await rows(sql`
    INSERT INTO open_shifts (id, client_id, schedule_id, date, start_time, end_time, care_type_id, hourly_rate, bonus_amount,
                             notes, urgency, status, created_by_id, created_at, updated_at)
    VALUES (${id}, ${b.clientId || null}, ${b.scheduleId || null}, ${shiftDate}::date, ${hms(b.startTime)}::time, ${hms(b.endTime)}::time,
            ${b.careTypeId || null}, ${b.hourlyRate === '' || b.hourlyRate == null ? null : Number(b.hourlyRate)},
            ${Number(b.bonusAmount) || 0}, ${b.notes || null}, ${b.urgency || 'normal'}, 'open', ${userIdOf(user)}, NOW(), NOW())`)
  return c.json(await getShift(id), 201)
})

// POST /api/open-shifts/from-schedule/:scheduleId — post ONE visit of a schedule.
// Body: { date, visibleTo?: [caregiverId…], autoAssign?, bonusAmount?, urgency? }
// A repeating shift has no date of its own, so the office says which day; the visit must really
// happen that day, and its times come from the engine (they may be overridden for that day).
app.post('/from-schedule/:scheduleId', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const scheduleId = c.req.param('scheduleId')
  const b = await c.req.json().catch(() => ({})) as any
  const s = await one<any>(sql`SELECT s.id, s.client_id, to_char(s.date, 'YYYY-MM-DD') AS date, cl.referred_by_id
    FROM schedules s JOIN clients cl ON s.client_id = cl.id WHERE s.id = ${scheduleId}`)
  if (!s) return c.json({ error: 'Schedule not found' }, 404)
  const day = b.date || s.date
  if (!day || !DATE_RE.test(day)) return c.json({ error: 'Pick the date of the visit to post.' }, 400)

  const occ = await one<any>(sql`WITH ${occurrencesCte(day, day)}
    SELECT to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
      FROM occ WHERE occ.schedule_id = ${scheduleId}`)
  if (!occ) return c.json({ error: 'That shift has no visit on that date (it may be cancelled or not scheduled that day).' }, 400)

  const dup = await one(sql`SELECT ${OS_COLS} FROM open_shifts os WHERE os.schedule_id = ${scheduleId} AND os.date = ${day}::date AND os.status IN ('open', 'claimed')`)
  if (dup) return c.json({ error: 'This visit is already posted as an open shift.', openShift: dup }, 409)

  // The payer's current rate, when one is on file. No rate is invented when there is none.
  const rate = s.referred_by_id ? await one<any>(sql`SELECT rate_amount FROM referral_source_rates
    WHERE referral_source_id = ${s.referred_by_id} AND is_active = true
    ORDER BY effective_date DESC NULLS LAST LIMIT 1`) : null
  const visible = Array.isArray(b.visibleTo) && b.visibleTo.length ? b.visibleTo.map(String) : null
  const id = createId()
  await rows(sql`
    INSERT INTO open_shifts (id, client_id, schedule_id, date, start_time, end_time, hourly_rate, bonus_amount, urgency,
                             created_by_id, visible_to, auto_assign, notes, status, created_at, updated_at)
    VALUES (${id}, ${s.client_id}, ${scheduleId}, ${day}::date, ${occ.start_time}::time, ${occ.end_time}::time,
            ${rate?.rate_amount ?? null}, ${Number(b.bonusAmount) || 0}, ${b.urgency || 'normal'}, ${userIdOf(user)},
            ${visible ? sql`ARRAY[${sql.join(visible.map((v: string) => sql`${v}`), sql`, `)}]::text[]` : sql`NULL`},
            ${!!b.autoAssign}, 'Posted by the office', 'open', NOW(), NOW())`)
  return c.json(await getShift(id))
})

// POST /api/open-shifts/:id/claim — a caregiver accepts. An admin may name the caregiver.
app.post('/:id/claim', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({})) as any
  const caregiverId = isOffice(user) && b.caregiverId ? String(b.caregiverId) : userIdOf(user)

  const os = await one<any>(sql`SELECT ${OS_COLS} FROM open_shifts os WHERE os.id = ${id} AND os.status = 'open'`)
  if (!os) return c.json({ error: 'Shift is no longer available' }, 400)
  if (Array.isArray(os.visible_to) && !os.visible_to.includes(caregiverId)) return c.json({ error: 'This shift was not offered to you' }, 403)

  // A visit they already have at that time — recurring visits included, cancelled ones not.
  const conflict = await one(sql`WITH ${occurrencesCte(os.shift_date, os.shift_date)}
    SELECT occ.schedule_id FROM occ JOIN schedules s ON s.id = occ.schedule_id
     WHERE occ.caregiver_id = ${caregiverId}
       AND (occ.start_time, occ.end_time) OVERLAPS (${os.start_time}::time, ${os.end_time}::time)
       AND COALESCE(s.status, '') <> 'cancelled'
     LIMIT 1`)
  if (conflict) return c.json({ error: 'You have a conflicting shift at this time' }, 400)

  // First tap wins; a second caregiver is told it's gone.
  const took = await one(sql`UPDATE open_shifts SET status = 'claimed', claimed_by_id = ${caregiverId}, claimed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND status = 'open' RETURNING id`)
  if (!took) return c.json({ error: 'Someone else just took this shift' }, 409)
  await rows(sql`INSERT INTO open_shift_claims (id, open_shift_id, caregiver_id, notes, status, created_at)
    VALUES (${createId()}, ${id}, ${caregiverId}, ${b.notes || null}, 'pending', NOW())`)

  const who = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${caregiverId}`)
  const cl = await one<any>(sql`SELECT first_name, last_name FROM clients WHERE id = ${os.client_id}`)
  const what = `${fmtDay(os.shift_date)} ${fmtHm(os.start_time)}–${fmtHm(os.end_time)} with ${clientShort(cl?.first_name, cl?.last_name)}`
  const name = `${who?.first_name || ''} ${who?.last_name || ''}`.trim() || 'A caregiver'

  if (os.auto_assign) {
    try {
      await assignShift(os, caregiverId, os.created_by_id || caregiverId)
      await rows(sql`UPDATE open_shifts SET status = 'filled', approved_by_id = ${os.created_by_id || null}, approved_at = NOW(), updated_at = NOW() WHERE id = ${id}`)
      await rows(sql`UPDATE open_shift_claims SET status = 'approved' WHERE open_shift_id = ${id} AND caregiver_id = ${caregiverId}`)
      await notifyAdmins('open_shift_filled', `Open shift filled: ${name}`, `${name} accepted the open shift ${what}. It is on their schedule now.`)
      return c.json({ success: true, assigned: true, message: `It's yours — ${what} is on your schedule.` })
    } catch (e: any) {
      // Couldn't place it (e.g. the visit was cancelled meanwhile) — leave it claimed for the office.
      await notifyAdmins('open_shift_claimed', `Open shift needs you: ${name}`,
        `${name} accepted ${what}, but it couldn't be put on their schedule automatically (${e.message}). Check Open Shifts.`)
      return c.json({ success: true, assigned: false, message: 'Shift accepted — the office will confirm it.' })
    }
  }
  await notifyAdmins('open_shift_claimed', `Open shift accepted: ${name}`, `${name} wants the open shift ${what}. Approve it in Schedule Hub → Staffing → Open Shifts.`)
  return c.json({ success: true, assigned: false, message: 'Shift claimed - pending approval' })
})

// POST /api/open-shifts/:id/approve — the office approves the claim
app.post('/:id/approve', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const s = await getShift(c.req.param('id'))
  if (!s) return c.json({ error: 'Shift not found' }, 404)
  if (!s.claimed_by_id) return c.json({ error: 'No claim to approve' }, 400)
  const warnings = await authWarnings(s)
  try { await assignShift(s, s.claimed_by_id, userIdOf(user)) } catch (e: any) {
    return c.json({ error: e.message }, e instanceof HttpError ? e.status as any : 500)
  }
  await rows(sql`UPDATE open_shifts SET status = 'filled', approved_by_id = ${userIdOf(user)}, approved_at = NOW(), updated_at = NOW() WHERE id = ${s.id}`)
  await rows(sql`UPDATE open_shift_claims SET status = 'approved' WHERE open_shift_id = ${s.id} AND caregiver_id = ${s.claimed_by_id}`)
  await notifyUser(s.claimed_by_id, 'open_shift_approved', 'Open shift approved', `You're confirmed for ${fmtDay(s.shift_date)} ${fmtHm(s.start_time)}–${fmtHm(s.end_time)}.`)
  return c.json({ success: true, authWarnings: warnings })
})

// POST /api/open-shifts/:id/reject — turn the claim down; the shift reopens
app.post('/:id/reject', requireAdmin, async (c) => {
  const s = await getShift(c.req.param('id'))
  if (!s) return c.json({ error: 'Shift not found' }, 404)
  const { reason } = await c.req.json().catch(() => ({})) as any
  await rows(sql`UPDATE open_shifts SET status = 'open', claimed_by_id = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = ${s.id}`)
  await rows(sql`UPDATE open_shift_claims SET status = 'rejected', notes = ${reason || null} WHERE open_shift_id = ${s.id} AND status = 'pending'`)
  return c.json({ success: true })
})

// POST /api/open-shifts/:id/cancel — the office takes the posting down (the schedule keeps its caregiver)
app.post('/:id/cancel', requireAdmin, async (c) => {
  const r = await one(sql`UPDATE open_shifts SET status = 'cancelled', updated_at = NOW() WHERE id = ${c.req.param('id')} AND status IN ('open', 'claimed') RETURNING id`)
  if (!r) return c.json({ error: 'Shift cannot be cancelled (already filled or already cancelled)' }, 400)
  return c.json({ success: true })
})

// GET /api/open-shifts/:id/smart-fill-suggestions — the params to re-pass to the caregiver ranking
app.get('/:id/smart-fill-suggestions', requireAdmin, async (c) => {
  const s = await getShift(c.req.param('id'))
  if (!s) return c.json({ error: 'Open shift not found' }, 404)
  if (s.status !== 'open') return c.json({ error: `Shift is ${s.status}, not open` }, 409)
  return c.json({ forwardTo: '/api/scheduling/suggest-caregivers', params: { clientId: s.client_id, date: s.shift_date, startTime: s.start_time, endTime: s.end_time } })
})

// POST /api/open-shifts/:id/smart-fill { caregiverId } — assign directly, skipping claim → approve.
// Authorization is advice: filling an uncovered shift is never refused over paperwork.
app.post('/:id/smart-fill', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const { caregiverId } = await c.req.json().catch(() => ({})) as any
  if (!caregiverId) return c.json({ error: 'caregiverId required' }, 400)
  const s = await getShift(c.req.param('id'))
  if (!s) return c.json({ error: 'Open shift not found' }, 404)
  if (s.status !== 'open') return c.json({ error: `Shift is ${s.status}, not open` }, 409)
  const warnings = await authWarnings(s)
  try { await assignShift(s, caregiverId, userIdOf(user)) } catch (e: any) {
    return c.json({ error: e.message }, e instanceof HttpError ? e.status as any : 500)
  }
  await rows(sql`UPDATE open_shifts SET status = 'filled', claimed_by_id = ${caregiverId}, claimed_at = NOW(),
    approved_by_id = ${userIdOf(user)}, approved_at = NOW(), updated_at = NOW() WHERE id = ${s.id}`)
  const what = `${fmtDay(s.shift_date)} ${fmtHm(s.start_time)}–${fmtHm(s.end_time)}`
  await notifyUser(caregiverId, 'shift_assigned', 'New shift assigned', `You've been assigned to ${what}.`)
  await sendPush(caregiverId, { title: 'New shift assigned', body: `You've been assigned to ${what}.`, data: { type: 'shift_assigned', shiftId: s.id } })
  return c.json({ success: true, openShiftId: s.id, assignedTo: caregiverId, authWarnings: warnings })
})

// POST /api/open-shifts/:id/broadcast — mark broadcast; counts who would be reached
app.post('/:id/broadcast', requireAdmin, async (c) => {
  const s = await getShift(c.req.param('id'))
  if (!s) return c.json({ error: 'Shift not found' }, 404)
  const cgs = await rows<any>(sql`SELECT id FROM users WHERE role = 'caregiver' AND is_active = true`)
  await rows(sql`UPDATE open_shifts SET broadcast_sent = true, updated_at = NOW() WHERE id = ${s.id}`)
  return c.json({ success: true, message: `Broadcast sent to ${cgs.length} caregivers`, caregiverCount: cgs.length })
})

// GET /api/open-shifts/:id/eligible-caregivers — every active caregiver, marked available and notified
app.get('/:id/eligible-caregivers', requireAdmin, async (c) => {
  const s = await getShift(c.req.param('id'))
  if (!s) return c.json({ error: 'Shift not found' }, 404)
  const list = await rows<any>(sql`
    WITH ${occurrencesCte(s.shift_date, s.shift_date)}
    SELECT u.id, u.first_name, u.last_name, u.phone, u.email,
      EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
               AND (occ.start_time, occ.end_time) OVERLAPS (${s.start_time}::time, ${s.end_time}::time)
               AND occ.schedule_id IS DISTINCT FROM ${s.schedule_id || null}) AS has_conflict,
      EXISTS (SELECT 1 FROM open_shift_notifications n WHERE n.open_shift_id = ${s.id} AND n.caregiver_id = u.id) AS already_notified
    FROM users u WHERE u.role = 'caregiver' AND u.is_active = true
    ORDER BY u.first_name, u.last_name`)
  return c.json(list.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email, available: !r.has_conflict, notified: !!r.already_notified })))
})

// POST /api/open-shifts/:id/notify { caregiverIds, customMessage?, sms? } — tell chosen caregivers.
// An in-app notification for each, the open_shift_notifications row, best-effort push, and with
// sms:true a text (push reaches nobody who never subscribed, so a text is how they find out).
app.post('/:id/notify', requireAdmin, async (c) => {
  const { caregiverIds, customMessage, sms } = await c.req.json().catch(() => ({})) as any
  if (!Array.isArray(caregiverIds) || caregiverIds.length === 0) return c.json({ error: 'caregiverIds is required and must be a non-empty array' }, 400)
  const s = await one<any>(sql`SELECT ${OS_COLS}, cl.first_name AS client_first, cl.last_name AS client_last
    FROM open_shifts os LEFT JOIN clients cl ON os.client_id = cl.id WHERE os.id = ${c.req.param('id')}`)
  if (!s) return c.json({ error: 'Shift not found' }, 404)

  const bonus = parseFloat(s.bonus_amount) > 0 ? ` (+$${Number(s.bonus_amount).toFixed(2)} bonus)` : ''
  const title = `Open Shift: ${s.client_first || ''} ${s.client_last || ''}`.trim()
  const base = `${fmtDay(s.shift_date)} ${String(s.start_time).slice(0, 5)}–${String(s.end_time).slice(0, 5)}${bonus}. Open the app to claim it.`
  const message = customMessage ? `${customMessage}\n\n${base}` : base
  const prefix = await agencyShortName()
  const smsBody = `${prefix ? prefix + ': ' : ''}Open shift ${fmtDay(s.shift_date)} ${fmtHm(s.start_time)}-${fmtHm(s.end_time)} with ${clientShort(s.client_first, s.client_last)}. Open the app > Open Shifts to accept.${customMessage ? ' ' + customMessage : ''}`

  let notified = 0, texted = 0
  for (const cgId of caregiverIds.map(String)) {
    if (sms) {
      const ph = await one<any>(sql`SELECT phone FROM users WHERE id = ${cgId}`)
      if (ph?.phone && await sendText({ phone: ph.phone, body: smsBody })) texted++
    }
    try {
      await notifyUser(cgId, 'open_shift_offer', title, message)
      await rows(sql`INSERT INTO open_shift_notifications (id, open_shift_id, caregiver_id, notification_type, notified_at)
        VALUES (${createId()}, ${s.id}, ${cgId}, 'in_app', NOW()) ON CONFLICT (open_shift_id, caregiver_id) DO NOTHING`)
      await sendPush(cgId, { title, body: message, tag: `open-shift-${s.id}`, data: { type: 'open_shift_offer', openShiftId: s.id } })
      notified++
    } catch (e: any) { console.error('[open-shifts] notify', cgId, e?.message) }
  }
  await rows(sql`UPDATE open_shifts SET broadcast_sent = true,
    notified_caregiver_count = (SELECT COUNT(*) FROM open_shift_notifications WHERE open_shift_id = ${s.id}), updated_at = NOW()
    WHERE id = ${s.id}`)
  return c.json({ success: true, notified, texted, total: caregiverIds.length })
})

// GET /api/open-shifts/:id/claims — who accepted
app.get('/:id/claims', requireAdmin, async (c) => {
  return c.json(await rows(sql`
    SELECT osc.id, osc.open_shift_id, osc.caregiver_id, osc.notes, osc.status, osc.created_at,
           u.first_name, u.last_name, u.phone
      FROM open_shift_claims osc JOIN users u ON osc.caregiver_id = u.id
     WHERE osc.open_shift_id = ${c.req.param('id')}
     ORDER BY osc.created_at`))
})

export { assignShift }
export default app
