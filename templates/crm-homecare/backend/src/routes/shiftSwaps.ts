// /api/shift-swaps — a caregiver asks a coworker to take ONE day of their shift; the coworker
// answers; the office approves. Ported from the CVHC home care CRM (routes/shiftSwapsRoutes.js).
//
// Gating the CVHC original lacked: approve / reject are the office's; only the target caregiver
// answers; only the requester (or the office) withdraws; a caregiver sees only swaps they are in.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { rows, one, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte, DATE_RE } from '../services/scheduleOccurrences.ts'
import { agencyNow, addDaysYmd } from '../helpers/agencyTime.ts'
import { notifyUser, recordAudit } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)

const SWAP_COLS = sql.raw(`
  ss.id, ss.schedule_id, ss.requester_id, ss.requester_id AS requesting_caregiver_id, ss.target_id, ss.target_id AS target_caregiver_id,
  COALESCE(ss.client_id, s.client_id) AS client_id, to_char(ss.shift_date, 'YYYY-MM-DD') AS shift_date,
  to_char(COALESCE(ss.start_time, s.start_time::time), 'HH24:MI:SS') AS start_time,
  to_char(COALESCE(ss.end_time, s.end_time::time), 'HH24:MI:SS') AS end_time,
  ss.reason, ss.status, ss.notes, ss.responded_at, ss.reviewed_by_id, ss.reviewed_by_id AS admin_approved_by,
  ss.reviewed_at, ss.reviewed_at AS admin_approved_at, ss.created_at, ss.created_at AS requested_at`)

const getSwap = (id: string) => one<any>(sql`SELECT ${SWAP_COLS} FROM shift_swaps ss LEFT JOIN schedules s ON s.id = ss.schedule_id WHERE ss.id = ${id}`)

// GET /api/shift-swaps?status&caregiverId
app.get('/', async (c) => {
  const user = c.get('user') as any
  const { status, caregiverId } = c.req.query()
  const conds = [sql`TRUE`]
  if (status) conds.push(sql`ss.status = ${status}`)
  const who = isOffice(user) ? caregiverId : userIdOf(user)
  if (who) conds.push(sql`(ss.requester_id = ${who} OR ss.target_id = ${who})`)
  return c.json(await rows(sql`
    SELECT ${SWAP_COLS},
      cl.first_name AS client_first, cl.last_name AS client_last,
      cl.first_name AS client_first_name, cl.last_name AS client_last_name,
      u1.first_name AS requester_first, u1.last_name AS requester_last,
      u1.first_name AS requester_first_name, u1.last_name AS requester_last_name,
      u2.first_name AS target_first, u2.last_name AS target_last,
      u2.first_name AS target_first_name, u2.last_name AS target_last_name
    FROM shift_swaps ss
    LEFT JOIN schedules s ON ss.schedule_id = s.id
    LEFT JOIN clients cl ON cl.id = COALESCE(ss.client_id, s.client_id)
    JOIN users u1 ON ss.requester_id = u1.id
    LEFT JOIN users u2 ON ss.target_id = u2.id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY ss.created_at DESC`))
})

// POST /api/shift-swaps { scheduleId, targetCaregiverId, reason, shiftDate? }
// A swap is always about ONE day. A recurring pattern has no date, so when the caller does not say
// which, the request is pinned to the NEXT upcoming occurrence — the one the caregiver is looking at.
app.post('/', async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const requester = isOffice(user) && (b.requestingCaregiverId || b.requesterId) ? String(b.requestingCaregiverId || b.requesterId) : userIdOf(user)
  const target = b.targetCaregiverId || b.targetId || null
  if (!b.scheduleId) return c.json({ error: 'scheduleId is required' }, 400)
  const sch = await one<any>(sql`SELECT id, client_id, to_char(date, 'YYYY-MM-DD') AS date, day_of_week,
    to_char(start_time, 'HH24:MI:SS') AS start_time, to_char(end_time, 'HH24:MI:SS') AS end_time
    FROM schedules WHERE id = ${b.scheduleId} AND is_active = true`)
  if (!sch) return c.json({ error: 'Schedule not found' }, 404)
  const isRecurring = sch.day_of_week !== null && sch.day_of_week !== undefined

  let shiftDate: string | null = b.shiftDate || sch.date || null
  if (shiftDate && !DATE_RE.test(shiftDate)) return c.json({ error: 'shiftDate must be YYYY-MM-DD' }, 400)
  if (isRecurring && !shiftDate) {
    const { date: today } = await agencyNow()
    const next = await one<any>(sql`WITH ${occurrencesCte(today, addDaysYmd(today, 90))}
      SELECT to_char(occ.occ_date, 'YYYY-MM-DD') AS d FROM occ WHERE occ.schedule_id = ${b.scheduleId}
      ORDER BY occ.occ_date ASC LIMIT 1`)
    if (!next) return c.json({ error: 'This shift has no upcoming occurrences to swap.' }, 400)
    shiftDate = next.d
  }
  // The day's real owner and times (a covered day belongs to the covering caregiver).
  const occ = await one<any>(sql`WITH ${occurrencesCte(shiftDate!, shiftDate!)}
    SELECT occ.caregiver_id, occ.client_id, to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
      FROM occ WHERE occ.schedule_id = ${b.scheduleId}`)
  if (!occ) return c.json({ error: 'That shift has no visit on that date.' }, 400)
  if (!isOffice(user) && occ.caregiver_id !== requester) return c.json({ error: 'You can only swap your own shifts' }, 403)
  if (target && target === requester) return c.json({ error: 'Pick a different caregiver to take the shift' }, 400)

  const id = createId()
  await rows(sql`INSERT INTO shift_swaps (id, schedule_id, requester_id, target_id, client_id, shift_date, start_time, end_time, reason, status, created_at)
    VALUES (${id}, ${b.scheduleId}, ${requester}, ${target}, ${occ.client_id}, ${shiftDate}::date, ${occ.start_time}::time, ${occ.end_time}::time,
            ${b.reason || null}, 'pending', NOW())`)
  if (target) await notifyUser(target, 'shift_swap_request', 'Shift swap request', `A coworker is asking you to take their ${shiftDate} shift (${occ.start_time.slice(0, 5)}–${occ.end_time.slice(0, 5)}).`)
  return c.json(await getSwap(id), 201)
})

