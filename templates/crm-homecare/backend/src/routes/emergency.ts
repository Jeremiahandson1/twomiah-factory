// /api/emergency — a caregiver calls out of a shift (miss report), the office finds and assigns
// coverage, and a visit is cancelled because the CLIENT was unavailable. Ported from the CVHC home
// care CRM (routes/emergencyRoutes.js).
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { rows, one, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms, schedTs, DATE_RE } from '../services/scheduleOccurrences.ts'
import { CLIENT_UNAVAILABLE_REASONS } from '../helpers/cancelReasons.ts'
import { agencyNow, addDaysYmd } from '../helpers/agencyTime.ts'
import { notifyUser, notifyAdmins, sendPush, recordAudit } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)

// The occurrence of a schedule on a date (resolved times / caregiver / client), or null.
async function occurrenceOn(scheduleId: string, date: string) {
  return one<any>(sql`WITH ${occurrencesCte(date, date)}
    SELECT occ.caregiver_id, occ.client_id, to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
      FROM occ WHERE occ.schedule_id = ${scheduleId} AND occ.occ_date = ${date}::date`)
}

// POST /api/emergency/miss-report { scheduleId?, date, reason?, alternativeContact? } — a caregiver
// can't make a shift. Records the absence, CANCELS that occurrence (so nothing reminds, no-show-alerts,
// pays or bills it), posts an urgent open shift and tells the caregivers who are free.
app.post('/miss-report', async (c) => {
  const user = c.get('user') as any
  const caregiverId = userIdOf(user)
  const { scheduleId, date, reason, alternativeContact } = await c.req.json().catch(() => ({})) as any
  if (!date || !DATE_RE.test(String(date))) return c.json({ error: 'Date is required' }, 400)

  let info: any = null
  if (scheduleId) {
    info = await one<any>(sql`SELECT s.id, s.client_id, s.caregiver_id, to_char(s.start_time, 'HH24:MI:SS') AS start_time,
        to_char(s.end_time, 'HH24:MI:SS') AS end_time, c.first_name AS client_first_name, c.last_name AS client_last_name
      FROM schedules s LEFT JOIN clients c ON s.client_id = c.id WHERE s.id = ${scheduleId}`)
    if (info) {
      const occ = await occurrenceOn(scheduleId, date)
      if (occ) {
        // A day that belongs to someone else (a covered day) is not this caregiver's to call out of.
        if (!isOffice(user) && occ.caregiver_id !== caregiverId) return c.json({ error: 'That visit is not on your schedule' }, 403)
        info = { ...info, start_time: occ.start_time, end_time: occ.end_time, client_id: occ.client_id }
      } else if (!isOffice(user) && info.caregiver_id !== caregiverId) {
        return c.json({ error: 'That visit is not on your schedule' }, 403)
      }
    }
  }

  const cg = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${caregiverId}`)
  const cgName = cg ? `${cg.first_name} ${cg.last_name}` : 'A caregiver'
  const reportId = createId()
  await rows(sql`INSERT INTO absences (id, caregiver_id, client_id, date, type, reason, coverage_needed, notes, status, created_at)
    VALUES (${reportId}, ${caregiverId}, ${info?.client_id || null}, ${date}::date, 'call_out', ${reason || 'No reason provided'}, true,
            ${JSON.stringify({ scheduleId: scheduleId || null, scheduleInfo: info ? { clientName: `${info.client_first_name} ${info.client_last_name}`, startTime: info.start_time, endTime: info.end_time } : null, alternativeContact: alternativeContact || null })},
            'reported', NOW())`)

  const alert = info
    ? `${cgName} cannot make their shift on ${date} with ${info.client_first_name} ${info.client_last_name}. Reason: ${reason || 'None given'}`
    : `${cgName} has reported they cannot work on ${date}. Reason: ${reason || 'None given'}`
  await notifyAdmins('emergency_coverage', 'Shift Miss Report — Coverage Needed', alert)

  if (scheduleId && info) {
    await rows(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_notes, created_by, cancel_reason, created_at)
      VALUES (${createId()}, ${scheduleId}, ${date}::date, 'cancelled', ${`Called out: ${reason || 'no reason given'}`}, ${caregiverId}, 'caregiver_callout', NOW())
      ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
        exception_type = 'cancelled', override_notes = EXCLUDED.override_notes, cancel_reason = 'caregiver_callout'`)
  }

  let openShiftId: string | null = null
  let notifiedCount = 0
  if (info?.client_id) {
    try {
      openShiftId = createId()
      await rows(sql`INSERT INTO open_shifts (id, client_id, schedule_id, date, start_time, end_time, notes, urgency, created_by_id,
                                              source_absence_id, auto_created, status, created_at, updated_at)
        VALUES (${openShiftId}, ${info.client_id}, ${scheduleId || null}, ${date}::date, ${info.start_time}::time, ${info.end_time}::time,
                ${`Coverage needed — ${cgName} called out. Reason: ${reason || 'None given'}`}, 'urgent', ${caregiverId},
                ${reportId}, true, 'open', NOW(), NOW())`)
      // Free caregivers: no overlapping visit that day (recurring included), not on approved time off.
      const free = await rows<any>(sql`WITH ${occurrencesCte(date, date)}
        SELECT u.id FROM users u
         WHERE u.role = 'caregiver' AND u.is_active = true AND u.id <> ${caregiverId}
           AND NOT EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
                            AND (occ.start_time, occ.end_time) OVERLAPS (${info.start_time}::time, ${info.end_time}::time))
           AND NOT EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.caregiver_id = u.id AND t.status = 'approved'
                            AND ${date}::date BETWEEN t.start_date AND t.end_date)
         LIMIT 30`)
      const msg = `${info.client_first_name} ${info.client_last_name} needs coverage on ${date} from ${info.start_time.slice(0, 5)} to ${info.end_time.slice(0, 5)}. Open the app to claim this shift.`
      for (const f of free) {
        try {
          await rows(sql`INSERT INTO open_shift_notifications (id, open_shift_id, caregiver_id, notification_type, notified_at)
            VALUES (${createId()}, ${openShiftId}, ${f.id}, 'push', NOW()) ON CONFLICT (open_shift_id, caregiver_id) DO NOTHING`)
          await notifyUser(f.id, 'open_shift', 'Urgent Shift Available', msg)
          await sendPush(f.id, { title: 'Urgent Open Shift', body: msg, data: { type: 'open_shift', openShiftId } })
          notifiedCount++
        } catch { /* keep going */ }
      }
      await rows(sql`UPDATE open_shifts SET notified_caregiver_count = ${notifiedCount} WHERE id = ${openShiftId}`)
    } catch (e: any) {
      console.error('[miss-report] open shift:', e?.message)
      openShiftId = null
    }
  }

  return c.json({
    id: reportId,
    message: 'Your report has been submitted. The admin team has been notified.',
    date, status: 'submitted', openShiftCreated: !!openShiftId, caregiversNotified: notifiedCount,
  }, 201)
})

// GET /api/emergency/miss-reports — call-outs still needing coverage
app.get('/miss-reports', requireAdmin, async (c) => {
  const { date: today } = await agencyNow()
  const list = await rows<any>(sql`
    SELECT a.id, a.caregiver_id, a.client_id, to_char(a.date, 'YYYY-MM-DD') AS date, a.type, a.reason, a.notes,
           a.coverage_needed, a.coverage_assigned_to, a.created_at,
           u.first_name, u.last_name, u.phone, u.email,
           c.first_name AS client_first_name, c.last_name AS client_last_name
      FROM absences a
      JOIN users u ON a.caregiver_id = u.id
      LEFT JOIN clients c ON a.client_id = c.id
     WHERE a.type = 'call_out' AND a.coverage_needed = true AND a.coverage_assigned_to IS NULL
       AND a.date >= ${today}::date
     ORDER BY a.date ASC, a.created_at ASC`)
  return c.json(list.map((r) => {
    let n: any = null
    try { n = r.notes ? JSON.parse(r.notes) : null } catch { n = null }
    return {
      ...r,
      schedule_id: n?.scheduleId || null,
      client_name: n?.scheduleInfo?.clientName || (r.client_first_name ? `${r.client_first_name} ${r.client_last_name}` : null),
      start_time: n?.scheduleInfo?.startTime || null,
      end_time: n?.scheduleInfo?.endTime || null,
      coverage_assigned: !!r.coverage_assigned_to,
    }
  }))
})