// PUT /api/shift-swaps/:id/respond { accepted, notes } — only the target caregiver answers.
app.put('/:id/respond', async (c) => {
  const user = c.get('user') as any
  const s = await getSwap(c.req.param('id'))
  if (!s) return c.json({ error: 'Swap request not found' }, 404)
  if (!isOffice(user) && s.target_id !== userIdOf(user)) return c.json({ error: 'Only the caregiver asked can answer this swap' }, 403)
  if (s.status !== 'pending') return c.json({ error: `This swap is already ${s.status}` }, 400)
  const { accepted, notes } = await c.req.json().catch(() => ({})) as any
  await rows(sql`UPDATE shift_swaps SET status = ${accepted ? 'accepted' : 'rejected'}, responded_at = NOW(), notes = ${notes || null} WHERE id = ${s.id}`)
  return c.json({ success: true })
})

// PUT /api/shift-swaps/:id/approve — the office approves an ACCEPTED swap.
app.put('/:id/approve', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const s = await getSwap(c.req.param('id'))
  if (!s) return c.json({ error: 'Swap request not found' }, 404)
  if (s.status !== 'accepted') return c.json({ error: 'Swap must be accepted by target caregiver first' }, 400)
  if (!s.target_id) return c.json({ error: 'This swap names no caregiver to take the shift.' }, 400)
  const sched = await one<any>(sql`SELECT id, caregiver_id, is_active, day_of_week FROM schedules WHERE id = ${s.schedule_id}`)
  if (!sched || sched.is_active === false) return c.json({ error: 'The original schedule was deleted or modified; swap can no longer be approved.' }, 409)
  if (sched.caregiver_id !== s.requester_id && sched.caregiver_id !== s.target_id) {
    return c.json({ error: 'The schedule was reassigned to a different caregiver; swap can no longer be approved.' }, 409)
  }
  const isRecurring = sched.day_of_week !== null && sched.day_of_week !== undefined
  if (isRecurring) {
    // ONE day: a per-date override. Reassigning the pattern would hand every future week away.
    if (!s.shift_date) return c.json({ error: 'This swap request has no shift date, so it cannot be applied to a single occurrence. Ask the caregiver to resubmit it.' }, 400)
    await rows(sql`
      INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_caregiver_id, created_by, created_at)
      VALUES (${createId()}, ${s.schedule_id}, ${s.shift_date}::date, 'modified', ${s.target_id}, ${userIdOf(user)}, NOW())
      ON CONFLICT (schedule_id, exception_date) DO UPDATE SET exception_type = 'modified', override_caregiver_id = EXCLUDED.override_caregiver_id`)
  } else {
    const upd = await one(sql`UPDATE schedules SET caregiver_id = ${s.target_id}, updated_at = NOW() WHERE id = ${s.schedule_id} AND is_active = true RETURNING id`)
    if (!upd) return c.json({ error: 'Schedule changed during approval. Try again.' }, 409)
  }
  await rows(sql`UPDATE shift_swaps SET status = 'approved', reviewed_by_id = ${userIdOf(user)}, reviewed_at = NOW() WHERE id = ${s.id}`)
  await recordAudit(userIdOf(user), 'APPROVE', 'shift_swaps', s.id, s, { status: 'approved' })
  await notifyUser(s.requester_id, 'shift_swap_approved', 'Shift swap approved', `Your ${s.shift_date} shift is now covered.`)
  await notifyUser(s.target_id, 'shift_swap_approved', 'Shift swap approved', `The ${s.shift_date} shift is on your schedule.`)
  return c.json({ success: true })
})

// PUT /api/shift-swaps/:id/reject { reason }
app.put('/:id/reject', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const s = await getSwap(c.req.param('id'))
  if (!s) return c.json({ error: 'Swap request not found' }, 404)
  const { reason } = await c.req.json().catch(() => ({})) as any
  await rows(sql`UPDATE shift_swaps SET status = 'rejected', notes = ${reason || null}, reviewed_by_id = ${userIdOf(user)}, reviewed_at = NOW() WHERE id = ${s.id}`)
  return c.json({ success: true })
})

// PUT /api/shift-swaps/:id/cancel — the requester (or the office) withdraws it
app.put('/:id/cancel', async (c) => {
  const user = c.get('user') as any
  const s = await getSwap(c.req.param('id'))
  if (!s) return c.json({ error: 'Swap request not found' }, 404)
  if (!isOffice(user) && s.requester_id !== userIdOf(user)) return c.json({ error: 'Only the caregiver who asked can withdraw this swap' }, 403)
  await rows(sql`UPDATE shift_swaps SET status = 'cancelled' WHERE id = ${s.id}`)
  return c.json({ success: true })
})

export default app