// GET /api/emergency/available-caregivers?date&startTime&endTime&clientId — who can cover
app.get('/available-caregivers', requireAdmin, async (c) => {
  const { date, startTime, endTime, clientId } = c.req.query()
  if (!date || !DATE_RE.test(date) || !hms(startTime) || !hms(endTime)) return c.json({ error: 'date, startTime, and endTime are required' }, 400)
  const weekStart = addDaysYmd(date, -new Date(`${date}T12:00:00Z`).getUTCDay())
  const weekEnd = addDaysYmd(weekStart, 6)
  const preferred = clientId ? await one<any>(sql`SELECT preferred_caregivers FROM clients WHERE id = ${clientId}`) : null
  const preferredIds = new Set<string>(Array.isArray(preferred?.preferred_caregivers) ? preferred.preferred_caregivers.map(String) : [])
  const list = await rows<any>(sql`
    WITH ${occurrencesCte(date, date)}, ${occurrencesCte(weekStart, weekEnd, 'wk')}
    SELECT u.id, u.first_name, u.last_name, u.phone, u.email, u.certifications,
           ca.weekly_availability, ca.status AS availability_status,
           COALESCE((SELECT SUM(wk.hours) FROM wk WHERE wk.caregiver_id = u.id), 0) AS scheduled_hours_this_week,
           (SELECT to_char(MAX(te.start_time), 'YYYY-MM-DD') FROM time_entries te WHERE te.caregiver_id = u.id AND te.is_complete = true) AS last_worked,
           COALESCE((SELECT ROUND(AVG(pr.satisfaction_score)::numeric, 1) FROM performance_ratings pr WHERE pr.caregiver_id = u.id), 0) AS avg_rating
      FROM users u
      LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
     WHERE u.role = 'caregiver' AND u.is_active = true
       AND NOT EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
                        AND (occ.start_time, occ.end_time) OVERLAPS (${hms(startTime)}::time, ${hms(endTime)}::time))
       AND NOT EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.caregiver_id = u.id AND t.status = 'approved'
                        AND ${date}::date BETWEEN t.start_date AND t.end_date)
       AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.caregiver_id = u.id AND a.date = ${date}::date AND a.type IN ('call_out', 'no_show'))`)
  const out = list.map((r) => ({ ...r, scheduled_hours_this_week: Math.round(Number(r.scheduled_hours_this_week) * 100) / 100, is_preferred: preferredIds.has(r.id) }))
  out.sort((a, b) => Number(b.is_preferred) - Number(a.is_preferred) || Number(b.avg_rating) - Number(a.avg_rating) || a.scheduled_hours_this_week - b.scheduled_hours_this_week)
  return c.json(out)
})

// POST /api/emergency/assign-coverage { absenceId, caregiverId, date, startTime, endTime, clientId, notes }
app.post('/assign-coverage', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const { absenceId, caregiverId, date, startTime, endTime, clientId, notes } = await c.req.json().catch(() => ({})) as any
  if (!caregiverId) return c.json({ error: 'caregiverId is required' }, 400)
  if (absenceId) await rows(sql`UPDATE absences SET coverage_assigned_to = ${caregiverId}, coverage_needed = false WHERE id = ${absenceId}`)
  if (date && DATE_RE.test(date) && hms(startTime) && hms(endTime) && clientId) {
    const id = createId()
    await rows(sql`INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes, is_active, status, frequency, created_at, updated_at)
      VALUES (${id}, ${caregiverId}, ${clientId}, 'one-time', ${date}::date, ${schedTs(startTime, date)}::timestamp, ${schedTs(endTime, date)}::timestamp,
              ${`Emergency coverage${notes ? ': ' + notes : ''}. Original absence: ${absenceId || 'N/A'}`}, true, 'active', 'weekly', NOW(), NOW())`)
    await recordAudit(userIdOf(user), 'CREATE', 'schedules', id, null, { emergency_coverage: true, absenceId: absenceId || null })
  }
  const cg = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${caregiverId}`)
  const cl = clientId ? await one<any>(sql`SELECT first_name, last_name FROM clients WHERE id = ${clientId}`) : null
  await notifyUser(caregiverId, 'emergency_assignment', 'Emergency Coverage Assignment',
    `You have been assigned emergency coverage on ${date} from ${startTime} to ${endTime}${cl ? ` for ${cl.first_name} ${cl.last_name}` : ''}. Please confirm your availability.`)
  return c.json({ success: true, ok: true, message: `Coverage assigned to ${cg?.first_name || ''} ${cg?.last_name || ''}`.trim() })
})

// GET /api/emergency/my-shifts — the caregiver's upcoming shifts, for the miss-report form
app.get('/my-shifts', async (c) => {
  const user = c.get('user') as any
  const { date: today } = await agencyNow()
  return c.json(await rows(sql`
    SELECT s.id, to_char(s.date, 'YYYY-MM-DD') AS date, s.day_of_week,
           to_char(s.start_time, 'HH24:MI:SS') AS start_time, to_char(s.end_time, 'HH24:MI:SS') AS end_time,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.address AS client_address
      FROM schedules s JOIN clients c ON s.client_id = c.id
     WHERE s.caregiver_id = ${userIdOf(user)} AND s.is_active = true
       AND (s.date >= ${today}::date OR (s.date IS NULL AND s.day_of_week IS NOT NULL AND (s.end_date IS NULL OR s.end_date >= ${today}::date)))
       AND (s.suspended_from IS NULL OR s.suspended_from > ${today}::date)
     ORDER BY s.date ASC NULLS LAST, s.start_time ASC
     LIMIT 14`))
})

// POST /api/emergency/client-unavailable { scheduleId, date, reason, note? }
// The client refused care, wasn't home, was in hospital or cancelled ahead. The visit is cancelled
// with that REASON so nothing bills, pays, reminds or no-show-alerts for it — with no caregiver
// absence and no open shift, because nobody needs covering. A caregiver may cancel only their OWN
// visit, from seven days ago through tomorrow; the office any visit, any date.
app.post('/client-unavailable', async (c) => {
  const user = c.get('user') as any
  const office = isOffice(user)
  const { scheduleId, date, reason, note } = await c.req.json().catch(() => ({})) as any
  if (!scheduleId || !date || !reason) return c.json({ error: 'scheduleId, date and reason are required' }, 400)
  if (!DATE_RE.test(String(date))) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const label = CLIENT_UNAVAILABLE_REASONS[reason]
  if (!label) return c.json({ error: `reason must be one of: ${Object.keys(CLIENT_UNAVAILABLE_REASONS).join(', ')}` }, 400)
  if (reason === 'other' && !(note && String(note).trim())) return c.json({ error: 'Please add a note when the reason is Other' }, 400)

  if (!office) {
    const { date: today } = await agencyNow()
    if (date < addDaysYmd(today, -7) || date > addDaysYmd(today, 1)) {
      return c.json({ error: 'You can report a client as unavailable for the last 7 days through tomorrow. For older dates, contact the office.' }, 400)
    }
  }

  let visit = await occurrenceOn(scheduleId, date)
  if (!visit) {
    // Already cancelled (a second tap, or the office got there first)? Record the better reason.
    visit = await one<any>(sql`SELECT COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id, s.client_id,
        to_char(s.start_time, 'HH24:MI:SS') AS start_time, to_char(s.end_time, 'HH24:MI:SS') AS end_time
      FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
      WHERE se.schedule_id = ${scheduleId} AND se.exception_date = ${date}::date AND se.exception_type = 'cancelled'`)
    if (!visit) return c.json({ error: 'No visit is scheduled on that date for this shift' }, 404)
  }
  if (!office && visit.caregiver_id !== userIdOf(user)) return c.json({ error: 'That visit is not on your schedule' }, 403)

  const noteText = note && String(note).trim() ? String(note).trim().slice(0, 500) : ''
  const overrideNotes = `Client unavailable — ${label}${noteText ? `: ${noteText}` : ''}`
  const saved = await one<any>(sql`
    INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_notes, created_by, cancel_reason, created_at)
    VALUES (${createId()}, ${scheduleId}, ${date}::date, 'cancelled', ${overrideNotes}, ${userIdOf(user)}, ${reason}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
      exception_type = 'cancelled', override_start_time = NULL, override_end_time = NULL,
      override_notes = EXCLUDED.override_notes, cancel_reason = EXCLUDED.cancel_reason
    RETURNING id, schedule_id, to_char(exception_date, 'YYYY-MM-DD') AS exception_date, exception_type, override_notes, cancel_reason`)
  await recordAudit(userIdOf(user), 'CLIENT_UNAVAILABLE', 'schedules', scheduleId, null, { date, reason, note: noteText || null, exception_id: saved.id }, reason)

  if (!office) {
    const who = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${userIdOf(user)}`)
    const cl = await one<any>(sql`SELECT first_name, last_name FROM clients WHERE id = ${visit.client_id}`)
    const cgName = who ? `${who.first_name} ${who.last_name}` : 'A caregiver'
    const clName = cl ? `${cl.first_name} ${cl.last_name}` : 'a client'
    await notifyAdmins('client_unavailable', 'Client unavailable — visit not billed',
      `${cgName} reported ${clName} unavailable on ${date} (${String(visit.start_time).slice(0, 5)}–${String(visit.end_time).slice(0, 5)}): ${label}${noteText ? ` — ${noteText}` : ''}. The visit will not be billed or paid.`)
  }
  return c.json({ success: true, exception: saved, label }, 201)
})

export default app
